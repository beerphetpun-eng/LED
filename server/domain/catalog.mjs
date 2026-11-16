import { createHash } from "node:crypto";
import { clean } from "./parsing.mjs";
import { propertyPricing } from "./pricing.mjs";

export const emptyUser = () => ({
  bookmarked: false,
  stars: 0,
  comment: "",
  auctionStatus: "",
  protected: false,
});
export const defaultSettings = () => ({
  enabled: true,
  intervalHours: 168,
  duplicatePolicy: "skip_unchanged",
  scopes: [{ provinceCode: "50", districtCodes: ["5001"] }],
  retention: "manual",
});
export function missingParcelDeeds(property) {
  return (property.deed || "")
    .split(", ")
    .filter(Boolean)
    .filter(
      (deed) =>
        !(property.parcels || []).some(
          (p) =>
            p.deed === deed &&
            p.status === "located" &&
            Number.isFinite(p.latitude) &&
            Number.isFinite(p.longitude) &&
            p.mapEvidenceUrl &&
            p.backgroundReady !== false,
        ),
    );
}
export function propertyId(row) {
  if (![row[0], row[1], row[2], row[10]].every((v) => clean(v)))
    throw Error("ต้นทางไม่มีรหัสชุด/ลำดับ/คดี/จังหวัดสำหรับแยกทรัพย์");
  return createHash("sha256")
    .update(
      ["LED", row[0], row[1], row[2], row[10]]
        .map((v) => clean(v).replace(/\s/g, ""))
        .join("|"),
    )
    .digest("hex")
    .slice(0, 32);
}
export function detailIdentity(raw, row) {
  return {
    assetSequence: clean(
      raw.match(/ทรัพย์ที่จะขาย\s*ลำดับที่\s*([^\n]+)/)?.[1] || row[1],
    ),
    caseNumber: clean(
      raw.match(/คดีหมายเลขแดงที่\s*\n([^\n]+)/)?.[1] || row[2],
    ),
    plaintiff: clean(raw.match(/(?:^|\n)โจทก์\s*\n([^\n]+)/)?.[1]),
    saleLot: clean(row[0]),
  };
}
export function auctionISO(value) {
  const m = String(value).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const y = +m[3] > 2400 ? +m[3] - 543 : +m[3],
    month = +m[2],
    day = +m[1];
  const date = new Date(Date.UTC(y, month - 1, day));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return date.toISOString().slice(0, 10);
}
export function bangkokDay(now = new Date()) {
  return new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
}
export function expiryDay(dates) {
  if (!Array.isArray(dates) || !dates.length) return null;
  const parsed = dates.map(auctionISO);
  if (parsed.some((v) => !v)) return null; // Incomplete/invalid dates must never trigger deletion.
  const [y, m, d] = parsed.sort().at(-1).split("-").map(Number);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}
