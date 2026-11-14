import test from "node:test";
import assert from "node:assert/strict";
import { createSyncService } from "../server/application/sync-service.mjs";
import { SourceRateLimitError } from "../server/domain/errors.mjs";
const settings = {
  enabled: true,
  intervalHours: 168,
  retention: "manual",
  scopes: [{ provinceCode: "50", districtCodes: ["5001", "5002"] }],
};
function setup(
  fail = false,
  hang = false,
  geocoder = {},
  clock = () => new Date("2026-11-12T12:00:00Z"),
) {
  let saved = structuredClone(settings);
  const states = {},
    records = new Map(),
    messages = [];
  let extracts = 0,
    cleanups = 0;
  const repository = {
    getSettings: async () => saved,
    saveSettings: async (s) => {
      saved = s;
    },
    getState: async (k, d) => states[k] || d,
    setState: async (k, d) => {
      states[k] = structuredClone(d);
    },
    alert: async (m) => messages.push(m),
    recordCheck: async (check) => {
      if (check.message) messages.push(check.message);
    },
    expireProperties: async () => {
      cleanups++;
      return 0;
    },
    pendingFiles: async () => [],
    fileReferenced: async () => false,
    completeFile: async () => {},
    allProperties: async () => [...records.values()],
    getProperty: async (id) => records.get(id),
    upsertProperty: async (p, run) => records.set(p.id, p),
    updateSource: async (id, patch) =>
      records.set(id, { ...records.get(id), ...patch }),
  };
  const source = {
    prepareScope: async () => ({}),
    extract: async (j, s, save) => {
      extracts++;
      if (hang)
        await new Promise((resolve, reject) =>
          s.addEventListener("abort", () => reject(s.reason), { once: true }),
        );
      if (fail) throw Error("source changed");
      j.properties = [
        {
          id: "one",
          rawText: "fixture",
          deed: "",
          status: "needs_review",
          assetSequence: "1",
          caseNumber: "A",
          parcels: [],
        },
      ];
      j.seen = 1;
      j.pages = 1;
      j.extractionComplete = true;
      await save(j);
    },
  };
  const options = {
    repository,
    source,
    geocoder,
    files: {},
    clock,
    geography: {
      provinces: [
        {
          code: "50",
          name: "เชียงใหม่",
          districts: [
            { code: "5001", name: "เมืองเชียงใหม่" },
            { code: "5002", name: "จอมทอง" },
          ],
        },
      ],
    },
  };
  const service = createSyncService(options);
  return {
    service,
    records,
    messages,
    states,
    options,
    get extracts() {
      return extracts;
    },
    get cleanups() {
      return cleanups;
    },
  };
}
async function waitFor(s, status) {
  for (let n = 0; n < 100; n++) {
    if (s.status().status === status) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw Error("did not enter " + status);
}

test("scheduler processes all scopes without waiting for user input", async () => {
  const t = setup();
  await t.service.init();
  await t.service.start();
  await t.service.task;
  assert.equal(t.extracts, 2);
  assert.equal(t.records.size, 1);
  assert.equal(t.service.status().status, "completed");
  assert.equal(t.service.running, false);
  assert.equal(t.service.status().nextRunAt, "2026-11-19T12:00:00.000Z");
  await t.service.tick();
  assert.equal(t.extracts, 2);
  assert.equal(t.service.running, false);
});

test("scheduler survives a failure to save its error alert", async (t) => {
  t.mock.method(console, "error", () => {});
  const fixture = setup();
  const { service, options } = fixture;
  await service.init();
  const getSettings = options.repository.getSettings;
  options.repository.getSettings = async () => {
    throw Error("database disconnected");
  };
  options.repository.alert = async () => {
    throw Error("alert insert failed");
  };
  await service.tick();
  assert.equal(console.error.mock.callCount(), 2);
  assert.equal(fixture.extracts, 0);
  options.repository.getSettings = getSettings;
  await service.tick();
  await service.task;
  assert.equal(fixture.extracts, 2);
  assert.equal(service.status().status, "completed");
});

test("photo refresh targets incomplete components and only patches evidence", async () => {
  const t = setup();
  const old = {
    id: "bundle",
    province: "เชียงใหม่",
    district: "อำเภอเมืองเชียงใหม่",
    price: 100,
    user: { comment: "keep" },
    parcels: [{ deed: "1", latitude: 18.8 }],
    error: "อ่านวันประมูลไม่ได้ · ภาพประกาศยังโหลดไม่ครบ (2/3 รูป)",
    assetComponents: [
      {
        componentKey: "a",
        screenshotUrl: "/evidence/a.png",
        evidenceReady: true,
        evidenceImages: { photos: { total: 1, loaded: 1 } },
      },
      {
        componentKey: "b",
        screenshotUrl: "/evidence/b.png",
        evidenceReady: false,
      },
    ],
  };
  t.records.set(old.id, old);
  t.options.source.prepareScope = async (scope) =>
    assert.equal(scope.districtCode, "5001");
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  t.options.source.extract = async (job) => {
    assert.equal(job.targetId, old.id);
    assert.deepEqual([...job.targetKeys], ["b"]);
    await wait;
    job.properties = [
      {
        componentKey: "b",
        price: 999,
        evidenceReady: true,
        screenshotUrl: "/evidence/new.png",
      },
    ];
  };
  const refreshing = t.service.refreshPhotos(old.id);
  await assert.rejects(t.service.start(), /รีเฟรชรูป/);
  release();
  const result = await refreshing;
  assert.equal(result.complete, true);
  assert.equal(
    result.property.assetComponents[1].screenshotUrl,
    "/evidence/new.png",
  );
  assert.deepEqual(result.property.assetComponents[0], old.assetComponents[0]);
  assert.deepEqual(result.property.parcels, old.parcels);
  assert.deepEqual(result.property.user, old.user);
  assert.equal(result.property.price, 100);
  assert.equal(result.property.error, "อ่านวันประมูลไม่ได้");
});
test("daily quota pauses the parcel queue for 302 minutes and resumes after restart without duplicating source retrieval", async () => {
  let now = new Date("2026-11-12T12:00:00Z"),
    limited = true,
    calls = 0;
  const t = setup(
    false,
    false,
    {
      locate: async (p, deed) => {
        calls++;
        if (limited) throw new SourceRateLimitError("เกินจำกัด 20 /วัน");
        return {
          deed,
          status: "located",
          latitude: 18.8,
          longitude: 98.9,
          mapEvidenceUrl: "/evidence/map.png",
          backgroundReady: true,
        };
      },
    },
    () => now,
  );
  t.states.sync_runtime = {
    status: "completed",
    nextRunAt: "2026-11-19T12:00:00.000Z",
  };
  t.records.set("a", { id: "a", deed: "1", parcels: [], status: "pending" });
  t.records.set("b", { id: "b", deed: "2", parcels: [], status: "pending" });
  await t.service.init();
  await t.service.start(true);
  await t.service.task;
  assert.equal(calls, 1);
  assert.equal(t.service.status().status, "waiting_limit");
  assert.equal(t.service.status().geoRetryAt, "2026-11-12T17:02:00.000Z");
  assert.equal(t.records.get("a").parcels.length, 0);
  await assert.rejects(t.service.start(true), /รอโควตา/);
  await t.service.tick();
  assert.equal(calls, 1);
  const restarted = createSyncService(t.options);
  await restarted.init();
  assert.equal(restarted.status().status, "waiting_limit");
  now = new Date("2026-11-12T17:02:00Z");
  limited = false;
  await restarted.tick();
  await restarted.task;
  assert.equal(calls, 3);
  assert.equal(t.extracts, 0);
  assert.equal(restarted.status().geoRetryAt, null);
  assert.equal(restarted.status().status, "completed");
  assert.equal(restarted.status().nextRunAt, "2026-11-19T12:00:00.000Z");
});
test("verified exact parcels are reused across listings without spending another source query", async () => {
  let calls = 0;
  const t = setup(false, false, {
    locate: async () => {
      calls++;
      throw Error("must reuse evidence");
    },
  });
  const geography = {
    province: "เชียงใหม่",
    district: "เมืองเชียงใหม่",
    subdistrict: "สุเทพ",
  };
  t.records.set("known", {
    id: "known",
    ...geography,
    deed: "1",
    status: "located",
    parcels: [
      {
        deed: "1",
        status: "located",
        latitude: 18.8,
        longitude: 98.9,
        mapEvidenceUrl: "/evidence/map.png",
        backgroundReady: true,
      },
    ],
  });
  t.records.set("new", {
    id: "new",
    ...geography,
    deed: "1",
    status: "pending",
    parcels: [],
  });
  await t.service.start(true);
  await t.service.task;
  assert.equal(calls, 0);
  assert.equal(t.records.get("new").status, "located");
  assert.equal(
    t.records.get("new").parcels[0].mapEvidenceUrl,
    "/evidence/map.png",
  );
});
test("cancellation releases an automatic sync and prevents overlapping runs", async () => {
  const t = setup(false, true);
  await t.service.start();
  await waitFor(t.service, "extracting");
  await assert.rejects(t.service.start(), /กำลัง/);
  t.service.cancel();
  await t.service.task;
  assert.equal(t.service.status().status, "cancelled");
});
test("source errors persist an alert and incomplete status", async () => {
  const t = setup(true);
  await t.service.start();
  await t.service.task;
  assert.equal(t.service.status().status, "partial");
  assert.deepEqual(t.messages, ["source changed"]);
});

test("stopping announcement sync preserves an active LandsMaps cooldown", async () => {
  const t = setup(false, true);
  const cooldown = "2026-11-12T17:02:00.000Z";
  t.states.sync_runtime = { status: "waiting_limit", geoRetryAt: cooldown };
  await t.service.init();
  await t.service.start();
  await waitFor(t.service, "extracting");
  t.service.cancel();
  await t.service.task;
  assert.equal(t.states.sync_runtime.geoRetryAt, cooldown);
  await assert.rejects(t.service.start(true), /รอโควตา/);
});

test("daily parcel retry keeps verified coordinates and evidence after a failed refresh", async () => {
  let now = new Date("2026-11-12T12:00:00Z");
  const calls = [];
  const t = setup(
    false,
    false,
    {
      locate: async (p, deed) => {
        calls.push(deed);
        return {
          deed,
          status: "not_found",
          latitude: null,
          longitude: null,
          note: "ไม่พบแปลง",
        };
      },
    },
    () => now,
  );
  t.states.sync_runtime = {
    status: "completed",
    nextRunAt: "2026-11-19T12:00:00Z",
  };
  const original = {
    deed: "1",
    status: "located",
    latitude: 18.8,
    longitude: 98.9,
    evidenceUrl: "/evidence/old.png",
    backgroundReady: false,
    lookupDay: "2026-11-11",
  };
  t.records.set("verified", { id: "verified", deed: "1", parcels: [original] });
  t.records.set("untried", { id: "untried", deed: "2", parcels: [] });
  await t.service.init();
  await t.service.tick();
  await t.service.task;
  assert.deepEqual(calls, ["2", "1"]);
  assert.deepEqual(t.records.get("verified").parcels[0], {
    ...original,
    lookupDay: "2026-11-12",
    lookupWarning: "ไม่พบแปลง",
  });
  assert.equal(t.records.get("verified").status, "needs_review");
  assert.equal(t.extracts, 0);
  const restarted = createSyncService(t.options);
  await restarted.init();
  await restarted.tick();
  assert.equal(calls.length, 2);
  now = new Date("2026-11-13T12:00:00Z");
  await restarted.tick();
  await restarted.task;
  assert.equal(calls.length, 4);
  assert.equal(t.extracts, 0);
});

test("saving a selected scope immediately starts sync even if recurring runs are disabled", async () => {
  const t = setup();
  await t.service.settings({ ...settings, enabled: false });
  await t.service.task;
  assert.equal(t.extracts, 2);
  await t.service.settings({ ...settings, enabled: false, scopes: [] });
  assert.equal(t.extracts, 2);
});
test("new deeds in an existing bundle are geocoded without repeating complete parcels", async () => {
  const seen = [];
  const t = setup(false, false, {
    locate: async (record, deed) => {
      seen.push([record.subdistrict, deed]);
      return {
        deed,
        status: "located",
        latitude: 18.8,
        longitude: 98.9,
        mapEvidenceUrl: "/evidence/new-map.png",
        backgroundReady: true,
      };
    },
  });
  t.records.set("bundle", {
    id: "bundle",
    deed: "1, 2",
    status: "pending",
    subdistrict: "first",
    assetComponents: [{ deed: "2", subdistrict: "second" }],
    parcels: [
      {
        deed: "1",
        status: "located",
        latitude: 18.8,
        longitude: 98.9,
        mapEvidenceUrl: "/evidence/old-map.png",
        backgroundReady: true,
      },
    ],
  });
  await t.service.start(true);
  await t.service.task;
  assert.deepEqual(seen, [["second", "2"]]);
  assert.equal(t.records.get("bundle").parcels.length, 2);
  assert.equal(t.records.get("bundle").status, "located");
});
