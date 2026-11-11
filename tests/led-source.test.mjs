import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import { readRows } from "../server/infrastructure/led-source.mjs";
test("source adapter excludes Bootstrap and inline red rows, not ordinary rows", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>.table-danger{background:#f8d7da}td{padding:3px}</style><table>
   <tr><th>Header</th></tr>
   <tr class="table-danger"><td><form action="asset_open.asp"></form>sold</td><td>100</td></tr>
   <tr style="color:red"><td><form action="asset_open.asp"></form>withdrawn</td></tr>
   <tr><td style="background:#ffdddd"><form action="asset_open.asp"></form>red background</td></tr>
   <tr><td><form action="asset_open.asp"></form>available</td><td>28606</td></tr>
  </table>`);
    const rows = await readRows(page);
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((r) => r.red),
      [true, true, true, false],
    );
  } finally {
    await browser.close();
  }
});
