import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { BrowserService } from "../server/infrastructure/browser-service.mjs";

test("background verification reads only the displayed text and rejects a changed format", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const service = new BrowserService();
    service.led = await browser.newPage();
    await service.led.setContent(
      '<div id="sesskey">123456</div><input type="hidden" value="999999">',
    );
    assert.equal(await service.verificationCode(), "123456");
    await service.led.setContent('<div id="sesskey">not a numeric code</div>');
    await assert.rejects(service.verificationCode(), /รูปแบบรหัส/);
    await service.led.setContent(
      '<div id="sesskey" style="display:none">123456</div>',
    );
    await assert.rejects(service.verificationCode(), /ไม่แสดงรหัส/);
  } finally {
    await browser.close();
  }
});
