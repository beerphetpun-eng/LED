import { setTimeout as delay } from "node:timers/promises";
import { LANDS } from "./browser-service.mjs";
import { clean, district, coordinates } from "../domain/parsing.mjs";
import { SourceUnavailableError } from "../domain/errors.mjs";
export function createLandsMapsGeocoder(browser) {
  async function waitForBackground(page, signal) {
    let loaded = true;
    try {
      await page.waitForFunction(
        () =>
          typeof viewer !== "undefined" &&
          viewer.scene?.globe?.tilesLoaded === true,
        null,
        { timeout: 45000 },
      );
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("img")]
            .filter((i) => i.getBoundingClientRect().width > 100)
            .every((i) => i.complete && i.naturalWidth > 0),
        null,
        { timeout: 15000 },
      );
    } catch {
      loaded = false;
    }
    signal.throwIfAborted();
    await delay(4000, undefined, { signal });
    return loaded;
  }
  const options = async (p, selector) =>
    p
      .locator(selector)
      .evaluate((e) =>
        Array.from(e.options).map((o) => ({ value: o.value, label: o.text })),
      );
  async function locate(record, deed, jobId, signal) {
    const page = await browser.landsPage();
    // A fresh document clears stale results. No direct API calls or authentication bypass.
    try {
      await page.goto(LANDS, { waitUntil: "commit", timeout: 30000 });
      await page
        .locator('#cbprovince option[value="50"]')
        .waitFor({ state: "attached", timeout: 120000 });
    } catch (cause) {
      signal.throwIfAborted();
      throw new SourceUnavailableError(
        "LandsMaps โหลดหน้าค้นหาไม่สำเร็จ เก็บข้อมูลประกาศไว้แล้ว กรุณาลองค้นพิกัดซ้ำภายหลัง",
        { cause },
      );
    }
    signal.throwIfAborted();
    // landsPage registers overlay handlers. Clicking their dismiss controls here
    // would trigger the same handler twice and wait for an already-closed button.
    const provinces = await options(page, "#cbprovince"),
      province = provinces.find(
        (x) => clean(x.label) === clean(record.province),
      );
    if (!province) throw Error("ไม่พบจังหวัดใน LandsMaps");
    await page.locator("#cbprovince").selectOption(province.value);
    await page
      .locator("#cbamphur option")
      .nth(1)
      .waitFor({ state: "attached" });
    const districts = (await options(page, "#cbamphur")).filter(
      (x) => district(x.label) === district(record.district),
    );
    if (districts.length !== 1)
      throw Error("ชื่ออำเภอไม่ตรงกับ LandsMaps ต้องตรวจสอบชื่อเดิม/ชื่อใหม่");
    await page.locator("#cbamphur").selectOption(districts[0].value);
    await page.locator("#faketxtparcelno").fill(deed);
    await page.locator("#btnSearch").click();
    for (let attempt = 0; attempt < 45; attempt++) {
      signal.throwIfAborted();
      const acknowledge = page.getByRole("button", {
        name: "รับทราบ",
        exact: true,
      });
      if ((await acknowledge.isVisible()) && (await acknowledge.isEnabled()))
        await acknowledge.click();
      const link = page.locator('a[href*="google.com/maps?q="]').first();
      if (await link.isVisible()) {
        const coord = coordinates(await link.innerText());
        if (!coord) throw Error("ไม่รู้จักรูปแบบพิกัดจาก LandsMaps");
        const panel = clean(await page.locator("#demo1").innerText());
        if (
          !panel.includes(record.province) ||
          !panel.includes(district(record.district)) ||
          (record.subdistrict && !panel.includes(clean(record.subdistrict)))
        )
          throw Error("พื้นที่ผลค้นหาไม่ตรงกับประกาศ ต้องตรวจสอบด้วยตนเอง");
        const backgroundReady = await waitForBackground(page, signal);
        const evidenceUrl = await browser.screenshot(
          page,
          `${record.id}-lands-${deed}`,
        );
        let mapEvidenceUrl = null,
          captureWarning = "";
        try {
          await page
            .locator('button[onclick="closeinfo()"]:visible')
            .first()
            .click();
          await page
            .locator("#demo1")
            .waitFor({ state: "hidden", timeout: 10000 });
          await delay(2500, undefined, { signal });
          mapEvidenceUrl = await browser.screenshot(
            page,
            `${record.id}-lands-${deed}-map`,
          );
        } catch (e) {
          signal.throwIfAborted();
          captureWarning = " · ปิดกล่องข้อมูลเพื่อเก็บภาพแผนที่ไม่สำเร็จ";
        }
        return {
          deed,
          ...coord,
          status: "located",
          evidenceUrl,
          mapEvidenceUrl,
          backgroundReady,
          note:
            "ค้นด้วยจังหวัด อำเภอ และเลขโฉนด; LandsMaps อาจปิดบังบางหลักของเลขโฉนด" +
            (backgroundReady
              ? ""
              : " · ภาพพื้นหลังโหลดไม่ครบภายในเวลาที่กำหนด") +
            captureWarning,
        };
      }
      const body = await page.innerText("body");
      if (body.includes("ไม่พบข้อมูล"))
        return {
          deed,
          latitude: null,
          longitude: null,
          status: "not_found",
          note: "LandsMaps ไม่พบข้อมูลแปลงนี้",
        };
      await delay(1000, undefined, { signal });
    }
    return {
      deed,
      latitude: null,
      longitude: null,
      status: "lookup_failed",
      note: "LandsMaps ไม่ส่งพิกัดภายในเวลาที่กำหนด",
    };
  }

  return { locate };
}
