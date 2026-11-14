import { createHash } from "node:crypto";
import { clean } from "./parsing.mjs";
export function componentKey(identity) {
  const values = [
    identity?.sourceAssetId,
    identity?.address,
    identity?.documentDeed,
  ].map(clean);
  return values.some(Boolean)
    ? createHash("sha256")
        .update(JSON.stringify(values))
        .digest("hex")
        .slice(0, 20)
    : "primary";
}
export function combinedAuctionDates(property) {
  const dates = (item) =>
    Array.isArray(item.auctionDates) ? item.auctionDates : [];
  return [
    ...new Set([
      ...dates(property),
      ...(property.assetComponents || []).flatMap(dates),
    ]),
  ];
}
export function mergeComponents(previous, incoming) {
  if (!incoming.componentKey || !incoming.rawText || !incoming.screenshotUrl)
    return incoming;
  const {
    assetComponents,
    parcels,
    facebook,
    user,
    firstSeen,
    lastSeen,
    syncCount,
    ...component
  } = incoming;
  const components = new Map(
    (previous?.assetComponents || []).map((c) => [c.componentKey, c]),
  );
  components.set(component.componentKey, component);
  const values = [...components.values()];
  const deeds = [
    ...new Set(
      values.flatMap((c) => c.deed?.split(", ").filter(Boolean) || []),
    ),
  ];
  const total = values.every((c) => Number.isFinite(c.areaSqWa))
    ? values.reduce((n, c) => n + c.areaSqWa, 0)
    : null;
  const allSqm = values.every((c) => c.areaUnit === "sqm");
  const auctionDates = combinedAuctionDates({ assetComponents: values });
  return {
    ...incoming,
    assetComponents: values,
    deed: deeds.join(", "),
    areaSqWa: total,
    auctionDates,
    areaText:
      values.length === 1
        ? component.areaText
        : `ขายรวม ${values.length} รายการย่อย${total === null ? "" : ` · รวม ${Number((total * (allSqm ? 4 : 1)).toFixed(2)).toLocaleString("th-TH")} ${allSqm ? "ตร.ม." : "ตร.วา"}`}`,
    screenshotUrl: values[0].screenshotUrl,
    evidenceImages: values[0].evidenceImages,
    evidenceReady: values.every((c) => c.evidenceReady === true),
    parcels: (
      (previous &&
      ["province", "district", "subdistrict"].every(
        (k) => previous[k] === incoming[k],
      )
        ? previous.parcels
        : incoming.parcels) || []
    ).filter((p) => deeds.includes(p.deed)),
  };
}
