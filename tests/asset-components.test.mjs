import test from "node:test";
import assert from "node:assert/strict";
import {
  componentKey,
  mergeComponents,
} from "../server/domain/asset-components.mjs";
test("bundled rooms retain distinct evidence without multiplying the auction price", () => {
  const base = {
    id: "auction",
    rawText: "detail",
    deed: "123",
    province: "A",
    district: "B",
    subdistrict: "C",
    areaUnit: "sqm",
    evidenceReady: true,
    price: 1000000,
    parcels: [],
    areaSqWa: 10,
    areaText: "40 ตร.ม.",
  };
  const first = {
    ...base,
    componentKey: componentKey({
      sourceAssetId: "one",
      address: "101",
      documentDeed: "123",
    }),
    screenshotUrl: "/evidence/one.png",
  };
  const second = {
    ...base,
    componentKey: componentKey({
      sourceAssetId: "one",
      address: "102",
      documentDeed: "123",
    }),
    screenshotUrl: "/evidence/two.png",
  };
  let combined = mergeComponents(null, first);
  combined = mergeComponents(combined, second);
  assert.equal(combined.assetComponents.length, 2);
  assert.equal(combined.price, 1000000);
  assert.equal(combined.areaSqWa, 20);
  assert.match(combined.areaText, /80/);
  assert.equal(combined.deed, "123");
  combined = mergeComponents(combined, {
    ...first,
    screenshotUrl: "/evidence/refreshed.png",
    areaSqWa: 12,
  });
  assert.equal(combined.assetComponents.length, 2);
  assert.equal(combined.areaSqWa, 22);
  assert.equal(
    combined.assetComponents[0].screenshotUrl,
    "/evidence/refreshed.png",
  );
});
