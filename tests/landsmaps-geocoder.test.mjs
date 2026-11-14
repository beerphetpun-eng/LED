import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { waitForDistrict } from "../server/infrastructure/landsmaps-geocoder.mjs";
import {
  BrowserService,
  registerLandsOverlays,
} from "../server/infrastructure/browser-service.mjs";

test("browser service recreates its pages after Chromium disconnects", async (t) => {
  const service = new BrowserService();
  t.after(() => service.close());
  const oldPage = await service.landsPage();
  const oldBrowser = service.browser;
  await oldBrowser.close();
  const newPage = await service.landsPage();
  assert.notEqual(service.browser, oldBrowser);
  assert.notEqual(newPage, oldPage);
  assert.equal(newPage.isClosed(), false);
});

test("LandsMaps overlay handlers tolerate a failed dismiss without rejecting", async () => {
  const handlers = [];
  const news = {
    first() {
      return this;
    },
  };
  const cookies = {
    first() {
      return this;
    },
  };
  await registerLandsOverlays({
    locator: () => ({ getByRole: () => news }),
    getByRole: () => cookies,
    addLocatorHandler: async (control, handler) =>
      handlers.push({ control, handler }),
  });
  assert.deepEqual(
    handlers.map(({ control }) => control),
    [news, cookies],
  );
  for (const { handler } of handlers) {
    let attempts = 0;
    await handler({
      click: async () => {
        attempts++;
        throw Error("ปุ่มหายไประหว่างกด");
      },
    });
    assert.equal(attempts, 1);
  }
});
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
