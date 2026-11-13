import test from "node:test";
import assert from "node:assert/strict";
import { createSyncService } from "../server/application/sync-service.mjs";
const settings = {
  enabled: true,
  intervalHours: 168,
  retention: "manual",
  scopes: [{ provinceCode: "50", districtCodes: ["5001", "5002"] }],
};
function setup(fail = false, hang = false) {
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
    expireProperties: async () => {
      cleanups++;
      return 0;
    },
    pendingFiles: async () => [],
    fileReferenced: async () => false,
    completeFile: async () => {},
    allProperties: async () => [...records.values()],
    upsertProperty: async (p, run) => records.set(p.id, p),
    updateSource: async () => {},
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
  const service = createSyncService({
    repository,
    source,
    geocoder: {},
    files: {},
    clock: () => new Date("2026-11-12T12:00:00Z"),
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
  });
  return {
    service,
    records,
    messages,
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
