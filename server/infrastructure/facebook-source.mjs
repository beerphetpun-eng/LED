import { chromium } from "playwright";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { matchPost } from "../domain/catalog.mjs";
import { filterFacebookImages } from "./facebook-image-filter.mjs";

const PAGE = "https://web.facebook.com/ledcm2";
const postUrl =
  /^https:\/\/(?:web\.|www\.)?facebook\.com\/ledcm2\/posts\/[A-Za-z0-9]+\/?$/;
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
            const more = photos.find((a) =>
              /^\+\s*\d+$/.test(a.innerText.trim()),
            );
            const photoUrls = [
              ...new Map(
                photos.flatMap((a) => {
                  const url = new URL(a.href);
                  const id = url.searchParams.get("fbid");
                  return /^\d+$/.test(id || "") &&
                    /^\/photo\/?$/.test(url.pathname) &&
                    [
                      "www.facebook.com",
                      "web.facebook.com",
                      "facebook.com",
                    ].includes(url.hostname)
                    ? [[id, a.href]]
                    : [];
                }),
              ).values(),
            ];
            if (!photoUrls.length) break;
            result.push({
              url: link.href.split("?")[0],
              text: parent.innerText,
              photoUrls,
              albumStart: more?.href,
              expectedPhotos:
                photoUrls.length +
                Number(more?.innerText.replace(/\D/g, "") || 0),
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
    const close = page.getByRole("button", { name: /^(Close|ปิด)$/ }).last();
    if (await close.isVisible())
      await close.click({ timeout: 4000 }).catch(() => {});
  }
  async function search(
    property,
    nearbyDays = 7,
    { additionalPosts = [] } = {},
  ) {
    if (busy) throw Error("กำลังอ่าน Facebook กรุณารอให้รอบก่อนเสร็จ");
    if (!property.auctionDates?.length)
      throw Error("ทรัพย์นี้ไม่มีวันประมูลสำหรับจับคู่โพสต์");
    busy = true;
    let browser, staging;
    const runId = randomUUID();
    try {
      staging = await mkdtemp(path.join(tmpdir(), "land-radar-facebook-"));
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({
        locale: "en-US",
        viewport: { width: 1440, height: 1100 },
      });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const found = new Map();
      const warnings = [];
      let unchanged = 0;
      try {
        await page.goto(PAGE, {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await dismiss(page);
        await page
          .locator('a[href*="/ledcm2/posts/"]')
          .first()
          .waitFor({ timeout: 25000 });
      } catch {
        unchanged = 5;
        warnings.push(
          "Facebook ไม่แสดงโพสต์ในฟีด จะลองเปิดโพสต์ที่บันทึกไว้โดยตรง",
        );
      }
      for (let scroll = 0; scroll < maxScrolls && unchanged < 5; scroll++) {
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
        await page.mouse.move(700, 840);
        await page.mouse.wheel(0, 1800);
        await page.waitForTimeout(1200);
        await dismiss(page);
      }
      const knownUrls = new Set([
        ...(property.facebook?.posts || []).map(({ url }) => url),
        ...additionalPosts,
      ]);
      for (const url of knownUrls) {
        if (!postUrl.test(url) || found.has(url)) continue;
        try {
          await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await page
            .locator('a[href*="/photo"]')
            .first()
            .waitFor({ timeout: 10000 });
          const post = (await readFacebookPosts(page)).find(
            (entry) => entry.url.replace(/\/$/, "") === url.replace(/\/$/, ""),
          );
          if (post) found.set(post.url, post);
        } catch {
          warnings.push("Facebook เปิดโพสต์ที่บันทึกไว้บางรายการไม่สำเร็จ");
        }
      }
      const candidates = [...found.values()]
        .map((p) => ({
          ...p,
          match: matchPost(p.text, property.auctionDates, nearbyDays),
        }))
        .filter((p) => p.match)
        .sort((a, b) => a.match.days - b.match.days)
        .slice(0, maxPosts);
      const posts = [];
      for (const candidate of candidates) {
        const images = [];
        const seen = new Set();
        const downloadedSources = new Set();
        let previousSrc = "";
        const start = new URL(candidate.albumStart || candidate.photoUrls[0]);
        const album = start.searchParams.get("set");
        const capture = async (photoId) => {
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
              (imgs, previous) =>
                imgs
                  .filter(
                    (i) =>
                      i.getBoundingClientRect().width > 350 &&
                      i.naturalWidth > 500 &&
                      i.complete &&
                      i.currentSrc !== previous,
                  )
                  .sort(
                    (a, b) =>
                      b.getBoundingClientRect().width *
                        b.getBoundingClientRect().height -
                      a.getBoundingClientRect().width *
                        a.getBoundingClientRect().height,
                  )[0]?.currentSrc,
              previousSrc,
            );
          if (!src) throw Error("ไม่พบภาพต้นฉบับ");
          previousSrc = src;
          if (downloadedSources.has(src))
            throw Error("ภาพเดิมยังแสดงอยู่ในตัวดูรูป");
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
            throw Error("โหลดรูป Facebook ไม่สำเร็จ HTTP " + response.status());
          const type = response.headers()["content-type"]?.split(";")[0],
            extension = {
              "image/jpeg": "jpg",
              "image/png": "png",
              "image/webp": "webp",
            }[type];
          if (!extension) throw Error("รูปแบบรูปภาพไม่รองรับ");
          const filename = `fb-${photoId}-${runId}.${extension}`;
          await writeFile(path.join(staging, filename), await response.body());
          images.push({
            url: "/evidence/" + filename,
            sourceUrl: page.url(),
            photoId,
          });
          downloadedSources.add(src);
        };
        for (const link of [start.href, ...candidate.photoUrls]) {
          if (seen.size >= maxPhotos) break;
          const seed = new URL(link);
          if (
            !seed.searchParams.get("fbid") ||
            seen.has(seed.searchParams.get("fbid"))
          )
            continue;
          try {
            await page.goto(link, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            while (seen.size < maxPhotos) {
              const current = new URL(page.url());
              const photoId = current.searchParams.get("fbid");
              if (
                !/^\d+$/.test(photoId || "") ||
                seen.has(photoId) ||
                current.searchParams.get("set") !== album
              )
                break;
              await capture(photoId);
              seen.add(photoId);
              if (
                link !== start.href ||
                images.length >= candidate.expectedPhotos
              )
                break;
              await dismiss(page);
              try {
                await page
                  .getByRole("button", { name: /^(Next photo|รูปภาพถัดไป)$/ })
                  .click({ timeout: 5500 });
                await page.waitForURL(
                  (url) => url.searchParams.get("fbid") !== photoId,
                  { timeout: 5500 },
                );
              } catch {
                // The remaining public links can still be opened individually.
                break;
              }
            }
          } catch (e) {
            warnings.push(
              `อ่านรูปบางส่วนไม่สำเร็จ: ${e.message.split("\n")[0]}`,
            );
          }
        }
        if (images.length < candidate.expectedPhotos)
          warnings.push(
            `เก็บได้ ${images.length} จากอย่างน้อย ${candidate.expectedPhotos} รูปที่ Facebook ระบุ กรุณาดูโพสต์ต้นฉบับเพิ่มเติม`,
          );
        posts.push({
          url: candidate.url,
          text: candidate.text,
          match: candidate.match,
          images,
          rowMatched: false,
          expectedPhotos: candidate.expectedPhotos,
          downloadedPhotos: images.length,
        });
      }
      const filtered = await filterFacebookImages(
        posts,
        property.caseNumber,
        staging,
      );
      const retained = new Set(
        filtered.posts.flatMap((post) => post.images.map((image) => image.url)),
      );
      for (const url of retained) {
        const filename = path.basename(url);
        await copyFile(
          path.join(staging, filename),
          path.join(evidencePath, filename),
        );
      }
      return {
        checkedAt: new Date().toISOString(),
        ...filtered,
        warnings,
        scannedPosts: found.size,
        nearbyDays,
        note:
          "จับคู่คำว่า ขายทอดตลาดทรัพย์ และวันประมูล ±" +
          nearbyDays +
          " วัน จากโพสต์ที่หน้าเว็บเปิดให้เห็น (เลื่อนได้สูงสุด " +
          maxScrolls +
          " รอบ)",
      };
    } catch (e) {
      throw Error(
        "Facebook: " +
          e.message.split("\n")[0] +
          " — หากเว็บจำกัดการเข้าถึง ให้เปิดหน้าเพจตรวจด้วยตนเอง",
      );
    } finally {
      try {
        await browser?.close();
      } finally {
        busy = false;
        if (staging) await rm(staging, { recursive: true, force: true });
      }
    }
  }
  return { search };
}
