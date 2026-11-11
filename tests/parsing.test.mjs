import test from "node:test";
import assert from "node:assert/strict";
import {
  area,
  deeds,
  dates,
  coordinates,
  district,
  meetsCriteria,
  number,
  validateValues,
  landDocument,
} from "../server/domain/parsing.mjs";
test("total area includes ngan and fractional square wah", () => {
  assert.equal(area(["", "", "", "", "4", "1", "5", "", "", "", ""]), 1705);
  assert.equal(area(["", "", "", "", "2", "0", "0.1", "", "", "", ""]), 800.1);
  assert.equal(area(["", "", "", "", "-", "0", "0", "", "", "", ""]), null);
});
test("strict area and four million boundary, including missing fields", () => {
  const v = { rai: "2", rai_if: "3", price_end: "3999999.99" };
  assert.equal(meetsCriteria({ areaSqWa: 800, price: 3000000 }, v), false);
  assert.equal(meetsCriteria({ areaSqWa: 800.1, price: 3999999.99 }, v), true);
  assert.equal(meetsCriteria({ areaSqWa: 801, price: 4000000 }, v), false);
  assert.equal(meetsCriteria({ areaSqWa: null, price: 1000000 }, v), false);
});
test("deed numbers stay separate from case numbers and land area", () => {
  assert.deepEqual(
    deeds("คดี ผบE.442 / 2566\nโฉนดเลขที่ 28606\nเนื้อที่ 4 ไร่ 1 งาน 5 ตร.วา"),
    ["28606"],
  );
  assert.deepEqual(deeds("โฉนดเลขที่ 111, 222 และ 333\nจังหวัด"), [
    "111",
    "222",
    "333",
  ]);
  assert.deepEqual(deeds("น.ส.3ก เลขที่ 1234"), []);
  assert.deepEqual(deeds("โฉนดเลขที่ 123-125"), []);
});
test("auction dates retain Buddhist years and remove duplicates", () => {
  assert.deepEqual(dates("26/11/2569 17/12/2569 07/01/2570 26/11/2569"), [
    "26/11/2569",
    "17/12/2569",
    "07/01/2570",
  ]);
});
test("non-chanote documents are retained without being treated as ordinary deeds", () => {
  const raw =
    "ประเภททรัพย์\nที่ดินว่างเปล่า\nที่ดิน\nน.ส.3ก.เลขที่ 2760\nเนื้อที่\n5 ไร่";
  assert.equal(landDocument(raw), "น.ส.3ก.เลขที่ 2760");
  assert.deepEqual(deeds(raw), []);
});
test("coordinates must be geographic coordinates in Thailand", () => {
  assert.deepEqual(coordinates("19.31560502, 99.15525179"), {
    latitude: 19.31560502,
    longitude: 99.15525179,
  });
  assert.equal(coordinates("99.15525179,19.31560502"), null);
  assert.equal(coordinates("0.00,0.00"), null);
});
test("legacy district names normalize without fuzzy guessing", () => {
  assert.equal(district("11-พร้าว"), "พร้าว");
  assert.equal(district("กิ่งอำเภอดอยหล่อ(จอมทอง)"), "ดอยหล่อ");
  assert.notEqual(district("เมืองเชียงใหม่"), district("เชียงดาว"));
});
test("invalid numeric filters and selector keys are rejected", () => {
  assert.equal(number("1,011,500.00"), 1011500);
  assert.equal(number(""), null);
  assert.throws(() => validateValues({ price_end: "-1" }));
  assert.throws(() => validateValues({ 'x"]': "1" }));
  assert.throws(() => validateValues({ price_begin: "4", price_end: "3" }));
});
