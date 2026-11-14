import type { Property } from "./catalog-types";
import areaPoints from "./thailand-area-points.tsv?raw";

type Point = { latitude: number; longitude: number };
export type ApproximateLocation = Point & { area: string };

const subdistrictPoints = new Map<string, Point>();
const districtTotals = new Map<string, Point & { count: number }>();
const areaKey = (...names: string[]) => names.join("|");

for (const row of areaPoints.trim().split(/\r?\n/)) {
  const [province, district, subdistrict, lat, lon] = row.split("\t");
  const point = { latitude: Number(lat), longitude: Number(lon) };
  const districtKey = areaKey(province, district);
  subdistrictPoints.set(areaKey(districtKey, subdistrict), point);
  const total = districtTotals.get(districtKey) ?? {
    latitude: 0,
    longitude: 0,
    count: 0,
  };
  total.latitude += point.latitude;
  total.longitude += point.longitude;
  total.count++;
  districtTotals.set(districtKey, total);
}

export function approximateLocation(
  property: Property,
): ApproximateLocation | null {
  const document = (property.landDocument || "").replace(/[.\s]/g, "");
  if (
    property.deed ||
    !property.propertyType.includes("ที่ดิน") ||
    !/(?:นส3|สค1|สปก|นค3|กสน5|ตราจอง|ใบจอง|ใบไต่สวน)/.test(document)
  )
    return null;

  const province = property.province.trim().replace(/^(?:จังหวัด|จ\.)\s*/, "");
  let district = property.district
    .trim()
    .replace(/^(?:อำเภอ|อ\.|เขต)\s*/, "")
    .split("(")[0]
    .trim();
  const subdistrict = property.subdistrict
    .trim()
    .replace(/^(?:ตำบล|ต\.|แขวง)\s*/, "")
    .split("(")[0]
    .trim();
  // Some LED announcements still use the former district for these tambons.
  if (
    province === "เชียงใหม่" &&
    district === "สันกำแพง" &&
    ["ออนเหนือ", "แม่ทา"].includes(subdistrict)
  )
    district = "แม่ออน";

  const districtKey = areaKey(province, district);
  const point = subdistrictPoints.get(areaKey(districtKey, subdistrict));
  if (point)
    return { ...point, area: `ต.${subdistrict} อ.${district} จ.${province}` };
  const total = districtTotals.get(districtKey);
  if (!total) return null;
  return {
    latitude: total.latitude / total.count,
    longitude: total.longitude / total.count,
    area: `อ.${district} จ.${province}`,
  };
}
