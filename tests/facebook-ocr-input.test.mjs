import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { imageSize } from "../server/node_modules/image-size/dist/esm/index.js";
import {
  createFacebookOcrInput,
  restoreFacebookColumnBoxes,
} from "../server/infrastructure/facebook-ocr-input.mjs";

test("OCR isolates green table rows and maps enlarged case boxes back to the original evidence", async () => {
  const browser = await chromium.launch({ headless: true });
  const input = await createFacebookOcrInput();
  try {
    const page = await browser.newPage();
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 200;
      canvas.height = 100;
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, 200, 100);
      context.fillStyle = "rgb(0,176,80)";
      context.fillRect(20, 30, 80, 20);
      context.fillStyle = "black";
      context.fillRect(35, 35, 3, 10);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const bytes = Buffer.from(encoded, "base64");
    const rows = await input.coloredRows(bytes, {
      left: 20,
      top: 10,
      width: 80,
      height: 80,
    });
    assert.deepEqual(rows, [{ left: 20, top: 30, width: 80, height: 20 }]);
    const prepared = await input.column(bytes, rows[0]);
    const dimensions = imageSize(prepared);
    assert.equal(dimensions.width, 300);
    assert.equal(dimensions.height, 120);
    const bbox = { x0: 75, y0: 45, x1: 84, y1: 75 };
    const lines = restoreFacebookColumnBoxes(
      [{ words: [{ bbox, symbols: [{ bbox: { ...bbox } }] }] }],
      rows[0],
    );
    assert.deepEqual(lines[0].words[0].bbox, {
      x0: 35,
      y0: 35,
      x1: 38,
      y1: 45,
    });
    assert.deepEqual(lines[0].words[0].symbols[0].bbox, lines[0].words[0].bbox);
  } finally {
    await input.close();
    await browser.close();
  }
});
