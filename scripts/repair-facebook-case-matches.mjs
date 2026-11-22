import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { pool, close } from "../server/infrastructure/postgres-repository.mjs";

// Original images remain available for rebuilding the version 2 OCR index.
function clearMatches(value) {
  if (Array.isArray(value)) return value.map(clearMatches);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) => !["caseBoxes", "rowMatched", "caseFilter"].includes(key),
      )
      .map(([key, child]) => [key, clearMatches(child)]),
  );
}

function repairSource(source) {
  return {
    ...source,
    ...(source.facebook && { facebook: clearMatches(source.facebook) }),
    ...(source.assetComponents && {
      assetComponents: source.assetComponents.map(repairSource),
    }),
  };
}

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('land_radar.facebook_case_repair_v2'))",
  );
  const { rows } = await client.query(
    "SELECT id, source FROM land_radar.properties FOR UPDATE",
  );
  const changed = rows.flatMap((row) => {
    const repaired = repairSource(row.source);
    return JSON.stringify(repaired) === JSON.stringify(row.source)
      ? []
      : [{ ...row, repaired }];
  });
  const { rows: oldIndex } = await client.query(
    "SELECT key, data FROM land_radar.state WHERE key LIKE 'facebook_cases_v1:%' FOR UPDATE",
  );
  let backup = null;
  if (changed.length || oldIndex.length) {
    const directory = fileURLToPath(
      new URL("../server/data/", import.meta.url),
    );
    await mkdir(directory, { recursive: true });
    backup = path.join(directory, `facebook-case-repair-${Date.now()}.json`);
    await writeFile(
      backup,
      JSON.stringify({
        properties: changed.map(({ id, source }) => ({ id, source })),
        oldIndex,
      }),
      { flag: "wx" },
    );
    for (const row of changed)
      await client.query(
        "UPDATE land_radar.properties SET source=$2 WHERE id=$1",
        [row.id, JSON.stringify(row.repaired)],
      );
    await client.query(
      "DELETE FROM land_radar.state WHERE key LIKE 'facebook_cases_v1:%'",
    );
  }
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      repairedProperties: changed.length,
      discardedOldIndexes: oldIndex.length,
      backup,
    }),
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await close();
}
