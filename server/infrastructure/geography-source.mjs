import { readFile, writeFile, mkdir } from "node:fs/promises";
import { clean } from "../domain/parsing.mjs";
const cache = new URL("../data/geography.json", import.meta.url);
function options(html) {
  return [
    ...html.matchAll(
      /<option\b[^>]*value\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi,
    ),
  ]
    .map((m) => ({
      code: m[1],
      name: clean(m[2].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&")),
    }))
    .filter((x) => /^\d+$/.test(x.code) && x.name);
}
async function html(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw Error("อ่านรายชื่อจังหวัด/อำเภอไม่สำเร็จ HTTP " + r.status);
  return r.text();
}
export async function loadGeography(refresh = false) {
  if (!refresh)
    try {
      return JSON.parse(await readFile(cache, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      try {
        return JSON.parse(
          await readFile(
            new URL("../reference/geography.json", import.meta.url),
            "utf8",
          ),
        );
      } catch (seed) {
        if (seed.code !== "ENOENT") throw seed;
      }
    }
  const page = await html("https://asset.led.go.th/newbidreg/default.asp");
  const select = page.match(
    /<select[^>]*id=["']provinces["'][^>]*>([\s\S]*?)<\/select>/i,
  )?.[1];
  if (!select) throw Error("ไม่พบรายชื่อจังหวัดในต้นทาง");
  const provinces = [
    ...new Map(options(select).map((p) => [p.code, p])).values(),
  ];
  if (provinces.length < 70)
    throw Error("รายชื่อจังหวัดไม่ครบ จึงยังไม่แทนที่ข้อมูลเดิม");
  for (const p of provinces) {
    p.districts = options(
      await html(
        "https://asset.led.go.th/newbidreg/get_amphur.asp?provinceId=" + p.code,
      ),
    );
    if (!p.districts.length) throw Error("ไม่พบอำเภอของ " + p.name);
  }
  const result = { updatedAt: new Date().toISOString(), provinces };
  await mkdir(new URL("../data/", import.meta.url), { recursive: true });
  await writeFile(cache, JSON.stringify(result));
  return result;
}
