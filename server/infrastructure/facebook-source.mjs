import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { matchPost } from "../domain/catalog.mjs";

const PAGE = "https://web.facebook.com/ledcm2";
export async function readFacebookPosts(page) {
  return await page
    .locator('a[href*="/ledcm2/posts/"]')
    .evaluateAll((links) => {
      const result = [];
      for (const link of links) {
        let parent = link.parentElement;
        for (
          let depth = 0;
          parent && depth < 18;
          depth++, parent = parent.parentElement
        ) {
          const photos = [...parent.querySelectorAll('a[href*="/photo"]')];
          const postLinks = new Set(
            [...parent.querySelectorAll('a[href*="/ledcm2/posts/"]')].map(
              (a) => a.href.split("?")[0],
            ),
          );
          if (postLinks.size > 1) break;
          if (photos.length && parent.innerText.includes("ขายทอดตลาด")) {
            result.push({
              url: link.href.split("?")[0],
              text: parent.innerText,
              photoUrls: [...new Set(photos.map((a) => a.href))],
            });
            break;
          }
        }
      }
      return result;
    });
}
export function createFacebookSource(
  evidencePath,
  { maxScrolls = 20, maxPosts = 6, maxPhotos = 60 } = {},
) {
  let busy = false;
  async function dismiss(page) {
    const close = page.getByRole("button", { name: /^(Close|ปิด)$/ }).first();
    if (
      (await page
        .getByRole("textbox", {
          name: /Email address or phone number|อีเมลหรือหมายเลขโทรศัพท์/,
        })
        .isVisible()) &&
      (await close.isVisible())
    )
      await close.click();
  }
  async function search(property, nearbyDays = 7) {
    if (busy) throw Error("กำลังอ่าน Facebook กรุณารอให้รอบก่อนเสร็จ");
    if (!property.auctionDates?.length)
      throw Error("ทรัพย์นี้ไม่มีวันประมูลสำหรับจับคู่โพสต์");
    busy = true;
    let browser;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        locale: "en-US",
        viewport: { width: 1440, height: 1100 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 60000 });
      await dismiss(page);
      await page
        .locator('a[href*="/ledcm2/posts/"]')
        .first()
        .waitFor({ timeout: 25000 });
      const found = new Map();
      let unchanged = 0;
      for (let scroll = 0; scroll < maxScrolls; scroll++) {
        for (const button of (
          await page
            .getByRole("button", { name: /^(See more|ดูเพิ่มเติม)$/ })
            .all()
        ).slice(0, 10))
          if (await button.isVisible()) await button.click().catch(() => {});
        const posts = await readFacebookPosts(page);
        const before = found.size;
        for (const p of posts) found.set(p.url, p);
        unchanged = before === found.size ? unchanged + 1 : 0;
        if (unchanged >= 5) break;
        await page.mouse.wheel(0, 1800);
        await page.waitForTimeout(1200);
        await dismiss(page);
      }
      const candidates = [...found.values()]
        .map((p) => ({
          ...p,
          match: matchPost(p.text, property.auctionDates, nearbyDays),
        }))
        .filter((p) => p.match)
        .sort((a, b) => a.match.days - b.match.days)
        .slice(0, maxPosts);
      const posts = [],
        warnings = [];
      for (const candidate of candidates) {
        const images = [];
        let album,
          seen = new Set(),
          previousSrc = "",
          limitedNavigation = false;
        try {
          // Use photo links observed in the feed; virtualized anchors may no longer be clickable.
          const firstId = new URL(candidate.photoUrls[0]).searchParams.get(
            "fbid",
          );
          if (!firstId || !/^\d+$/.test(firstId))
            throw Error("ไม่พบรหัสภาพในโพสต์");
          await page.goto(candidate.photoUrls[0], {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await page.waitForURL((u) => u.searchParams.get("fbid") === firstId, {
            timeout: 15000,
          });
          album = new URL(page.url()).searchParams.get("set");
          for (let index = 0; index < maxPhotos; index++) {
            const photoId = new URL(page.url()).searchParams.get("fbid");
            if (
              !photoId ||
              !/^\d+$/.test(photoId) ||
              seen.has(photoId) ||
              new URL(page.url()).searchParams.get("set") !== album
            )
              break;
            seen.add(photoId);
            await page.waitForFunction(
              (previous) =>
                [...document.images].some(
                  (i) =>
                    i.getBoundingClientRect().width > 350 &&
                    i.naturalWidth > 500 &&
                    i.complete &&
                    i.currentSrc !== previous,
                ),
              previousSrc,
              { timeout: 20000 },
            );
            const src = await page
              .locator("img")
              .evaluateAll(
                (imgs) =>
                  imgs
                    .filter(
                      (i) =>
                        i.getBoundingClientRect().width > 350 &&
                        i.naturalWidth > 500 &&
                        i.complete,
                    )
                    .sort(
                      (a, b) =>
                        b.getBoundingClientRect().width *
                          b.getBoundingClientRect().height -
                        a.getBoundingClientRect().width *
                          a.getBoundingClientRect().height,
                    )[0]?.currentSrc,
              );
            if (!src) throw Error("ไม่พบภาพต้นฉบับ");
            previousSrc = src;
            const url = new URL(src);
            if (
              url.protocol !== "https:" ||
              !(
                url.hostname.endsWith(".fbcdn.net") ||
                url.hostname.endsWith(".facebook.com")
              )
            )
              throw Error("ภาพมาจากโดเมนที่ไม่รองรับ");
            const response = await context.request.get(src, {
              timeout: 30000,
              maxRedirects: 0,
            });
            if (!response.ok())
              throw Error(
                "โหลดรูป Facebook ไม่สำเร็จ HTTP " + response.status(),
              );
            const type = response.headers()["content-type"]?.split(";")[0],
              extension = {
                "image/jpeg": "jpg",
                "image/png": "png",
                "image/webp": "webp",
              }[type];
            if (!extension) throw Error("รูปแบบรูปภาพไม่รองรับ");
            const filename = `fb-${photoId}.${extension}`;
            await writeFile(
              path.join(evidencePath, filename),
              await response.body(),
            );
            images.push({
              url: "/evidence/" + filename,
              sourceUrl: page.url(),
              photoId,
            });
            const next = page.getByRole("button", {
              name: /^(Next photo|รูปภาพถัดไป)$/,
            });
            try {
              await next.waitFor({ state: "visible", timeout: 8000 });
            } catch {
              limitedNavigation = true;
              const other = candidate.photoUrls.find(
                (value) => !seen.has(new URL(value).searchParams.get("fbid")),
              );
              if (!other) break;
              await page.goto(other, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
              });
              continue;
            }
            const oldUrl = page.url();
            await next.click();
            await page.waitForURL((u) => u.href !== oldUrl, { timeout: 10000 });
            await page.waitForTimeout(500);
          }
          if (seen.size >= maxPhotos)
            warnings.push(
              `อ่านถึงขีดจำกัด ${maxPhotos} รูป กรุณาดูโพสต์ต้นฉบับเพิ่มเติม`,
            );
          if (limitedNavigation)
            warnings.push(
              "Facebook ไม่แสดงปุ่มอ่านอัลบั้มต่อ เก็บเฉพาะลิงก์ภาพที่พบในหน้าเพจ อาจมีภาพเพิ่มเติมในโพสต์ต้นฉบับ",
            );
          if (images.length < candidate.photoUrls.length)
            warnings.push(
              `เก็บได้ ${images.length} รูป แต่โพสต์มีภาพอย่างน้อย ${candidate.photoUrls.length} รูป กรุณาดูโพสต์ต้นฉบับเพิ่ม`,
            );
        } catch (e) {
          warnings.push(`อ่านรูปบางส่วนไม่สำเร็จ: ${e.message.split("\n")[0]}`);
        }
        posts.push({
          url: candidate.url,
          text: candidate.text,
          match: candidate.match,
          images,
          rowMatched: false,
        });
      }
      return {
        checkedAt: new Date().toISOString(),
        posts,
        warnings,
        scannedPosts: found.size,
        nearbyDays,
        note:
          "จับคู่คำว่า ขายทอดตลาดทรัพย์ และวันประมูล ±" +
          nearbyDays +
          " วัน จากโพสต์ที่หน้าเว็บเปิดให้เห็น (เลื่อนได้สูงสุด " +
          maxScrolls +
          " รอบ) เก็บภาพเต็ม ยังไม่ได้ยืนยันแถวหรือเลขคดี ไม่แก้สถานะที่ผู้ใช้กรอก",
      };
    } catch (e) {
      throw Error(
        "Facebook: " +
          e.message.split("\n")[0] +
          " — หากเว็บจำกัดการเข้าถึง ให้เปิดหน้าเพจตรวจด้วยตนเอง",
      );
    } finally {
      await browser?.close();
      busy = false;
    }
  }
  return { search };
}
