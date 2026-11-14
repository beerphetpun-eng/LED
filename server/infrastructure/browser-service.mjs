import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { number, validateValues } from "../domain/parsing.mjs";
export const LED = "https://asset.led.go.th/newbidreg/default.asp",
  LANDS = "https://landsmaps.dol.go.th/";
export const root = fileURLToPath(new URL("../", import.meta.url)),
  evidencePath = path.join(root, "data", "evidence");

export async function registerLandsOverlays(page) {
  const controls = [
    page
      .locator("#modal_news")
      .getByRole("button", {
        name: "ปิดหน้าต่าง",
        exact: true,
      })
      .first(),
    page.getByRole("button", { name: "ปฏิเสธทั้งหมด", exact: true }).first(),
  ];
  for (const control of controls) {
    await page.addLocatorHandler(control, async (button) => {
      try {
        await button.click({ timeout: 3000 });
      } catch {
        // An overlay can disappear or change while the handler is running.
        // Let the awaited search action report a timeout if still blocked.
      }
    });
  }
}

export class BrowserService {
  busy = false;
  lock = false;
  browser = null;
  led = null;
  lands = null;
  refreshedAt = null;
  lastDialog = null;
  pageErrors = [];
  async exclusive(fn) {
    if (this.busy || this.lock)
      throw Error("มีงานกำลังทำงานอยู่ กรุณารอสักครู่");
    this.lock = true;
    try {
      return await fn();
    } finally {
      this.lock = false;
    }
  }
  async init() {
    await mkdir(evidencePath, { recursive: true });
    this.browser ??= await chromium.launch({ headless: true });
    if (!this.led || this.led.isClosed()) {
      const context = await this.browser.newContext({
        viewport: { width: 1440, height: 1100 },
        locale: "th-TH",
      });
      this.led = await context.newPage();
      this.led.setDefaultTimeout(20000);
      this.led.on("pageerror", (error) => {
        this.pageErrors.push(error.message);
        this.pageErrors = this.pageErrors.slice(-10);
      });
      this.led.on("dialog", async (d) => {
        this.lastDialog = d.message();
        try {
          await d.dismiss();
        } catch (error) {
          if (!this.led?.isClosed())
            console.error("Could not dismiss LED dialog:", error.message);
        }
      });
    }
  }
  async schema(refresh = false) {
    await this.init();
    const p = this.led;
    if (
      refresh ||
      !p.url().includes("default.asp") ||
      !(await p.locator("#webForm").isVisible())
    ) {
      await p.goto(LED, { waitUntil: "domcontentloaded", timeout: 60000 });
      await p
        .locator('#provinces option[value="50"]')
        .waitFor({ state: "attached" });
      await p.locator("#provinces").selectOption("50");
      await p
        .locator("#amphurSelect option")
        .nth(1)
        .waitFor({ state: "attached" });
      this.refreshedAt = new Date().toISOString();
    }
    const fields = await p.locator("#webForm").evaluate((form) =>
      Array.from(form.querySelectorAll("input:not([type=hidden]),select"))
        .filter((e) => e.name !== "seckey" && e.type !== "submit")
        .map((e) => {
          const box =
            e.closest(".mb-2") || e.closest("[class*=col-]") || e.parentElement;
          return {
            key: e.id || e.name,
            label: (
              box.querySelector("label")?.innerText ||
              e.placeholder ||
              e.title ||
              e.name ||
              e.id
            ).trim(),
            kind: e.tagName === "SELECT" ? "select" : "text",
            value: e.value,
            options:
              e.tagName === "SELECT"
                ? Array.from(e.options).map((o) => ({
                    value: o.value,
                    label: o.text.replace(/\uFEFF/g, "").trim(),
                  }))
                : [],
          };
        }),
    );
    return {
      fields,
      refreshedAt: this.refreshedAt,
    };
  }
  async select(key, value) {
    if (!["provinces", "amphurSelect", "tambonSelect"].includes(key))
      throw Error("ไม่รู้จักตัวกรอง");
    if (!this.led) await this.schema();
    const p = this.led;
    const next =
      key === "provinces"
        ? "#amphurSelect"
        : key === "amphurSelect"
          ? "#tambonSelect"
          : null;
    const response =
      next && value
        ? p
            .waitForResponse(
              (r) =>
                r
                  .url()
                  .includes(key === "provinces" ? "get_amphur" : "get_tambon"),
              { timeout: 15000 },
            )
            .catch(() => null)
        : null;
    await p.locator("#" + key).selectOption(value);
    if (response) await response;
    if (next && value)
      await p
        .locator(next + " option")
        .nth(1)
        .waitFor({ state: "attached" });
    return this.schema();
  }
  async apply(values) {
    validateValues(values);
    if (!this.led) throw Error("โหลดตัวกรองก่อนค้นหา");
    for (const key of ["provinces", "amphurSelect", "tambonSelect"])
      if (
        key in values &&
        values[key] !== (await this.led.locator("#" + key).inputValue())
      )
        await this.select(key, values[key]);
    const schema = await this.schema();
    const allowed = new Map(schema.fields.map((f) => [f.key, f]));
    for (const [key, value] of Object.entries(values)) {
      if (["provinces", "amphurSelect", "tambonSelect"].includes(key)) continue;
      const field = allowed.get(key);
      if (!field)
        throw Error(`ตัวกรอง ${key} ไม่มีในเว็บแล้ว กรุณาอัปเดต bookmark`);
      const el = this.led
        .locator(`#webForm [id="${key}"],#webForm [name="${key}"]`)
        .first();
      if (field.kind === "select") await el.selectOption(value);
      else if (key === "start_date")
        await el.evaluate((e, v) => {
          e.value = v;
          e.dispatchEvent(new Event("change", { bubbles: true }));
        }, value);
      else await el.fill(value);
    }
    if (values.rai_if === "3" && number(values.rai) !== null) {
      const whole = Math.floor(number(values.rai));
      await this.led
        .locator("[name=rai]")
        .fill(whole < 1 ? "" : String(whole - 1));
    }
  }
  async verificationCode() {
    const shown = this.led.locator("#sesskey");
    if (!(await shown.isVisible()))
      throw Error("ต้นทางไม่แสดงรหัสยืนยันแบบข้อความ กรุณาตรวจตัวเชื่อมต่อ");
    const code = (await shown.innerText()).trim();
    if (!/^\d{6}$/.test(code))
      throw Error("รูปแบบรหัสยืนยันต้นทางเปลี่ยน ไม่สามารถซิงค์อัตโนมัติได้");
    return code;
  }
  async submit(captcha) {
    this.lastDialog = null;
    await this.led.locator("#pass").fill(captcha);
    await this.led.locator("#GFG_Button").click();
    await this.led.waitForLoadState("domcontentloaded");
    try {
      await this.led.waitForFunction(
        () =>
          document.querySelector("tr form[action*=asset_open]") ||
          /ไม่พบ.*(?:ข้อมูล|ทรัพย์|รายการ)|พบ\s*0\s*รายการ/.test(
            document.body.innerText,
          ),
        null,
        { timeout: 35000 },
      );
    } catch {
      throw Error(
        this.lastDialog ||
          "เว็บต้นทางไม่แสดงผลค้นหา กรุณากดซิงค์ใหม่เพื่อให้ระบบอ่านรหัสยืนยันชุดใหม่",
      );
    }
  }
  async landsPage() {
    await this.init();
    if (!this.lands || this.lands.isClosed()) {
      const c = await this.browser.newContext({
        viewport: { width: 1440, height: 1000 },
        locale: "th-TH",
      });
      this.lands = await c.newPage();
      this.lands.setDefaultTimeout(20000);
      await registerLandsOverlays(this.lands);
    }
    return this.lands;
  }
  async screenshot(page, name) {
    await page.screenshot({
      path: path.join(evidencePath, name + ".png"),
      fullPage: true,
      timeout: 30000,
    });
    return "/evidence/" + name + ".png";
  }
  async diagnostic(page, runId, error) {
    const name = "diagnostic-" + String(runId).replace(/[^a-zA-Z0-9_-]/g, "");
    await writeFile(
      path.join(root, "data", name + ".html"),
      await page.content(),
    );
    await writeFile(
      path.join(root, "data", name + ".json"),
      JSON.stringify({
        url: page.url(),
        pageErrors: this.pageErrors,
        pages: page
          .context()
          .pages()
          .map((p) => p.url()),
        error: error?.stack || String(error || ""),
        rows: await page
          .locator(
            'tr:has(form[action*="asset_open"]):not(:has(tr form[action*="asset_open"]))',
          )
          .evaluateAll((rows) =>
            rows.map((r) => ({ cells: r.cells.length, html: r.outerHTML })),
          ),
      }),
    );
    await page.screenshot({
      path: path.join(root, "data", name + ".png"),
      fullPage: false,
    });
  }
  async close() {
    await this.browser?.close();
  }
}
