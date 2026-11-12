import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { waitForEvidenceImages } from "../server/infrastructure/evidence-images.mjs";

test("evidence waits for a delayed property photo and flags broken images", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("https://fixture.invalid/photo.svg", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="green"/></svg>',
      });
    });
    await page.setContent('<img src="https://fixture.invalid/photo.svg">', {
      waitUntil: "domcontentloaded",
    });
    const result = await waitForEvidenceImages(
      page,
      new AbortController().signal,
      { timeout: 3000, settle: 10 },
    );
    assert.equal(result.ready, true);
    assert.equal(result.loaded, 1);
    await page.route("https://fixture.invalid/broken.jpg", (route) =>
      route.abort(),
    );
    await page.setContent('<img src="https://fixture.invalid/broken.jpg">', {
      waitUntil: "domcontentloaded",
    });
    const broken = await waitForEvidenceImages(
      page,
      new AbortController().signal,
      { timeout: 300, settle: 10 },
    );
    assert.equal(broken.ready, false);
    assert.equal(broken.total, 1);
    assert.equal(broken.loaded, 0);
  } finally {
    await browser.close();
  }
});
