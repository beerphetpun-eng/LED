import { createLandsMapsGeocoder } from "../server/infrastructure/landsmaps-geocoder.mjs";
import { BrowserService } from "../server/infrastructure/browser-service.mjs";
const browser = new BrowserService();
const { locate } = createLandsMapsGeocoder(browser);
import assert from "node:assert/strict";
try {
  const result = await locate(
    {
      id: "smoke-28606",
      province: "เชียงใหม่",
      district: "พร้าว",
      subdistrict: "เขื่อนผาก",
    },
    "28606",
    "smoke",
    new AbortController().signal,
  );
  assert.equal(result.status, "located");
  assert.ok(result.evidenceUrl);
  assert.ok(result.mapEvidenceUrl);
  assert.equal(result.backgroundReady, true);
  assert.ok(Math.abs(result.latitude - 19.31560502) < 0.0001);
  assert.ok(Math.abs(result.longitude - 99.15525179) < 0.0001);
  console.log(JSON.stringify(result));
} catch (error) {
  if (browser.lands) {
    console.error("Page:", browser.lands.url());
    console.error(
      "Visible page:",
      (
        await browser.lands
          .locator("body")
          .innerText({ timeout: 5000 })
          .catch(() => "")
      ).slice(0, 1000),
    );
    await browser
      .screenshot(browser.lands, "smoke-lands-failure")
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
