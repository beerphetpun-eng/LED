import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get, request } from "node:http";
import { createCatalogHttp } from "../server/presentation/catalog-http.mjs";

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
      refresh: async () => {
        refreshes++;
        return { photos: 1 };
      },
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
  const send = (route, headers, method = "GET") =>
    new Promise((resolve, reject) => {
      request(base + route, { headers, method }, async (response) => {
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
        .end();
    });

  for (const route of ["/", "/api/health", "/evidence/photo.jpg"]) {
    const response = await send(route, { Host: hostname });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /^Basic /);
    assert.match(response.headers.get("cache-control"), /no-store/);
  }
  for (const headers of [
    { Host: "other.example.test", Authorization: authorization },
    { "CF-Ray": "test", Host: "localhost" },
  ]) {
    assert.equal((await send("/api/health", headers)).status, 403);
  }
  assert.equal((await fetch(base + "/api/health")).status, 200);

  const headers = { Host: hostname, Authorization: authorization };
  assert.equal((await send("/api/health", headers)).status, 200);
  const start = (extraHeaders) =>
    send("/api/sync/start", { ...headers, ...extraHeaders }, "POST");
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
