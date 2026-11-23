import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { imageSize } from "../server/node_modules/image-size/dist/esm/index.js";
import {
  createFacebookOcrInput,
  facebookTableLines,
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

test("table OCR separates white, shaded and dark green cells without treating the background as a grid line", async () => {
  const browser = await chromium.launch({ headless: true });
  const input = await createFacebookOcrInput();
  try {
    const page = await browser.newPage();
    const encoded = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 150;
      const context = canvas.getContext("2d");
      context.fillStyle = "white";
      context.fillRect(0, 0, 160, 150);
      context.fillStyle = "#dddddd";
      context.fillRect(20, 50, 120, 40);
      context.fillStyle = "rgb(30,80,20)";
      context.fillRect(20, 90, 120, 40);
      context.fillStyle = "black";
      for (const y of [10, 50, 90, 130]) context.fillRect(20, y, 120, 2);
      for (const x of [20, 140]) context.fillRect(x, 10, 2, 122);
      return canvas.toDataURL("image/png").split(",")[1];
    });
    const table = await input.table(Buffer.from(encoded, "base64"), {
      left: 25,
      top: 5,
      width: 100,
      height: 135,
    });
    assert.equal(table.rows.length, 3);
    const fitted = await input.fitCell(Buffer.from(encoded, "base64"), {
      left: 24,
      top: 55,
      width: 110,
      height: 25,
    });
    assert.equal(fitted.fitted, true);
    assert(fitted.left >= 22 && fitted.left <= 24);
    assert(
      fitted.left + fitted.width >= 138 && fitted.left + fitted.width <= 140,
      "the final digit fits inside the detected right border",
    );
    for (const [i, row] of table.rows.entries()) {
      assert(row.top < 30 + i * 40 && row.top + row.height > 30 + i * 40);
    }
    const second = table.rows[1];
    const make = (text, offset) => ({
      text,
      words: [
        {
          text,
          bbox: { x0: 30, x1: 60, y0: offset + 35, y1: offset + 55 },
          symbols: [
            {
              text,
              bbox: { x0: 30, x1: 60, y0: offset + 35, y1: offset + 55 },
            },
          ],
        },
      ],
    });
    const lines = [
      make("1", table.rows[0].offset),
      make("2", second.offset),
      make("3", table.rows[2].offset),
    ];
    const selected = facebookTableLines(lines, second);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].text, "2");
    assert.equal(selected[0].words[0].symbols[0].bbox.y0, 35);
    assert.equal(lines[1].words[0].symbols[0].bbox.y0, second.offset + 35);
  } finally {
    await input.close();
    await browser.close();
  }
});
