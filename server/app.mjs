import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import {
  BrowserService,
  root,
  evidencePath,
} from "./infrastructure/browser-service.mjs";
import * as db from "./infrastructure/postgres-repository.mjs";
import { createLedSource } from "./infrastructure/led-source.mjs";
import { createLandsMapsGeocoder } from "./infrastructure/landsmaps-geocoder.mjs";
import { createRetrievalService } from "./application/retrieval-service.mjs";
import { createHttpApp } from "./presentation/http-app.mjs";
await db.init();
await mkdir(evidencePath, { recursive: true });
const browser = new BrowserService();
const retrieval = createRetrievalService({
  repository: db,
  source: createLedSource(browser),
  geocoder: createLandsMapsGeocoder(browser),
  workspace: browser,
});
const app = createHttpApp({
  repository: db,
  browser,
  retrieval,
  root,
  evidencePath,
});
const server = app.listen(5080, "127.0.0.1", () => {
  console.log("Land Radar: http://127.0.0.1:5080");
  if (process.argv.includes("--open"))
    execFile(
      "explorer.exe",
      ["http://127.0.0.1:5080"],
      { windowsHide: true },
      () => {},
    );
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  retrieval.cancel();
  server.close();
  await retrieval.promise;
  await browser.close();
  await db.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