export function shouldExpire(
  property,
  retention = "manual",
  today = bangkokDay(),
) {
  const u = { ...emptyUser(), ...property.user };
  if (
    u.protected ||
    (retention === "bookmarked" && u.bookmarked) ||
    (retention === "engaged" &&
      (u.bookmarked || u.stars > 0 || u.comment?.trim()))
  )
    return false;
  const schedules = [
    property.auctionDates,
    ...(property.assetComponents || []).map((part) => part.auctionDates),
  ];
  return schedules.every((dates) => {
    const expires = expiryDay(dates);
    return !!expires && today > expires;
  });
}
export function validateUser(input) {
  if (!input || typeof input !== "object")
    throw Error("ข้อมูลบันทึกส่วนตัวไม่ถูกต้อง");
  const u = { ...emptyUser(), ...input };
  if (
    typeof u.bookmarked !== "boolean" ||
    typeof u.protected !== "boolean" ||
    !Number.isInteger(u.stars) ||
    u.stars < 0 ||
    u.stars > 5 ||
    typeof u.comment !== "string" ||
    u.comment.length > 10000 ||
    !["", "auctioning", "ended"].includes(u.auctionStatus)
  )
    throw Error("ดาวต้องเป็น 0–5 และสถานะ/คอมเมนต์ต้องถูกต้อง");
  return Object.fromEntries(Object.keys(emptyUser()).map((k) => [k, u[k]]));
}
export function validateUserPatch(input) {
  const keys = Object.keys(emptyUser());
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Object.keys(input).length ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw Error("ข้อมูลบันทึกส่วนตัวไม่ถูกต้อง");
  const validated = validateUser(input);
  return Object.fromEntries(
    Object.keys(input).map((key) => [key, validated[key]]),
  );
}
export function validateSettings(input, geography) {
  if (
    !input ||
    typeof input.enabled !== "boolean" ||
    ![1, 6, 24, 168].includes(input.intervalHours) ||
    !["engaged", "bookmarked", "manual"].includes(input.retention) ||
    (input.duplicatePolicy !== undefined &&
      !["skip_unchanged", "refresh_all"].includes(input.duplicatePolicy)) ||
    !Array.isArray(input.scopes)
  )
    throw Error("การตั้งค่าซิงค์ไม่ถูกต้อง");
  const scopes = [],
    seen = new Set();
  for (const s of input.scopes) {
    const province = geography.provinces.find(
      (p) => p.code === s?.provinceCode,
    );
    if (
      !province ||
      seen.has(s.provinceCode) ||
      !Array.isArray(s.districtCodes) ||
      !s.districtCodes.length ||
      s.districtCodes.some((d) => !province.districts.some((x) => x.code === d))
    )
      throw Error("เลือกจังหวัดและอำเภอจากรายการที่รองรับ");
    scopes.push({
      provinceCode: province.code,
      districtCodes: [...new Set(s.districtCodes)],
    });
    seen.add(province.code);
  }
  if (input.enabled && !scopes.length)
    throw Error("เลือกอย่างน้อยหนึ่งอำเภอก่อนเปิดซิงค์อัตโนมัติ");
  return {
    enabled: input.enabled,
    intervalHours: input.intervalHours,
    retention: input.retention,
    duplicatePolicy: input.duplicatePolicy ?? "skip_unchanged",
    scopes,
  };
}

export function filterProperties(items, f = {}) {
  const numeric = (key) => {
    if (f[key] === undefined || f[key] === "") return null;
    const n = Number(f[key]);
    if (!Number.isFinite(n) || n < 0)
      throw Error("ตัวกรองตัวเลขไม่ถูกต้อง: " + key);
    return n;
  };
  if (Object.values(f).some((value) => typeof value !== "string"))
    throw Error("แต่ละตัวกรองต้องระบุค่าเดียว");
  const min = numeric("minPrice"),
    max = numeric("maxPrice"),
    areaMin = numeric("minRai"),
    areaMax = numeric("maxRai"),
    stars = numeric("stars");
  if (stars !== null && (!Number.isInteger(stars) || stars > 5))
    throw Error("ดาวต้องเป็น 0–5");
  if (
    (min !== null && max !== null && min > max) ||
    (areaMin !== null && areaMax !== null && areaMin > areaMax)
  )
    throw Error("ค่าต่ำสุดต้องไม่เกินค่าสูงสุด");
  return items.filter((p) => {
    const u = p.user || emptyUser();
    const price = (p.pricing || propertyPricing(p)).total;
    return (
      (!f.q ||
        clean(
          [
            p.caseNumber,
            p.assetSequence,
            p.deed,
            p.plaintiff,
            p.province,
            p.district,
            p.subdistrict,
            u.comment,
          ].join(" "),
        )
          .toLowerCase()
          .includes(f.q.toLowerCase())) &&
      (!f.province || p.province === f.province) &&
      (!f.district || p.district === f.district) &&
      (!f.type || p.propertyType === f.type) &&
      (min === null || (price !== null && price >= min)) &&
      (max === null || (price !== null && price <= max)) &&
      (areaMin === null ||
        (p.areaSqWa !== null && p.areaSqWa >= areaMin * 400)) &&
      (areaMax === null ||
        (p.areaSqWa !== null && p.areaSqWa <= areaMax * 400)) &&
      (stars === null || u.stars === stars) &&
      (f.bookmarked !== "true" || u.bookmarked) &&
      (!f.auctionStatus ||
        u.auctionStatus ===
          (f.auctionStatus === "unset" ? "" : f.auctionStatus))
    );
  });
}

