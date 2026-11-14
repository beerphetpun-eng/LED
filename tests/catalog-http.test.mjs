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
  assert.equal((await health.json()).source, "LED + LandsMaps");
  const malformed = await fetch(url + "/api/sync/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Land-Radar": "1" },
    body: "{",
  });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error, "ข้อมูล JSON ไม่ถูกต้อง");
  assert.deepEqual(messages, []);
});
