import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get, request } from "node:http";
import { createCatalogHttp } from "../server/presentation/catalog-http.mjs";

function send(url, headers, method = "GET", body) {
  return new Promise((resolve, reject) => {
    request(url, { headers, method }, async (response) => {
      try {
        const chunks = [];
        for await (const bytes of response) chunks.push(bytes);
        resolve(
          new Response(Buffer.concat(chunks), {
            status: response.statusCode,
            headers: response.headers,
          }),
        );
      } catch (error) {
        reject(error);
      }
    })
      .on("error", reject)
      .end(body);
  });
}

test("the full case review is read-only and uses the dedicated review use case", async (t) => {
  let calls = 0;
  const report = { version: 4, summary: { total: 2, matched: 1 }, items: [] };
  const app = createCatalogHttp({
    repository: {},
    caseReview: async () => {
      calls++;
      return report;
    },
    root: process.cwd(),
    evidencePath: process.cwd(),
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/facebook/cases/review`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), report);
  assert.equal(calls, 1);
  assert.match(response.headers.get("cache-control"), /no-store/);
});

test("expiry settings have an independent guarded endpoint", async (t) => {
  const received = [];
  const app = createCatalogHttp({
    repository: {},
    sync: {
      retention: async (value) => {
        received.push(value);
        return { retention: value };
      },
    },
    root: process.cwd(),
    evidencePath: process.cwd(),
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}/api/sync/retention`;
  const body = JSON.stringify({ retention: "bookmarked" });
  const denied = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body,
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(received, []);
  const saved = await fetch(url, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Land-Radar": "1" },
    body,
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { retention: "bookmarked" });
  assert.deepEqual(received, ["bookmarked"]);
});

test("database outages preserve server identity and malformed JSON stays out of alerts", async (t) => {
  const messages = [];
  const app = createCatalogHttp({
    repository: {
      health: async () => {
        throw Error("connection refused");
      },
      alert: async (message) => messages.push(message),
    },
    root: process.cwd(),
    evidencePath: process.cwd(),
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const url = `http://127.0.0.1:${server.address().port}`;
  const nonLocalHost = await new Promise((resolve, reject) => {
    get(url + "/api/health", { headers: { Host: "example.invalid" } }, (r) => {
      r.resume();
      resolve(r.statusCode);
    }).on("error", reject);
  });
  assert.equal(nonLocalHost, 403);
  const health = await fetch(url + "/api/health");
  assert.equal(health.status, 503);
  const healthBody = await health.json();
  assert.equal(healthBody.source, "LED + LandsMaps");
  assert.equal(healthBody.capabilities.facebookAlbumCoverage, true);
  assert.equal(healthBody.capabilities.facebookPublicExactDates, true);
  assert.equal(healthBody.capabilities.facebookAuctionSchedule, true);
  const malformed = await fetch(url + "/api/sync/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Land-Radar": "1" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "ข้อมูล JSON ไม่ถูกต้อง");
  assert.deepEqual(messages, []);
});

test("property views use shared Facebook albums and only the library endpoint can sync", async (t) => {
  const property = { id: "a".repeat(32) };
  let sharedReads = 0,
    refreshes = 0;
  const app = createCatalogHttp({
    repository: { getProperty: async () => property },
    facebook: {
      forProperty: async (p) => {
        assert.equal(p.id, property.id);
        sharedReads++;
        return { posts: [{ images: [{ url: "/evidence/fb-1-shared.jpg" }] }] };
      },
      start: async () => {
        refreshes++;
        return { photos: 1 };
      },
      library: async () => ({ groups: [{ date: "2026-11-05" }] }),
    },
    root: process.cwd(),
    evidencePath: process.cwd(),
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const detail = await fetch(`${base}/properties/${property.id}`);
  assert.equal(
    (await detail.json()).facebook.posts[0].images[0].url,
    "/evidence/fb-1-shared.jpg",
  );
  const headers = { "X-Land-Radar": "1" };
  const legacy = await fetch(`${base}/properties/${property.id}/facebook`, {
    method: "POST",
    headers,
  });
  assert.equal(legacy.status, 200);
  assert.equal(sharedReads, 2);
  assert.equal(refreshes, 0);
  const refreshed = await fetch(`${base}/facebook/library/refresh`, {
    method: "POST",
    headers,
  });
  assert.deepEqual(await refreshed.json(), { photos: 1 });
  assert.equal(refreshed.status, 202);
  assert.equal(refreshes, 1);
  const library = await fetch(base + "/facebook/library");
  assert.deepEqual((await library.json()).groups, [{ date: "2026-11-05" }]);
  const invalid = await fetch(base + "/facebook/library/refresh", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ date: "2026-02-30" }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(refreshes, 1);
});

test("the configured remote host requires credentials for the app, data and evidence", async (t) => {
  const hostname = "land-radar.example.test";
  const password = "example-remote-password-for-test";
  const authorization =
    "Basic " + Buffer.from("landradar:" + password).toString("base64");
  let starts = 0;
  const app = createCatalogHttp({
    repository: { health: async () => {} },
    sync: { start: async () => ({ started: ++starts }) },
    root: process.cwd(),
    evidencePath: process.cwd(),
    remoteAccess: { hostname, password },
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ["/", "/api/health", "/evidence/photo.jpg"]) {
    const response = await send(base + route, { Host: hostname });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /^Basic /);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  for (const headers of [
    { Host: "other.example.test", Authorization: authorization },
    { "CF-Ray": "test", Host: "localhost" },
  ]) {
    assert.equal((await send(base + "/api/health", headers)).status, 403);
  }
  assert.equal((await fetch(base + "/api/health")).status, 200);

  const headers = { Host: hostname, Authorization: authorization };
  assert.equal((await send(base + "/api/health", headers)).status, 200);
  const start = (extraHeaders) =>
    send(base + "/api/sync/start", { ...headers, ...extraHeaders }, "POST");
  assert.equal((await start({ Origin: "https://" + hostname })).status, 403);
  assert.equal(
    (
      await start({
        Origin: "https://other.example.test",
        "X-Land-Radar": "1",
      })
    ).status,
    403,
  );
  const started = await start({
    Origin: "https://" + hostname,
    "X-Land-Radar": "1",
  });
  assert.deepEqual(await started.json(), { started: 1 });
});

test("passwordless remote sessions use the same notes, edits and sync routes as local sessions", async (t) => {
  const hostname = "land-radar.example.test";
  const id = "a".repeat(32);
  const property = { id, user: { comment: "existing note", stars: 4 } };
  const app = createCatalogHttp({
    repository: {
      getProperty: async () => property,
      updateUser: async (propertyId, patch) => {
        assert.equal(propertyId, id);
        Object.assign(property.user, patch);
        return property;
      },
    },
    facebook: { forProperty: async () => ({ posts: [] }) },
    sync: { start: async () => ({ started: true }) },
    root: process.cwd(),
    evidencePath: process.cwd(),
    remoteAccess: { hostname, requirePassword: false },
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const url = `${base}/properties/${id}`;
  const detail = await send(url, { Host: hostname });
  assert.equal(detail.status, 200);
  assert.equal(detail.headers.get("www-authenticate"), null);
  assert.equal((await detail.json()).user.comment, "existing note");

  const headers = {
    Host: hostname,
    Origin: "https://" + hostname,
    "X-Land-Radar": "1",
  };
  const patch = JSON.stringify({ stars: 5 });
  const saved = await send(
    url + "/user",
    {
      ...headers,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(patch),
    },
    "PATCH",
    patch,
  );
  assert.equal(saved.status, 200);
  assert.equal((await saved.json()).user.stars, 5);

  const sync = base + "/sync/start";
  assert.equal((await send(sync, { Host: hostname }, "POST")).status, 403);
  assert.equal(
    (
      await send(
        sync,
        { ...headers, Origin: "https://other.example.test" },
        "POST",
      )
    ).status,
    403,
  );
  assert.deepEqual(await (await send(sync, headers, "POST")).json(), {
    started: true,
  });
});
