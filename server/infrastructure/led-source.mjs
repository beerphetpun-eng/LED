import { propertyId, detailIdentity } from "../domain/catalog.mjs";
import { setTimeout as delay } from "node:timers/promises";
import { LED } from "./browser-service.mjs";
import { evidenceVersion, waitForEvidenceImages } from "./evidence-images.mjs";
import { componentKey } from "../domain/asset-components.mjs";
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
export async function openDetail(page, index) {
  // Submit the source's own form: legacy inline row handlers can be missing
  // or blocked by the source's CSP even though its public POST form is valid.
  const [detail] = await Promise.all([
    page.waitForEvent("popup", { timeout: 60000 }),
    page
      .locator(rowSelector)
      .nth(index)
      .locator('form[action*="asset_open"]')
      .first()
      .evaluate((form) => form.requestSubmit()),
  ]);
  return detail;
}
export async function waitForResultTable(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 45000 });
  await page.waitForFunction(
    (selector) => {
      const rows = [...document.querySelectorAll(selector)];
      return (
        document.readyState !== "loading" &&
        rows.length > 0 &&
        rows.every(
          (r) =>
            [...r.querySelectorAll("td,th")].filter(
              (c) => c.closest("tr") === r,
            ).length === 11,
        )
      );
    },
    rowSelector,
    { timeout: 20000 },
  );
  let previous = "";
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await page.locator(rowSelector).allTextContents();
    const fingerprint = JSON.stringify(current);
    if (fingerprint === previous) return;
    previous = fingerprint;
    await delay(350);
  }
  throw Error("ตารางผลค้นหายังเปลี่ยนแปลงอยู่ กรุณาลองใหม่");
}
export async function advancePage(page) {
  const next = page.locator('a[title="ถัดไป"]').first();
  if (!(await next.count())) return false;
  const before = await page.evaluate(
    (selector) => ({
      page:
        document.body.innerText.match(/หน้าที่\s*\d+\s*\/\s*\d+/)?.[0] || null,
      rows: [...document.querySelectorAll(selector)]
        .map((r) => r.innerText)
        .join("\n"),
    }),
    rowSelector,
  );
  const submitted = await next.evaluate((link) => {
    const form =
      link.dataset.target && document.forms.namedItem(link.dataset.target);
    if (!form) return false;
    form.requestSubmit();
    return true;
  });
  if (!submitted) await next.click();
  // Pagination may update the current document without a navigation event.
  await page.waitForFunction(
    ({ selector, before }) => {
      const rows = [...document.querySelectorAll(selector)];
      const currentPage = document.body?.innerText.match(
        /หน้าที่\s*\d+\s*\/\s*\d+/,
      )?.[0];
      return (
        rows.length > 0 &&
        (before.page
          ? !!currentPage && currentPage !== before.page
          : rows.map((r) => r.innerText).join("\n") !== before.rows)
      );
    },
    { selector: rowSelector, before },
    { timeout: 45000 },
  );
  await waitForResultTable(page);
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
      const form = r.querySelector('form[action*="asset_open"]');
      const field = (name) =>
        form?.querySelector(`[name="${name}"]`)?.value || "";
      return {
        cells: [...r.querySelectorAll("td,th")]
          .filter((c) => c.closest("tr") === r)
          .map((c) => c.innerText.trim()),
        red,
        identity: {
          sourceAssetId: field("auc_asset_gen"),
          address: field("addrno"),
          documentDeed: field("deedno"),
        },
      };
    }),
  );
}

