import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
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
import { createFacebookCaseIndex } from "./infrastructure/facebook-case-index.mjs";
const remoteAccess = await readFile(
  new URL("./data/remote-access.json", import.meta.url),
  "utf8",
)
  .then(JSON.parse)
  .catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
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
const facebookCases = createFacebookCaseIndex({
  evidencePath,
  read: (url) => db.getState("facebook_cases_v1:" + url),
  write: (url, index) => db.setState("facebook_cases_v1:" + url, index),
});
const facebook = createFacebookSource(evidencePath, {
  caseIndex: facebookCases,
  postIndex: {
    read: () => db.getState("facebook_public_posts", { posts: [] }),
    write: (data) => db.setState("facebook_public_posts", data),
  },
  async readCatalog() {
    const properties = await db.allProperties();
    return {
      dates: [
        ...new Set(
          properties.flatMap((property) => property.auctionDates || []),
        ),
      ],
      legacy: properties.flatMap((property) => property.facebook?.posts || []),
    };
  },
});
const app = createCatalogHttp({
  repository: db,
  sync,
  geography,
  facebook,
  root,
  evidencePath,
  remoteAccess,
});
const server = app.listen(5080, "127.0.0.1", (error) => {
  if (error) throw error;
  console.log("Land Radar: http://127.0.0.1:5080");
  sync.schedule();
  facebook.scheduleIndex();
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
  server.close();
  await Promise.all([
    sync.stop(),
    browser.close(),
    facebook.stopIndex(),
    facebookCases.stop(),
  ]);
  await db.close();
  process.exit();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
if (process.send)
  process.on("message", (message) => {
    if (message === "shutdown") void stop();
  });
