import test from "node:test";
import assert from "node:assert/strict";
import { createRetrievalService } from "../server/application/retrieval-service.mjs";
import { SourceUnavailableError } from "../server/domain/errors.mjs";
const request = {
  name: "fixture",
  values: { provinces: "50" },
  captcha: "123456",
};
const property = () => ({
  id: "one",
  deed: "28606",
  district: "พร้าว",
  status: "pending",
  parcels: [],
  auctionDates: ["26/11/2569"],
});
function setup({ extract, locate } = {}) {
  const saved = new Map();
  const repository = {
    saveJob: async (j) => saved.set(j.id, structuredClone(j)),
    getJob: async (id) => structuredClone(saved.get(id)),
  };
  const workspace = {
    busy: false,
    lock: false,
    async exclusive(fn) {
      if (this.busy || this.lock) throw Error("busy");
      this.lock = true;
      try {
        return await fn();
      } finally {
        this.lock = false;
      }
    },
  };
  const source = {
    prepare: async () => {},
    extract:
      extract ||
      (async (j, c, s, save) => {
        j.properties = [property()];
        j.extractionComplete = true;
        await save(j);
      }),
  };
  const geocoder = {
    locate:
      locate ||
      (async (p, deed) => ({
        deed,
        latitude: 19.31,
        longitude: 99.15,
        status: "located",
      })),
  };
  const service = createRetrievalService({
    repository,
    source,
    geocoder,
    workspace,
    pause: async (signal) => signal.throwIfAborted(),
  });
  return { service, saved, workspace };
}
test("complete only after extraction and every deed is located", async () => {
  const { service, saved } = setup();
  const id = await service.start(request);
  await service.promise;
  assert.equal(saved.get(id).status, "completed");
  assert.equal(saved.get(id).properties[0].parcels[0].deed, "28606");
  assert.ok(saved.get(id).finishedAt);
  assert.equal(service.activeId, null);
});
test("missing coordinates persist as partial, without invented pin", async () => {
  const { service, saved } = setup({
    locate: async () => {
      throw Error("not found");
    },
  });
  const id = await service.start(request);
  await service.promise;
  const j = saved.get(id);
  assert.equal(j.status, "partial");
  assert.equal(j.properties[0].parcels[0].latitude, null);
  assert.equal(j.properties[0].parcels[0].status, "lookup_failed");
  assert.equal(j.properties[0].status, "needs_review");
});
test("a source outage stops lookups, preserves unattempted records and can resume", async () => {
  let available = false,
    calls = 0;
  const { service, saved, workspace } = setup({
    extract: async (j) => {
      j.properties = [property(), { ...property(), id: "two", deed: "123" }];
      j.extractionComplete = true;
    },
    locate: async (p, deed) => {
      calls++;
      if (!available) throw new SourceUnavailableError("source unavailable");
      return { deed, latitude: 19.31, longitude: 99.15, status: "located" };
    },
  });
  const id = await service.start(request);
  await service.promise;
  assert.equal(calls, 1);
  assert.equal(saved.get(id).status, "partial");
  assert.equal(saved.get(id).properties[1].status, "pending");
  assert.equal(saved.get(id).properties[0].parcels[0].status, "lookup_failed");
  assert.equal(workspace.busy, false);
  available = true;
  await service.retry(id);
  await service.promise;
  assert.equal(calls, 3);
  assert.equal(saved.get(id).status, "completed");
});
test("retry does not report a previously interrupted extraction as complete", async () => {
  const { service, saved } = setup();
  const id = "00000000-0000-4000-8000-000000000001";
  saved.set(id, {
    id,
    status: "interrupted",
    extractionComplete: false,
    properties: [property()],
    warnings: [],
  });
  await service.retry(id);
  await service.promise;
  assert.equal(saved.get(id).status, "partial");
  assert.equal(saved.get(id).properties[0].status, "located");
});
test("source failure preserves prior records and releases the workspace", async () => {
  const { service, saved, workspace } = setup({
    extract: async (j, c, s, save) => {
      j.properties = [property()];
      await save(j);
      throw Error("source changed");
    },
  });
  const id = await service.start(request);
  await service.promise;
  assert.equal(saved.get(id).status, "failed");
  assert.equal(saved.get(id).properties.length, 1);
  assert.equal(workspace.busy, false);
});
test("a second retrieval cannot share the active browser form", async () => {
  let release;
  const { service } = setup({
    extract: async (j) => {
      await new Promise((r) => (release = r));
      j.extractionComplete = true;
    },
  });
  await service.start(request);
  await assert.rejects(service.start(request), /busy/);
  release();
  await service.promise;
});
test("cancellation preserves an honest cancelled status", async () => {
  const { service, saved } = setup({
    extract: async (j, c, signal) => {
      await new Promise((r) => setTimeout(r, 5));
      signal.throwIfAborted();
    },
  });
  const id = await service.start(request);
  service.cancel();
  await service.promise;
  assert.equal(saved.get(id).status, "cancelled");
});