const thaiMonths = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
const englishMonths = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const thaiPostDate = new RegExp(
  `^(\\d{1,2})\\s*(${thaiMonths.join("|")})\\s*(?:พ\\.?ศ\\.?\\s*)?(\\d{4})(?!\\d)`,
);
const absolutePostTimestamp = new RegExp(
  `\\b(\\d{1,2}) (${englishMonths.join("|")}) (\\d{4}) at \\d{1,2}:\\d{2}\\b`,
);
const auctionPostTitle =
  /(ผล\s*(?:การ\s*)?|(?:บัญชี|ประกาศ)\s*(?:รายการ\s*|การ\s*)?)ขาย\s*ทอดตลาด\s*ทรัพย์(?:สิน)?/;
const saleDatePrefix =
  /^(?:[\s\p{P}\p{S}]+)?(?:(?:ประจำ\s*|ใน\s*)?วัน\s*(?:(?:จันทร์|อังคาร|พุธ|พฤหัสบดี|ศุกร์|เสาร์|อาทิตย์)\s*)?ที่\s*)?/u;

export function facebookPublishedDay(label) {
  const stamp = absolutePostTimestamp.exec(clean(label));
  return stamp
    ? auctionISO(
        `${stamp[1]}/${englishMonths.indexOf(stamp[2]) + 1}/${stamp[3]}`,
      )
    : null;
}

export function matchPost(
  { text, publishedOn },
  auctionDates,
  today = bangkokDay(),
) {
  const content = clean(text)
    .replace(/[\u200b-\u200f]/g, "")
    .replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 0x0e50));
  const title = auctionPostTitle.exec(content);
  if (!title || !publishedOn || publishedOn > today) return null;

  const caption = content
    .slice(title.index + title[0].length)
    .replace(saleDatePrefix, "");
  const thai = thaiPostDate.exec(caption);
  const date = auctionISO(
    thai
      ? `${thai[1]}/${thaiMonths.indexOf(thai[2]) + 1}/${thai[3]}`
      : /^\d{1,2}\/\d{1,2}\/\d{4}\b/.exec(caption)?.[0],
  );
  if (!date || !auctionDates.some((auction) => auctionISO(auction) === date))
    return null;

  const kind = title[1].startsWith("ผล") ? "result" : "announcement";
  const offset = (Date.parse(publishedOn) - Date.parse(date)) / 86400000;
  const eligible =
    kind === "result"
      ? date <= today && offset >= 0 && offset <= 3
      : date >= today && offset >= -3 && offset <= 0;
  return eligible ? { date, auction: date, kind } : null;
}

export function selectFacebookPosts(posts, auctionDates, today = bangkokDay()) {
  const matched = posts.flatMap((post) => {
    const match = matchPost(post, auctionDates, today);
    return match ? [{ ...post, match }] : [];
  });
  const hasResultToday = matched.some(
    ({ match }) => match.date === today && match.kind === "result",
  );
  return hasResultToday
    ? matched.filter(
        ({ match }) => match.date !== today || match.kind === "result",
      )
    : matched;
}

export function facebookForDisplay(
  facebook,
  auctionDates,
  today = bangkokDay(),
) {
  if (!facebook?.posts) return facebook;
  const previousCoverage = facebook.albumCoverage || facebook.posts;
  const albumCoverage = selectFacebookPosts(
    previousCoverage,
    auctionDates,
    today,
  );
  const eligible = new Map(albumCoverage.map(({ url, match }) => [url, match]));
  const posts = facebook.posts.flatMap((post) => {
    const match = eligible.get(post.url);
    return match ? [{ ...post, match }] : [];
  });
  return {
    ...facebook,
    albumCoverage,
    posts,
    caseFilter:
      albumCoverage.length === previousCoverage.length
        ? facebook.caseFilter
        : undefined,
  };
}
