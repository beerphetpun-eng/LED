import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { get } from "node:http";
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

test("passes an explicitly selected public post without allowing a date range or sign-in", async (t) => {
  const property = { id: "a".repeat(32) };
  const post = "https://web.facebook.com/ledcm2/posts/example";
  let search;
  const app = createCatalogHttp({
    repository: {
      getProperty: async () => property,
      updateSource: async () => {},
    },
    facebook: {
      search: async (...args) => {
        search = args;
        return { posts: [post], warnings: [] };
      },
    },
    root: process.cwd(),
    evidencePath: process.cwd(),
  });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => server.close());
  await once(server, "listening");
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/properties/${property.id}/facebook`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Land-Radar": "1" },
      body: JSON.stringify({ postUrl: post + "?ref=feed", nearbyDays: 7 }),
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(search, [property, { postUrls: [post] }]);
  const signIn = await fetch(
    `http://127.0.0.1:${server.address().port}/api/facebook/sign-in`,
    {
      method: "POST",
      headers: { "X-Land-Radar": "1" },
    },
  );
  assert.equal(signIn.status, 404);
});
