import { propertyId, detailIdentity } from "../domain/catalog.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { LED } from "./browser-service.mjs";
import { waitForEvidenceImages } from "./evidence-images.mjs";
import {
  clean,
  number,
  propertyArea,
  deeds,
  dates,
  meetsCriteria,
  landDocument,
} from "../domain/parsing.mjs";
// Legacy pages wrap the results table in another table row. Only asset rows
// containing their own form are records; enclosing layout rows are not.
const rowSelector =
  'tr:has(form[action*="asset_open"]):not(:has(tr form[action*="asset_open"]))';
export async function advancePage(page) {
  const next = page.locator('a[title="ถัดไป"]').first();
  if (!(await next.count())) return false;
  const before = await page.locator(rowSelector).first().innerText();
  await next.click();
  // Pagination may update the current document without a navigation event.
  await page.waitForFunction(
    ({ selector, before }) => {
      const row = document.querySelector(selector);
      return row && row.innerText !== before;
    },
    { selector: rowSelector, before },
    { timeout: 45000 },
  );
  return true;
}
export async function readRows(page) {
  return page.locator(rowSelector).evaluateAll((rows) =>
    rows.map((r) => {
      const redColor = (s) => {
        const a = s.match(/[\d.]+/g)?.map(Number);
        return (
          a &&
          (a.length < 4 || a[3] > 0) &&
          a[0] > 120 &&
          a[0] - a[1] >= 20 &&
          a[0] - a[2] >= 20
        );
      };
      const red =
        r.classList.contains("table-danger") ||
        [r, ...r.querySelectorAll("td,font,span")].some((e) => {
          const s = getComputedStyle(e);
          return redColor(s.backgroundColor) || redColor(s.color);
        });
      return { cells: Array.from(r.cells).map((c) => c.innerText.trim()), red };
    }),
  );
}

