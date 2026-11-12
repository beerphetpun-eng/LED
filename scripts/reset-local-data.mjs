import { readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as db from "../server/infrastructure/postgres-repository.mjs";
if (!process.argv.includes("--confirm-reset"))
  throw Error(
    "Pass --confirm-reset only for an explicitly authorized reset. Stop the application first.",
  );
let active = false;
try {
  active = (
    await fetch("http://127.0.0.1:5080/api/health", {
      signal: AbortSignal.timeout(1000),
    })
  ).ok;
} catch {}
if (active) throw Error("Stop Land Radar before resetting its data.");
const directory = fileURLToPath(
  new URL("../server/data/evidence/", import.meta.url),
);
try {
  await db.init();
  const count = (
    await db.pool.query(
      "SELECT (SELECT count(*) FROM land_radar.jobs)::int AS jobs,(SELECT count(*) FROM land_radar.properties)::int AS properties",
    )
  ).rows[0];
  await db.pool.query(
    "TRUNCATE land_radar.jobs,land_radar.bookmarks,land_radar.properties,land_radar.sync_seen,land_radar.state,land_radar.file_gc,land_radar.alerts RESTART IDENTITY",
  );
  let images = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(
    (e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    },
  )) {
    const target = path.resolve(directory, entry.name);
    if (
      !entry.isFile() ||
      !/^[-a-zA-Z0-9_]+\.(png|jpg|webp)$/.test(entry.name) ||
      path.dirname(target) !== path.resolve(directory)
    )
      throw Error("Unexpected evidence file; stopped deletion: " + entry.name);
    await unlink(target);
    images++;
  }
  console.log(
    JSON.stringify({
      reset: count,
      removedImages: images,
      defaultScope: "Chiang Mai / Mueang Chiang Mai",
    }),
  );
} finally {
  await db.close();
}
