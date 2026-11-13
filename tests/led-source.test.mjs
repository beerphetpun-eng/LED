import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "../server/node_modules/playwright/index.mjs";
import {
  readRows,
  createLedSource,
  advancePage,
} from "../server/infrastructure/led-source.mjs";
import { propertyId } from "../server/domain/catalog.mjs";
test("legacy form-wrapped cells remain part of their asset row", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      "<table><tr>" + "<td>value</td>".repeat(10) + "</tr></table>",
    );
    await page.evaluate(() => {
      const r = document.querySelector("tr"),
        form = document.createElement("form"),
        td = document.createElement("td");
      form.action = "asset_open.asp";
      td.textContent = "จังหวัด";
      form.append(td);
      r.append(form);
    });
    assert.equal(await page.locator("tr").evaluate((r) => r.cells.length), 10);
    const rows = await readRows(page);
    assert.equal(rows[0].cells.length, 11);
    assert.equal(rows[0].cells[10], "จังหวัด");
  } finally {
    await browser.close();
  }
});
test("nested layout rows are not counted or opened as property records", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<table><tr><td><table><tr><td><form action="asset_open.asp"></form>asset one</td><td>value</td></tr><tr><td><form action="asset_open.asp"></form>asset two</td><td>value</td></tr></table></td></tr></table>',
    );
    const rows = await readRows(page);
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => r.cells.length),
      [2, 2],
    );
    assert.equal(rows[1].cells[0], "asset two");
  } finally {
    await browser.close();
  }
});
test("pagination waits for changed rows without requiring document navigation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<table><tr><td><form action="asset_open.asp"></form><span>page one</span></td>${"<td>value</td>".repeat(10)}</tr></table><a title="ถัดไป" href="#" onclick="setTimeout(()=>{document.querySelector('span').textContent='page two';this.remove()},100);return false">Next</a>`,
    );
    assert.equal(await advancePage(page), true);
    assert.match(await page.innerText("body"), /page two/);
    assert.equal(await advancePage(page), false);
  } finally {
    await browser.close();
  }
});
test("pagination recognizes page number changes when bundled asset rows have identical text", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(
      `<p id="page">หน้าที่ 1/2</p><table><tr><td><form action="asset_open.asp"></form>same asset</td>${"<td>value</td>".repeat(10)}</tr></table><a title="ถัดไป" href="#" onclick="setTimeout(()=>{document.querySelector('#page').textContent='หน้าที่ 2/2';this.remove()},100);return false">Next</a>`,
    );
    assert.equal(await advancePage(page), true);
    assert.equal(await advancePage(page), false);
  } finally {
    await browser.close();
  }
});
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

test("unchanged known properties skip detail navigation and screenshots", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const cells = [
      "ชม7/2569",
      "1 - 1",
      "คดี1/2568",
      "ที่ดิน",
      "2",
      "0",
      "0",
      "1000000",
      "สุเทพ",
      "เมืองเชียงใหม่",
      "เชียงใหม่",
    ];
    await page.setContent(
      "<p>พบ 1 รายการ</p><table><tr>" +
        cells
          .map(
            (c, i) =>
              `<td>${i === 0 ? '<form action="asset_open.asp"></form>' : ""}${c}</td>`,
          )
          .join("") +
        "</tr></table>",
    );
    const previous = {
      id: propertyId(cells),
      rawText: "saved detail",
      screenshotUrl: "/evidence/fixture.png",
      evidenceReady: true,
      evidenceVersion: 2,
      sourceRow: cells,
      status: "located",
      deed: "123",
      parcels: [],
    };
    const source = createLedSource(
      {
        led: page,
        verificationCode: async () => "123456",
        submit: async () => {},
        screenshot: async () => {
          throw Error("must not download images again");
        },
      },
      {
        findExisting: async (id) => {
          assert.equal(id, previous.id);
          return previous;
        },
      },
    );
    const job = {
      id: "fixture",
      values: {},
      pages: 0,
      seen: 0,
      skippedRed: 0,
      excluded: 0,
      properties: [],
      warnings: [],
    };
    await source.extract(job, new AbortController().signal, async () => {});
    assert.equal(job.extractionComplete, true);
    assert.equal(job.skippedExisting, 1);
    assert.equal(job.properties[0].screenshotUrl, previous.screenshotUrl);
  } finally {
    await browser.close();
  }
});
