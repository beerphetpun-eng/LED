import test from "node:test";
import assert from "node:assert/strict";
import { propertyPricing, withPricing } from "../server/domain/pricing.mjs";
import { filterProperties } from "../server/domain/catalog.mjs";

const mortgage = (amount = "640,242.67") => ({
  price: 100,
  rawText: `จะทำการขายโดย การจำนองติดไป \n ติดจำนอง ธนาคารอาคารสงเคราะห์ ยอดหนี้จำนอง ${amount} บาท\nราคาประเมิน 100 บาท`,
});

test("carried mortgage stays constant at all four appraisal discounts", () => {
  const p = propertyPricing(mortgage());
  assert.equal(p.mortgageDebt, 640242.67);
  assert.equal(p.carriesMortgage, true);
  assert.equal(p.warning, null);
  assert.deepEqual(p.options, [
    { discount: 0, appraisal: 100, total: 640342.67 },
    { discount: 10, appraisal: 90, total: 640332.67 },
    { discount: 20, appraisal: 80, total: 640322.67 },
    { discount: 30, appraisal: 70, total: 640312.67 },
  ]);
  const decimal = propertyPricing({ ...mortgage(), price: 666747.84 });
  assert.equal(decimal.options[1].appraisal, 600073.06);
  assert.equal(decimal.options[1].total, 1240315.73);
});

test("only the actual sale condition carries mortgage, including a stated zero debt", () => {
  for (const condition of [
    "ปลอดการจำนอง",
    "ปลอดภาระผูกพัน",
    "ไม่มีภาระจำนอง",
  ]) {
    const p = propertyPricing({
      price: 100,
      rawText: `จะทำการขายโดย ${condition} ราคาประเมิน 100 บาท หมายเหตุ: การจำนองติดไป ยอดหนี้จำนอง 900 บาท`,
    });
    assert.equal(p.total, 100);
    assert.equal(p.carriesMortgage, false);
    assert.equal(p.options[3].total, 70);
  }
  assert.equal(propertyPricing(mortgage("0.00")).total, 100);
  assert.equal(propertyPricing(mortgage("๖๔๐,๒๔๒.๖๗")).total, 640342.67);
});

test("unreadable or ambiguous debts never turn into an understated total", () => {
  for (const amount of [
    "",
    "-100",
    "64,02.67",
    "640.242.67",
    "ไม่ระบุ",
    "100.123",
    "9,999,999,999,999,999",
  ]) {
    const p = propertyPricing(mortgage(amount));
    assert.equal(p.total, null, amount);
    assert.equal(p.mortgageDebt, null, amount);
    assert.ok(p.warning);
    assert.ok(p.options.every((o) => o.total === null));
  }
  assert.equal(propertyPricing({ price: 100 }).total, null);
  assert.equal(propertyPricing({ ...mortgage(), price: null }).total, null);
  const twoDebts = mortgage();
  twoDebts.rawText = twoDebts.rawText.replace(
    "ราคาประเมิน",
    "ยอดหนี้จำนอง 200 บาท ราคาประเมิน",
  );
  assert.equal(propertyPricing(twoDebts).total, null);
});

test("bundled assets count a repeated mortgage once and flag conflicting conditions", () => {
  const part = mortgage();
  const bundle = {
    ...part,
    assetComponents: [
      part,
      { ...part, rawText: part.rawText.replace(/\n/g, "  ") },
    ],
  };
  assert.equal(propertyPricing(bundle).total, 640342.67);
  for (const second of [
    mortgage("200"),
    { price: 100, rawText: "จะทำการขายโดย ปลอดการจำนอง ราคาประเมิน 100 บาท" },
  ]) {
    const p = propertyPricing({ ...bundle, assetComponents: [part, second] });
    assert.equal(p.total, null);
    assert.ok(p.warning);
  }
});

test("price filtering uses mortgage-inclusive totals and excludes unknown totals in ranges", () => {
  const p = withPricing(mortgage());
  const unknown = withPricing(mortgage("ไม่ระบุ"));
  assert.equal(filterProperties([p], { maxPrice: "640342.66" }).length, 0);
  assert.equal(
    filterProperties([p], { minPrice: "640342.67", maxPrice: "640342.67" })
      .length,
    1,
  );
  assert.equal(filterProperties([unknown], { minPrice: "0" }).length, 0);
  assert.equal(filterProperties([unknown], {}).length, 1);
  assert.equal(withPricing(p).price, 100);
  assert.deepEqual(withPricing(p).pricing, p.pricing);
});