export function createLedSource(
  browser,
  { findExisting = async () => null } = {},
) {
  async function extract(job, captcha, signal, onChange) {
    const saveJob = onChange;
    const progress = async (j, status, message) => {
      Object.assign(j, { status, message });
      await onChange(j);
    };
    await progress(job, "searching", "กำลังค้นหาจากกรมบังคับคดี");
    await browser.submit(captcha);
    const page = browser.led,
      seenPages = new Set();
    const expected = number(
      (await page.innerText("body")).match(/พบ\s*([\d,]+)\s*รายการ/)?.[1],
    );
    while (true) {
      signal.throwIfAborted();
      const rows = await readRows(page);
      if (!rows.length) {
        if (
          !/ไม่พบ.*(?:ข้อมูล|ทรัพย์|รายการ)|พบ\s*0\s*รายการ/.test(
            await page.innerText("body"),
          )
        )
          throw Error("รูปแบบตารางต้นทางเปลี่ยน หยุดเพื่อป้องกันข้อมูลตกหล่น");
        break;
      }
      const fingerprint = JSON.stringify(rows);
      if (seenPages.has(fingerprint))
        throw Error("หน้าผลค้นหาวนซ้ำ หยุดโดยเก็บข้อมูลที่ดึงแล้วไว้");
      seenPages.add(fingerprint);
      job.pages++;
      for (let index = 0; index < rows.length; index++) {
        signal.throwIfAborted();
        const row = rows[index];
        job.seen++;
        if (row.red) {
          job.skippedRed++;
          continue;
        }
        if (row.cells.length !== 11) {
          await browser.diagnostic?.(page, job.id);
          throw Error(
            `จำนวนคอลัมน์ต้นทางเปลี่ยน (หน้า ${job.pages}, แถว ${index + 1}, ${row.cells.length} คอลัมน์) กรุณาตรวจตัวเชื่อมต่อ`,
          );
        }
        const c = row.cells.map(clean),
          id = propertyId(c);
        const p = {
          id,
          title: `${c[3]} · ${c[8]}`,
          propertyType: c[3],
          province: c[10],
          district: c[9],
          subdistrict: c[8],
          ...propertyArea(c),
          price: number(c[7]),
          sourceUrl: LED,
          deed: "",
          auctionDates: [],
          screenshotUrl: "",
          status: "pending",
          error: null,
          parcels: [],
          retrievedAt: new Date().toISOString(),
          sourceRow: c,
          ...detailIdentity("", c),
        };
        if (!meetsCriteria(p, job.values)) {
          job.excluded++;
          continue;
        }
        const existing = await findExisting(id);
        if (
          existing?.rawText &&
          existing.screenshotUrl &&
          existing.evidenceReady === true &&
          existing.evidenceVersion === 2 &&
          JSON.stringify(existing.sourceRow) === JSON.stringify(c)
        ) {
          const { user, firstSeen, lastSeen, syncCount, ...previous } =
            existing;
          job.properties.push({
            ...previous,
            ...propertyArea(c),
            retrievedAt: new Date().toISOString(),
          });
          job.skippedExisting = (job.skippedExisting || 0) + 1;
          await progress(
            job,
            "extracting",
            `หน้า ${job.pages} · ข้ามรายละเอียดเดิม ${p.assetSequence} · ${p.district}`,
          );
          continue;
        }
        job.properties.push(p);
        await progress(
          job,
          "extracting",
          `หน้า ${job.pages} · อ่านรายการ ${job.seen} · ${p.subdistrict} ${p.district}`,
        );
        let detail;
        try {
          [detail] = await Promise.all([
            page.waitForEvent("popup", { timeout: 30000 }),
            page.locator(rowSelector).nth(index).click(),
          ]);
          await detail.waitForLoadState("domcontentloaded");
          await detail
            .getByText("รายการทรัพย์ที่จะขาย", { exact: true })
            .waitFor({ timeout: 30000 });
          const raw = await detail.innerText("body");
          p.rawText = raw;
          Object.assign(p, detailIdentity(raw, c));
          p.landDocument = landDocument(raw);
          p.sourceUrl = detail.url();
          p.sourceTitle = await detail.title();
          const evidence = await waitForEvidenceImages(detail, signal);
          p.evidenceReady = evidence.ready;
          p.evidenceImages = evidence;
          p.evidenceVersion = 2;
          p.screenshotUrl = await browser.screenshot(
            detail,
            `${p.id}-led-${Date.now()}`,
          );
          p.deed = deeds(raw).join(", ");
          p.auctionDates = dates(raw);
          if (!p.deed || !p.auctionDates.length) {
            p.status = "needs_review";
            p.error = !p.deed
              ? "ไม่พบเลขโฉนดที่อ่านได้ อาจเป็นเอกสารสิทธิประเภทอื่น กรุณาตรวจภาพประกาศ"
              : "อ่านวันประมูลไม่ได้ กรุณาตรวจภาพประกาศ";
          }
          if (!evidence.ready) {
            p.status = "needs_review";
            p.error = [
              p.error,
              `ภาพประกาศยังโหลดไม่ครบ (${evidence.loaded}/${evidence.total} รูป) ระบบจะลองเก็บใหม่ในรอบถัดไป`,
            ]
              .filter(Boolean)
              .join(" · ");
          }
        } catch (e) {
          p.status = "failed";
          p.error =
            "อ่านรายละเอียดไม่สำเร็จ: " + String(e.message).split("\n")[0];
        } finally {
          await detail?.close();
        }
        await saveJob(job);
        await delay(800, undefined, { signal });
      }
      await saveJob(job);
      if (!(await advancePage(page))) break;
    }
    if (expected !== null && expected !== job.seen)
      job.warnings.push(
        `ต้นทางแจ้ง ${expected} รายการ แต่ตรวจอ่านได้ ${job.seen} รายการ`,
      );
    job.extractionComplete = expected === null || expected === job.seen;
    return job;
  }

  return {
    prepare: (values) => browser.apply(values),
    async prepareScope(scope) {
      const schema = await browser.schema(true);
      const values = Object.fromEntries(
        schema.fields.map((f) => [f.key, f.kind === "select" ? f.value : ""]),
      );
      Object.assign(values, {
        provinces: scope.provinceCode,
        amphurSelect: scope.districtCode,
        tambonSelect: "",
      });
      await browser.apply(values);
      return { captchaUrl: "/api/captcha?t=" + Date.now() };
    },
    extract,
  };
}