export function createLedSource(
  browser,
  { findExisting = async () => null, checkImages = waitForEvidenceImages } = {},
) {
  async function extract(job, signal, onChange) {
    const put = (p) => {
      const index = job.properties.findIndex(
        (v) => v.id === p.id && v.componentKey === p.componentKey,
      );
      if (index < 0) job.properties.push(p);
      else job.properties[index] = p;
    };
    const saveJob = onChange;
    const progress = async (j, status, message) => {
      Object.assign(j, { status, message });
      await onChange(j);
    };
    await progress(job, "searching", "กำลังค้นหาจากกรมบังคับคดี");
    await browser.submit(await browser.verificationCode());
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
        if (job.targetId && job.targetId !== id) continue;
        const p = {
          id,
          componentKey: componentKey(row.identity),
          ...row.identity,
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
        if (job.targetKeys && !job.targetKeys.has(p.componentKey)) continue;
        if (!meetsCriteria(p, job.values)) {
          job.excluded++;
          continue;
        }
        const root = await findExisting(id);
        const existing =
          root?.assetComponents?.find(
            (c) => c.componentKey === p.componentKey,
          ) || (p.componentKey === "primary" ? root : null);
        if (
          existing?.rawText &&
          !job.targetId &&
          job.duplicatePolicy !== "refresh_all" &&
          existing.screenshotUrl &&
          existing.evidenceReady === true &&
          existing.evidenceVersion === evidenceVersion &&
          JSON.stringify(existing.sourceRow) === JSON.stringify(c)
        ) {
          const { user, firstSeen, lastSeen, syncCount, ...previous } =
            existing;
          put({
            ...previous,
            componentKey: p.componentKey,
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
        put(p);
        await progress(
          job,
          "extracting",
          `หน้า ${job.pages} · อ่านรายการ ${job.seen} · ${p.subdistrict} ${p.district}`,
        );
        let detail, fallback;
        let raw, evidence;
        try {
          for (let attempt = 1; attempt <= 2; attempt++) {
            signal.throwIfAborted();
            job.detailAttempts?.set(`${id}::${p.componentKey}`, attempt);
            try {
              detail = await openDetail(page, index);
              await detail.waitForLoadState("domcontentloaded");
              await detail
                .getByText("รายการทรัพย์ที่จะขาย", { exact: true })
                .waitFor({ timeout: 30000 });
              raw = await detail.innerText("body");
              evidence = await checkImages(detail, signal, {
                requirePhoto: true,
              });
              if (evidence.ready) break;
              if (attempt === 2) {
                if (
                  fallback &&
                  compareCaptures(fallback.evidence, evidence) > 0
                ) {
                  await detail.close();
                  ({ detail, raw, evidence } = fallback);
                }
                break;
              }
              fallback = { detail, raw, evidence };
              detail = null;
            } catch (e) {
              signal.throwIfAborted();
              if (fallback) {
                await detail?.close();
                ({ detail, raw, evidence } = fallback);
                break;
              }
              if (attempt === 2 || e.name !== "TimeoutError") throw e;
            }
            await detail?.close();
            detail = null;
            await delay(1500, undefined, { signal });
          }
          p.rawText = raw;
          Object.assign(p, detailIdentity(raw, c));
          p.landDocument = landDocument(raw);
          p.sourceUrl = detail.url();
          p.sourceTitle = await detail.title();
          p.evidenceReady = evidence.ready;
          p.evidenceImages = evidence;
          p.evidenceVersion = evidenceVersion;
          const retainExisting =
            !evidence.ready &&
            existing?.screenshotUrl &&
            JSON.stringify(existing.sourceRow) === JSON.stringify(c) &&
            (existing.evidenceReady === true ||
              existing.evidenceImages?.previousCaptureKept ||
              compareCaptures(existing.evidenceImages, evidence) > 0);
          p.screenshotUrl = retainExisting
            ? existing.screenshotUrl
            : await browser.screenshot(detail, `${p.id}-led-${Date.now()}`);
          if (retainExisting)
            p.evidenceImages = { ...evidence, previousCaptureKept: true };
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
              evidence.photos
                ? `รูปถ่ายทรัพย์จากต้นทางยังตรวจได้ไม่ครบ (${evidence.photos.loaded}/${evidence.photos.total} รูป) ระบบจะลองเก็บใหม่ในรอบถัดไป`
                : `ภาพประกาศยังโหลดไม่ครบ (${evidence.loaded}/${evidence.total} รูป) ระบบจะลองเก็บใหม่ในรอบถัดไป`,
            ]
              .filter(Boolean)
              .join(" · ");
          }
        } catch (e) {
          signal.throwIfAborted();
          await browser.diagnostic?.(page, job.id, e);
          p.status = "failed";
          p.error =
            "อ่านรายละเอียดไม่สำเร็จ: " + String(e.message).split("\n")[0];
        } finally {
          await detail?.close();
          if (fallback && fallback.detail !== detail)
            await fallback.detail.close();
        }
        await saveJob(job);
        if (job.targetKeys && job.properties.length === job.targetKeys.size) {
          job.extractionComplete = true;
          return job;
        }
        await delay(800, undefined, { signal });
      }
      await saveJob(job);
      try {
        if (!(await advancePage(page))) break;
      } catch (e) {
        await browser.diagnostic?.(page, job.id, e);
        throw e;
      }
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
      return { verificationMode: "visible_text" };
    },
    extract,
  };
}

function compareCaptures(a, b) {
  if (a?.photos && b?.photos && a.photos.loaded !== b.photos.loaded)
    return a.photos.loaded - b.photos.loaded;
  return (a?.loaded || 0) - (b?.loaded || 0);
}
