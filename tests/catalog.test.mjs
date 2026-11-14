import test from "node:test";
import assert from "node:assert/strict";
import {
  propertyId,
  detailIdentity,
  auctionISO,
  bangkokDay,
  expiryDay,
  shouldExpire,
  emptyUser,
  filterProperties,
  validateUser,
  validateSettings,
  matchPost,
  defaultSettings,
} from "../server/domain/catalog.mjs";
test("defaults are weekly Chiang Mai city and only explicit deletion protection", () => {
  const s = defaultSettings();
  assert.equal(s.intervalHours, 168);
  assert.equal(s.retention, "manual");
  assert.deepEqual(s.scopes, [{ provinceCode: "50", districtCodes: ["5001"] }]);
  const p = {
    auctionDates: ["01/01/2560"],
    user: { ...emptyUser(), bookmarked: true, stars: 5, comment: "ติดตาม" },
  };
  assert.equal(shouldExpire(p), true);
  assert.equal(
    shouldExpire({ ...p, user: { ...p.user, protected: true } }),
    false,
  );
});
test("identity survives price, area and ordering changes but distinguishes assets and lots", () => {
  const row = [
    "ชม7/2569",
    "97 - 1",
    "ผบE.1606/2565",
    "ที่ดิน",
    "2",
    "2",
    "18",
    "570000",
    "ดอยหล่อ",
    "ดอยหล่อ",
    "เชียงใหม่",
  ];
  const updated = [...row];
  updated[7] = "999999";
  updated[4] = "3";
  assert.equal(propertyId(row), propertyId(updated));
  updated[1] = "97 - 2";
  assert.notEqual(propertyId(row), propertyId(updated));
  updated[1] = row[1];
  updated[0] = "ชม8/2569";
  assert.notEqual(propertyId(row), propertyId(updated));
  assert.deepEqual(
    detailIdentity(
      "ทรัพย์ที่จะขาย ลำดับที่ 97 - 1\nคดีหมายเลขแดงที่\nผบE.1606 / 2565\nโจทก์\nบริษัท ทดสอบ จำกัด",
      row,
    ),
    {
      assetSequence: "97 - 1",
      caseNumber: "ผบE.1606 / 2565",
      plaintiff: "บริษัท ทดสอบ จำกัด",
      saleLot: "ชม7/2569",
    },
  );
});
test("retention follows calendar month, Thai day and strict after-date boundary", () => {
  const p = { auctionDates: ["24/12/2569", "08/04/2570"], user: emptyUser() };
  assert.equal(expiryDay(p.auctionDates), "2027-05-08");
  assert.equal(shouldExpire(p, "manual", "2027-05-08"), false);
  assert.equal(shouldExpire(p, "manual", "2027-05-09"), true);
  assert.equal(expiryDay(["31/01/2567"]), "2024-02-29");
  assert.equal(expiryDay(["31/01/2568"]), "2025-02-28");
  assert.equal(expiryDay(["31/12/2569"]), "2027-01-31");
  assert.equal(bangkokDay(new Date("2027-05-08T17:01:00Z")), "2027-05-09");
  assert.equal(auctionISO("31/02/2570"), null);
  assert.equal(expiryDay(["08/04/2570", "bad"]), null);
  assert.equal(shouldExpire({ auctionDates: [] }), false);
});
test("bundle retention waits for every component, including older saved bundles", () => {
  const property = {
    auctionDates: ["01/01/2569"],
    assetComponents: [
      { auctionDates: ["01/01/2569"] },
      { auctionDates: ["10/03/2569"] },
    ],
  };
  assert.equal(shouldExpire(property, "manual", "2026-04-10"), false);
  assert.equal(shouldExpire(property, "manual", "2026-04-11"), true);
  property.assetComponents[1].auctionDates = [];
  assert.equal(shouldExpire(property, "manual", "2026-04-11"), false);
});

