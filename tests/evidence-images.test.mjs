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
    await page.setContent(
      '<img alt="ภาพทรัพย์ที่จะขาย" src="https://fixture.invalid/photo.svg">',
      {
        waitUntil: "domcontentloaded",
      },
    );
    const result = await waitForEvidenceImages(
      page,
      new AbortController().signal,
      { timeout: 3000, settle: 10, requirePhoto: true },
    );
    assert.equal(result.ready, true);
    assert.equal(result.loaded, 1);
    assert.deepEqual(result.photos, { total: 1, loaded: 1 });
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
    await page.setContent(
      '<img alt="โลโก้" src="https://fixture.invalid/photo.svg">',
    );
    const logoOnly = await waitForEvidenceImages(
      page,
      new AbortController().signal,
      { timeout: 100, settle: 10, requirePhoto: true },
    );
    assert.equal(logoOnly.loaded, 1);
    assert.deepEqual(logoOnly.photos, { total: 0, loaded: 0 });
    assert.equal(logoOnly.ready, false);
    await page.setContent('<img alt="รูปถ่ายทรัพย์">');
    const photoWithoutSource = await waitForEvidenceImages(
      page,
      new AbortController().signal,
      { timeout: 100, settle: 10, requirePhoto: true },
    );
    assert.deepEqual(photoWithoutSource.photos, { total: 1, loaded: 0 });
    assert.equal(photoWithoutSource.ready, false);
  } finally {
    await browser.close();
  }
});
