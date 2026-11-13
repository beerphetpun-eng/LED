import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { waitForDistrict } from "../server/infrastructure/landsmaps-geocoder.mjs";
test("district selection waits for the requested province's asynchronously loaded options", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<select id="cbamphur"><option value="">เลือกอำเภอ</option><option value="01">01-เมืองกรุงเทพ</option></select><script>setTimeout(()=>{document.querySelector('#cbamphur').innerHTML='<option value="01">01-เมืองเชียงใหม่</option>'},100)</script>`,
    );
    const found = await waitForDistrict(
      page,
      "เมืองเชียงใหม่",
      new AbortController().signal,
      { timeout: 2000 },
    );
    assert.equal(found.label, "01-เมืองเชียงใหม่");
    assert.equal(found.value, "01");
  } finally {
    await browser.close();
  }
});
