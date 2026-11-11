import pg from "pg";
import { readFile } from "node:fs/promises";
import { landDocument } from "../domain/parsing.mjs";
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
export async function init() {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS land_radar;
CREATE TABLE IF NOT EXISTS land_radar.bookmarks(id uuid PRIMARY KEY,data jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS land_radar.jobs(id uuid PRIMARY KEY,data jsonb NOT NULL);
UPDATE land_radar.jobs SET data=jsonb_set(jsonb_set(data,'{status}','"interrupted"'),'{message}','"โปรแกรมปิดระหว่างทำงาน กรุณาเริ่มดึงใหม่ ข้อมูลที่บันทึกแล้วเปิดดูได้"') WHERE data->>'status' IN ('queued','searching','extracting','geocoding');`);
}
export async function saveJob(job) {
  await pool.query(
    "INSERT INTO land_radar.jobs(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
    [job.id, JSON.stringify(job)],
  );
}
export async function getJob(id) {
  const job = (
    await pool.query("SELECT data FROM land_radar.jobs WHERE id=$1", [id])
  ).rows[0]?.data;
  if (job)
    for (const property of job.properties)
      property.landDocument ??= landDocument(property.rawText);
  return job;
}
export async function listJobs() {
  return (
    await pool.query(
      `SELECT jsonb_build_object('id',id,'name',data->>'name','status',data->>'status','createdAt',data->>'createdAt','count',jsonb_array_length(data->'properties')) AS data FROM land_radar.jobs ORDER BY data->>'createdAt' DESC`,
    )
  ).rows.map((x) => x.data);
}
export async function listBookmarks() {
  return (
    await pool.query(
      `SELECT data FROM land_radar.bookmarks ORDER BY data->>'savedAt' DESC`,
    )
  ).rows.map((x) => x.data);
}
export async function saveBookmark(b) {
  await pool.query(
    "INSERT INTO land_radar.bookmarks(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data",
    [b.id, JSON.stringify(b)],
  );
}
export async function deleteBookmark(id) {
  await pool.query("DELETE FROM land_radar.bookmarks WHERE id=$1", [id]);
}

export async function health() {
  await pool.query("SELECT 1");
}
export async function close() {
  await pool.end();
}
