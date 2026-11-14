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
import { createSyncService } from "./application/sync-service.mjs";
import { createCatalogHttp } from "./presentation/catalog-http.mjs";
import { createEvidenceStore } from "./infrastructure/evidence-store.mjs";
import { loadGeography } from "./infrastructure/geography-source.mjs";
import { createFacebookSource } from "./infrastructure/facebook-source.mjs";
await db.init();
await mkdir(evidencePath, { recursive: true });
const browser = new BrowserService();
const geography = await loadGeography();
const sync = createSyncService({
  repository: db,
  source: createLedSource(browser, { findExisting: db.getProperty }),
  geocoder: createLandsMapsGeocoder(browser),
  files: createEvidenceStore(evidencePath),
  geography,
});
await sync.init();
const app = createCatalogHttp({
  repository: db,
  sync,
  geography,
  facebook: createFacebookSource(evidencePath),
  root,
  evidencePath,
});
const server = app.listen(5080, "127.0.0.1", (error) => {
  if (error) throw error;
  console.log("Land Radar: http://127.0.0.1:5080");
  sync.schedule();
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
  sync.cancel();
  server.close();
  await browser.close();
  await sync.stop();
  await db.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (process.send)
  process.on("message", (message) => {
    if (message === "shutdown") void stop();
  });
