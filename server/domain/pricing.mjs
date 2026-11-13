import { clean } from "./parsing.mjs";

export const pricingVersion = 1;
const normalize = (text) =>
  clean(text)
    .replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50))
    .replace(/[\u200b-\u200f]/g, "");

// Money is calculated in satang. Only the appraisal receives a discount.
function satang(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    return null;
  const n = Math.round(value * 100);
  return Number.isSafeInteger(n) ? n : null;
}
export function propertyPricing(property) {
  const parts = property.assetComponents?.length
    ? property.assetComponents
    : [property];
  const clauses = [
    ...new Set(
      parts.map((p) => {
        const text = normalize(p.rawText || "");
        return (
          text.match(/จะทำการขายโดย\s*(.*?)(?=ราคาประเมิน|$)/)?.[1]?.trim() ||
          ""
        );
      }),
    ),
  ];
  const carriesMortgage = clauses.some((s) => /(?:การ)?จำนอง\s*ติดไป/.test(s));
  let debt = 0,
    warning = null;
  if (clauses.includes("")) {
    debt = null;
    warning = "ยังอ่านเงื่อนไขการขายไม่ครบ จึงยังคำนวณราคารวมไม่ได้";
  } else if (carriesMortgage) {
    // A bundled announcement repeats the same loan on each asset page. Count it
    // once; differing clauses need review rather than guessing which debts add up.
    const matches = [...clauses[0].matchAll(/ยอดหนี้จำนอง\s*([^\s]+)\s*บาท/g)];
    const amount = matches[0]?.[1];
    if (
      clauses.length !== 1 ||
      matches.length !== 1 ||
      !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(amount || "")
    ) {
      debt = null;
      warning =
        "มีการจำนองติดไป แต่ยอดหนี้ไม่ชัดเจนหรือเงื่อนไขทรัพย์ย่อยต่างกัน กรุณาตรวจประกาศต้นฉบับ";
    } else {
      debt = satang(Number(amount.replaceAll(",", "")));
      if (debt === null)
        warning = "ยอดหนี้จำนองอยู่นอกช่วงที่คำนวณได้ กรุณาตรวจประกาศต้นฉบับ";
    }
  }
  const appraisal = satang(property.price);
  if (appraisal === null)
    warning ||= "ยังอ่านราคาประเมินไม่ได้ จึงยังคำนวณราคารวมไม่ได้";
  const options = [0, 10, 20, 30].map((discount) => {
    const discounted =
      appraisal === null
        ? null
        : Number((BigInt(appraisal) * BigInt(100 - discount) + 50n) / 100n);
    const sum = discounted === null || debt === null ? null : discounted + debt;
    const total = Number.isSafeInteger(sum) ? sum / 100 : null;
    if (sum !== null && total === null)
      warning ||= "ราคารวมอยู่นอกช่วงที่คำนวณได้";
    return {
      discount,
      appraisal: discounted === null ? null : discounted / 100,
      total,
    };
  });
  return {
    version: pricingVersion,
    appraisal: appraisal === null ? null : appraisal / 100,
    carriesMortgage,
    mortgageDebt: debt === null ? null : debt / 100,
    total: options[0].total,
    options,
    warning,
    mortgageClause: carriesMortgage ? clauses.filter(Boolean).join("\n") : null,
  };
}

export const withPricing = (property) => ({
  ...property,
  pricing: propertyPricing(property),
});
