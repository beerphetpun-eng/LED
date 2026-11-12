export const clean = (v) =>
  String(v ?? "")
    .replace(/[\uFEFF\u00a0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
export function number(v) {
  const s = clean(v).replaceAll(",", "");
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}
export const district = (v) =>
  clean(v)
    .replace(/^(?:\d+-|กิ่งอำเภอ|อำเภอ|เขต)/, "")
    .split("(")[0]
    .trim();
export function area(c) {
  const n = c.slice(4, 7).map(number);
  return c.length === 11 && n.every((x) => x !== null)
    ? n[0] * 400 + n[1] * 100 + n[2]
    : null;
}
export function propertyArea(c) {
  if (/ห้องชุด/.test(c[3])) {
    const sqm = number(c[6]);
    return {
      areaSqWa: sqm === null ? null : sqm / 4,
      areaText: `${c[6]} ตร.ม. (พื้นที่ห้องชุด)`,
      areaUnit: "sqm",
    };
  }
  return {
    areaSqWa: area(c),
    areaText: `${c[4]} ไร่ ${c[5]} งาน ${c[6]} ตร.วา`,
    areaUnit: "sqwa",
  };
}
export function deeds(text) {
  const lines = [
    ...text.matchAll(
      /โฉนด(?:ที่ดิน)?(?:\s*เลขที่)?\s*[:：]?\s*([\d, /และ\-]+)/g,
    ),
  ];
  if (lines.some((m) => /[\/-]/.test(m[1]))) return [];
  return [...new Set(lines.flatMap((m) => m[1].match(/\d+/g) || []))];
}
export const dates = (text) => [
  ...new Set(text.match(/\b\d{2}\/\d{2}\/(?:25|26)\d{2}\b/g) || []),
];
export function meetsCriteria(p, values) {
  const min = number(values.rai),
    max = number(values.price_end);
  if (
    min !== null &&
    values.rai_if === "3" &&
    (p.areaSqWa === null || p.areaSqWa <= min * 400)
  )
    return false;
  if (max !== null && (p.price === null || p.price > max)) return false;
  return true;
}
export function landDocument(text) {
  return clean(
    text?.match(/(?:^|\n)ที่ดิน\s*\n([\s\S]*?)\nเนื้อที่/)?.[1] || "",
  );
}
export function coordinates(text) {
  const m = text.match(/(\d{1,2}\.\d+)\s*,\s*(\d{2,3}\.\d+)/);
  if (!m) return null;
  const latitude = Number(m[1]),
    longitude = Number(m[2]);
  return latitude >= 5 && latitude <= 21 && longitude >= 97 && longitude <= 106
    ? { latitude, longitude }
    : null;
}
export function validateValues(values) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw Error("รูปแบบตัวกรองไม่ถูกต้อง");
  for (const [k, v] of Object.entries(values))
    if (!/^[A-Za-z0-9_]+$/.test(k) || typeof v !== "string" || v.length > 250)
      throw Error("ตัวกรองไม่ถูกต้อง");
  for (const k of ["rai", "quaterrai", "wa", "price_begin", "price_end"])
    if (values[k] && number(values[k]) === null)
      throw Error("กรอกตัวเลขที่ไม่ติดลบ: " + k);
  if (
    values.price_begin &&
    values.price_end &&
    number(values.price_begin) > number(values.price_end)
  )
    throw Error("ราคาต่ำสุดต้องไม่เกินราคาสูงสุด");
  return values;
}
