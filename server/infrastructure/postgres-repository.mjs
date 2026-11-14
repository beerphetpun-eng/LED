import pg from "pg";
import { readFile } from "node:fs/promises";
import {
  combinedAuctionDates,
  mergeComponents,
} from "../domain/asset-components.mjs";
import { pricingVersion, withPricing } from "../domain/pricing.mjs";
import {
  defaultSettings,
  emptyUser,
  shouldExpire,
  validateUserPatch,
  filterProperties,
  missingParcelDeeds,
} from "../domain/catalog.mjs";
const local = JSON.parse(
  (
    await readFile(
      new URL("../appsettings.Local.json", import.meta.url),
      "utf8",
    )
  ).replace(/^\uFEFF/, ""),
);
const settings = Object.fromEntries(
  local.ConnectionStrings.Postgres.split(";")
    .filter(Boolean)
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i).toLowerCase(), x.slice(i + 1)];
    }),
);
export const pool = new pg.Pool({
  host: settings.host,
  port: Number(settings.port || 5432),
  database: settings.database,
  user: settings.username,
  password: settings.password,
  max: 4,
});
pool.on("error", (error) => {
  console.error("Idle PostgreSQL connection failed:", error);
});
export async function init() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS land_radar;
CREATE TABLE IF NOT EXISTS land_radar.bookmarks(id uuid PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS land_radar.jobs(id uuid PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS land_radar.properties(id text PRIMARY KEY, source jsonb NOT NULL, user_data jsonb NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS land_radar.sync_seen(id text PRIMARY KEY, first_seen timestamptz NOT NULL, last_seen timestamptz NOT NULL, last_run text NOT NULL, sync_count integer NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS land_radar.state(key text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS land_radar.file_gc(url text PRIMARY KEY);
CREATE TABLE IF NOT EXISTS land_radar.alerts(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, message text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), resolved boolean NOT NULL DEFAULT false);
ALTER TABLE land_radar.alerts ADD COLUMN IF NOT EXISTS check_key text UNIQUE;
ALTER TABLE land_radar.alerts ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT false;
ALTER TABLE land_radar.alerts ADD COLUMN IF NOT EXISTS retry_count integer;
ALTER TABLE land_radar.alerts ADD COLUMN IF NOT EXISTS checked_at timestamptz;
ALTER TABLE land_radar.alerts ADD COLUMN IF NOT EXISTS recovered_at timestamptz;
UPDATE land_radar.jobs SET data=jsonb_set(jsonb_set(data,'{status}','"interrupted"'),'{message}','"โปรแกรมปิดระหว่างทำงาน กรุณาเริ่มดึงใหม่ ข้อมูลที่บันทึกแล้วเปิดดูได้"') WHERE data->>'status' IN ('queued','searching','extracting','geocoding');`);
  await migratePricing();
}
export async function migratePricing() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id,source FROM land_radar.properties WHERE source->'pricing'->>'version' IS DISTINCT FROM $1 FOR UPDATE",
      [String(pricingVersion)],
    );
    for (const row of rows)
      await client.query(
        "UPDATE land_radar.properties SET source=$2 WHERE id=$1",
        [row.id, JSON.stringify(withPricing(row.source))],
      );
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
export async function health() {
  await pool.query("SELECT 1");
}
export async function close() {
  await pool.end();
}

export async function getState(key, fallback = null) {
  return (
    (await pool.query("SELECT data FROM land_radar.state WHERE key=$1", [key]))
      .rows[0]?.data ?? fallback
  );
}
export async function setState(key, data) {
  await pool.query(
    "INSERT INTO land_radar.state(key,data) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET data=EXCLUDED.data",
    [key, JSON.stringify(data)],
  );
}
export const getSettings = () => getState("sync_settings", defaultSettings());
export const saveSettings = (value) => setState("sync_settings", value);
export async function alert(message) {
  await pool.query(
    "INSERT INTO land_radar.alerts(message) SELECT $1 WHERE NOT EXISTS(SELECT 1 FROM land_radar.alerts WHERE message=$1 AND resolved=false)",
    [String(message).slice(0, 2000)],
  );
}
export async function alerts() {
  return (
    await pool.query(
      `SELECT id::text,message,created_at AS "createdAt",
        (retryable OR (check_key IS NULL AND message LIKE 'ทรัพย์ %ภาพประกาศยังโหลดไม่ครบ%')) AS retryable,
        retry_count AS "retryCount",checked_at AS "checkedAt",recovered_at AS "recoveredAt"
      FROM land_radar.alerts WHERE resolved=false
        AND message NOT LIKE 'LandsMaps จำกัดจำนวนการค้นหา:%'
        AND message NOT LIKE 'LandsMaps แจ้งเกินโควตา%'
        AND message NOT LIKE 'LandsMaps ยังอยู่ในช่วงรอโควตา%'
      ORDER BY recovered_at IS NOT NULL, COALESCE(checked_at,created_at) DESC,id DESC`,
    )
  ).rows;
}
export async function recordCheck({
  key,
  message,
  retryable,
  attempts,
  legacyPrefix,
  recoveryMessage = null,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: legacy } = await client.query(
      `UPDATE land_radar.alerts SET resolved=true
        WHERE check_key IS NULL AND NOT resolved AND left(message,length($1))=$1
        RETURNING message`,
      [legacyPrefix],
    );
    const failure = message?.slice(0, 2000) || null;
    await client.query(
      `INSERT INTO land_radar.alerts (check_key,message,retryable,retry_count,checked_at,recovered_at)
       SELECT $1,COALESCE($2,$3,previous.message,$6),$4,
         CASE WHEN $3::text IS NOT NULL THEN $5 ELSE GREATEST(0,$5-1) END,now(),
         CASE WHEN $2::text IS NULL THEN now() END
       FROM (SELECT (SELECT message FROM land_radar.alerts WHERE check_key=$1) AS message) previous
       WHERE COALESCE($2,$3,previous.message,$6) IS NOT NULL
       ON CONFLICT (check_key) DO UPDATE SET
         message=EXCLUDED.message,retryable=EXCLUDED.retryable,checked_at=now(),
         retry_count=CASE WHEN land_radar.alerts.recovered_at IS NULL
           THEN COALESCE(land_radar.alerts.retry_count,0)+$5 ELSE EXCLUDED.retry_count END,
         recovered_at=EXCLUDED.recovered_at,resolved=false
       WHERE $2::text IS NOT NULL OR land_radar.alerts.recovered_at IS NULL`,
      [
        key,
        failure,
        legacy[0]?.message || null,
        retryable,
        attempts,
        recoveryMessage,
      ],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function resolveAlert(id) {
  await pool.query("UPDATE land_radar.alerts SET resolved=true WHERE id=$1", [
    id,
  ]);
}
function files(value, found = new Set()) {
  if (
    typeof value === "string" &&
    /^\/evidence\/[a-zA-Z0-9_-]+\.(png|jpg|webp)$/.test(value)
  )
    found.add(value);
  else if (Array.isArray(value)) value.forEach((v) => files(v, found));
  else if (value && typeof value === "object")
    Object.values(value).forEach((v) => files(v, found));
  return [...found];
}
async function queueFiles(client, urls) {
  for (const url of urls)
    await client.query(
      "INSERT INTO land_radar.file_gc(url) VALUES($1) ON CONFLICT DO NOTHING",
      [url],
    );
}
export async function upsertProperty(source, runId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO land_radar.sync_seen(id,first_seen,last_seen,last_run) VALUES($1,now(),now(),$2)
      ON CONFLICT(id) DO UPDATE SET last_seen=now(),last_run=$2,sync_count=land_radar.sync_seen.sync_count+CASE WHEN land_radar.sync_seen.last_run<>$2 THEN 1 ELSE 0 END`,
      [source.id, runId],
    );
    const old = (
      await client.query(
        "SELECT source,user_data FROM land_radar.properties WHERE id=$1 FOR UPDATE",
        [source.id],
      )
    ).rows[0];
    const sameParcel =
      old &&
      ["deed", "province", "district", "subdistrict"].every(
        (k) => old.source[k] === source[k],
      );
    let merged =
      source.status === "failed" && old
        ? { ...old.source, error: source.error }
        : {
            ...source,
            parcels: sameParcel ? old.source.parcels || [] : [],
            facebook: old?.source.facebook || null,
          };
    if (source.status !== "failed")
      merged = mergeComponents(old?.source, merged);
    // Expiration runs after the full extraction, when all bundled rows are known.
    merged = withPricing(merged);
    if (merged.deed && !missingParcelDeeds(merged).length)
      merged.status = "located";
    if (old)
      await queueFiles(
        client,
        files(old.source).filter((url) => !files(merged).includes(url)),
      );
    await client.query(
      `INSERT INTO land_radar.properties(id,source,user_data) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET source=EXCLUDED.source`,
      [source.id, JSON.stringify(merged), JSON.stringify(emptyUser())],
    );
    await client.query("COMMIT");
    return merged;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
function hydrate(row) {
  return {
    ...withPricing(row.source),
    auctionDates: combinedAuctionDates(row.source),
    user: { ...emptyUser(), ...row.user_data },
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    syncCount: row.sync_count,
  };
}
const propertySelect =
  "SELECT p.*,s.first_seen,s.last_seen,s.sync_count FROM land_radar.properties p LEFT JOIN land_radar.sync_seen s ON s.id=p.id";
export async function getProperty(id) {
  const row = (await pool.query(propertySelect + " WHERE p.id=$1", [id]))
    .rows[0];
  return row ? hydrate(row) : null;
}
export async function allProperties() {
  return (
    await pool.query(propertySelect + " ORDER BY s.last_seen DESC,p.id")
  ).rows.map(hydrate);
}
export async function queryProperties(filters) {
  const all = await allProperties(),
    items = filterProperties(all, filters);
  const summary = items.map(
    ({ rawText, sourceRow, facebook, assetComponents, ...p }) => ({
      ...p,
      assetComponentCount: assetComponents?.length || 1,
      facebook: facebook
        ? { checkedAt: facebook.checkedAt, count: facebook.posts?.length || 0 }
        : null,
    }),
  );
  return {
    items: summary,
    total: all.length,
    facets: {
      provinces: [...new Set(all.map((p) => p.province))].sort(),
      districts: [
        ...new Set(
          all
            .filter((p) => !filters.province || p.province === filters.province)
            .map((p) => p.district),
        ),
      ].sort(),
      types: [...new Set(all.map((p) => p.propertyType))].sort(),
      maxPrice: all.reduce((max, p) => Math.max(max, p.pricing.total || 0), 0),
      maxRai: all.reduce((max, p) => Math.max(max, (p.areaSqWa || 0) / 400), 0),
    },
  };
}
export async function updateUser(id, data) {
  const user = validateUserPatch(data);
  const r = await pool.query(
    "UPDATE land_radar.properties SET user_data=user_data || $2::jsonb WHERE id=$1 RETURNING id",
    [id, JSON.stringify(user)],
  );
  if (!r.rowCount) throw Error("ไม่พบทรัพย์ อาจหมดอายุและถูกลบแล้ว");
  return getProperty(id);
}
export async function updateSource(id, patch) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const old = (
      await client.query(
        "SELECT source FROM land_radar.properties WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0]?.source;
    if (!old) {
      await queueFiles(client, files(patch));
      await client.query("COMMIT");
      throw Error("ทรัพย์ถูกลบแล้ว ไม่สามารถบันทึกหลักฐานเพิ่มได้");
    }
    const merged = withPricing({ ...old, ...patch });
    await queueFiles(
      client,
      files(old).filter((url) => !files(merged).includes(url)),
    );
    await client.query(
      "UPDATE land_radar.properties SET source=$2 WHERE id=$1",
      [id, JSON.stringify(merged)],
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function expireProperties(retention) {
  const client = await pool.connect();
  let count = 0;
  try {
    await client.query("BEGIN");
    const rows = (
      await client.query("SELECT * FROM land_radar.properties FOR UPDATE")
    ).rows;
    for (const row of rows)
      if (shouldExpire({ ...row.source, user: row.user_data }, retention)) {
        await queueFiles(client, files(row.source));
        await client.query("DELETE FROM land_radar.properties WHERE id=$1", [
          row.id,
        ]);
        count++;
      }
    await client.query("COMMIT");
    return count;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
export async function pendingFiles() {
  return (await pool.query("SELECT url FROM land_radar.file_gc")).rows.map(
    (r) => r.url,
  );
}
export async function fileReferenced(url) {
  return !!(
    await pool.query(
      "SELECT 1 FROM land_radar.properties WHERE position($1 in source::text)>0 LIMIT 1",
      [url],
    )
  ).rowCount;
}
export async function completeFile(url) {
  await pool.query("DELETE FROM land_radar.file_gc WHERE url=$1", [url]);
}