test("deletion exemptions are explicit and preserve user work", () => {
  const p = { auctionDates: ["01/01/2560"], user: emptyUser() };
  for (const patch of [
    { bookmarked: true },
    { stars: 1 },
    { comment: "ติดตาม" },
  ])
    assert.equal(
      shouldExpire({ ...p, user: { ...p.user, ...patch } }, "engaged"),
      false,
    );
  assert.equal(
    shouldExpire({ ...p, user: { ...p.user, stars: 5 } }, "bookmarked"),
    true,
  );
  assert.equal(
    shouldExpire({ ...p, user: { ...p.user, protected: true } }, "manual"),
    false,
  );
  assert.equal(
    shouldExpire({ ...p, user: { ...p.user, comment: "   " } }, "engaged"),
    true,
  );
});
test("display filters combine independently, with exact zero stars and null-safe ranges", () => {
  const base = {
    price: 1000000,
    rawText: "จะทำการขายโดย ปลอดการจำนอง ราคาประเมิน 1,000,000 บาท",
    areaSqWa: 800,
    province: "เชียงใหม่",
    district: "เมืองเชียงใหม่",
    propertyType: "ที่ดิน",
    user: emptyUser(),
  };
  const items = [
    base,
    {
      ...base,
      price: 3000000,
      user: {
        ...emptyUser(),
        bookmarked: true,
        stars: 5,
        auctionStatus: "ended",
      },
    },
    { ...base, price: null, areaSqWa: null },
  ];
  assert.equal(filterProperties(items, { stars: "0" }).length, 2);
  assert.equal(
    filterProperties(items, {
      minPrice: "1000000",
      maxPrice: "1000000",
      minRai: "2",
      maxRai: "2",
    }).length,
    1,
  );
  assert.equal(
    filterProperties(items, {
      bookmarked: "true",
      stars: "5",
      auctionStatus: "ended",
    }).length,
    1,
  );
  assert.throws(() =>
    filterProperties(items, { minPrice: "2", maxPrice: "1" }),
  );
  assert.throws(() => validateUser({ ...emptyUser(), stars: 6 }));
});
test("scope settings reject unknown districts and never accept price conditions", () => {
  const g = { provinces: [{ code: "50", districts: [{ code: "5001" }] }] },
    s = {
      enabled: true,
      intervalHours: 6,
      retention: "engaged",
      scopes: [{ provinceCode: "50", districtCodes: ["5001"] }],
      price_end: "123",
    };
  assert.equal(validateSettings(s, g).price_end, undefined);
  assert.equal(validateSettings(s, g).duplicatePolicy, "skip_unchanged");
  assert.equal(
    validateSettings({ ...s, duplicatePolicy: "refresh_all" }, g)
      .duplicatePolicy,
    "refresh_all",
  );
  assert.throws(() =>
    validateSettings({ ...s, duplicatePolicy: "unknown" }, g),
  );
  assert.throws(() =>
    validateSettings(
      { ...s, scopes: [{ provinceCode: "50", districtCodes: ["999"] }] },
      g,
    ),
  );
  assert.throws(() => validateSettings({ ...s, scopes: [] }, g));
});
test("Facebook matching tolerates formatting and Thai digits but never matches unrelated posts", () => {
  const dates = ["12/11/2569"];
  assert.equal(
    matchPost("✨ บัญชีขายทอดตลาดทรัพย์ วันที่  ๑๒  พฤศจิกายน  ๒๕๖๙", dates)
      .days,
    0,
  );
  assert.equal(
    matchPost("ผลการขายทอดตลาดทรัพย์ ประจำวันที่\u200b 5 พฤศจิกายน 2569", dates)
      .days,
    7,
  );
  assert.equal(matchPost("งานมหกรรม 12 พฤศจิกายน 2569", dates), null);
  assert.equal(matchPost("ขายทอดตลาดทรัพย์ 5 พฤศจิกายน 2569", dates, 3), null);
});
