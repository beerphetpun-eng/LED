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
          const caption = parent
            .querySelector(
              '[data-ad-preview="message"], [data-ad-comet-preview="message"]',
            )
            ?.innerText.trim();
          const text = caption || parent.innerText;
          if (photos.length && /ขาย\s*ทอดตลาด/.test(text)) {
            const extraPhotos = (anchor) =>
              Number(
                /^\+\s*(\d+)$/.exec(anchor.innerText.trim())?.[1] ||
                  /\b(\d+) remaining items?\b/i.exec(
                    anchor.getAttribute("aria-label") || "",
                  )?.[1] ||
                  0,
              );
            const more = photos.find((anchor) => extraPhotos(anchor) > 0);
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
              text,
              photoUrls,
              albumStart: more?.href,
              expectedPhotos: photoUrls.length + (more ? extraPhotos(more) : 0),
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
  { maxScrolls = 20, profilePath } = {},
) {
  let busy = false;
  let signIn;
  const browserOptions = {
    locale: "en-US",
    viewport: { width: 1440, height: 1100 },
  };
  const profileOptions = {
    ...browserOptions,
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    acceptDownloads: false,
  };
  async function openSignIn() {
    if (!profilePath) throw Error("ยังไม่ได้ตั้งค่าเบราว์เซอร์ Facebook");
    if (busy) throw Error("กำลังดึงรูป Facebook กรุณารอให้รอบนี้เสร็จ");
    busy = true;
    let context = signIn;
    const opening = !context;
    try {
      if (!context) {
        context = await chromium.launchPersistentContext(profilePath, {
          ...profileOptions,
          headless: false,
        });
        signIn = context;
        context.on("close", () => {
          if (signIn === context) signIn = undefined;
        });
      }
      const page = context.pages()[0] || (await context.newPage());
      await page.bringToFront();
      if (opening)
        await page.goto("https://www.facebook.com/login/", {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
    } catch (error) {
      await context?.close().catch(() => {});
      throw error;
    } finally {
      busy = false;
    }
  }
  async function dismiss(page) {
    const close = page.getByRole("button", { name: /^(Close|ปิด)$/ }).last();
    if (await close.isVisible())
      await close.click({ timeout: 4000 }).catch(() => {});
  }
  async function search(
    property,
    nearbyDays = 0,
    { additionalPosts = [] } = {},
  ) {
    if (additionalPosts.some((url) => !postUrl.test(url)))
      throw Error("ใช้ลิงก์โพสต์จากเพจสำนักงานบังคับคดีเชียงใหม่ (ledcm2)");
    if (busy) throw Error("กำลังอ่าน Facebook กรุณารอให้รอบก่อนเสร็จ");
    if (!property.auctionDates?.length)
      throw Error("ทรัพย์นี้ไม่มีวันประมูลสำหรับจับคู่โพสต์");
    busy = true;
    const interactiveContext = signIn;
    let browser,
      context = interactiveContext,
      page,
      staging;
    const runId = randomUUID();
    try {
      staging = await mkdtemp(path.join(tmpdir(), "land-radar-facebook-"));
      if (!context && profilePath) {
        context = await chromium.launchPersistentContext(profilePath, {
          ...profileOptions,
          headless: true,
        });
      } else if (!context) {
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext(browserOptions);
      }
      page = await context.newPage();
      page.setDefaultTimeout(15000);
      const found = new Map();
      const warnings = [];
      let loginRequired = false;
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
      const previousPosts = new Map(
        [
          ...(property.facebook?.albumCoverage || []),
          ...(property.facebook?.posts || []),
        ].map((post) => [post.url, post]),
      );
      const knownUrls = new Set([...previousPosts.keys(), ...additionalPosts]);
      for (const url of knownUrls) {
        if (!postUrl.test(url)) continue;
        const fromFeed = found.get(url);
        if (
          fromFeed &&
          !additionalPosts.includes(url) &&
          matchPost(fromFeed.text, property.auctionDates, nearbyDays)
        )
          continue;
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
          if (post) found.set(url, { ...post, url });
        } catch {
          warnings.push("Facebook เปิดโพสต์ที่บันทึกไว้บางรายการไม่สำเร็จ");
        }
      }
      for (const url of additionalPosts) {
        const post = found.get(url);
        if (post && !matchPost(post.text, property.auctionDates, nearbyDays))
          warnings.push(
            "วันที่ในลิงก์โพสต์ที่ระบุอยู่นอกช่วงวันประมูลที่เลือก",
          );
      }
      for (const [url, prior] of previousPosts) {
        if (postUrl.test(url) && !found.has(url))
          found.set(url, {
            url,
            text: prior.text,
            photoUrls: [],
            expectedPhotos: 0,
          });
      }
      const candidates = [...found.values()]
        .map((p) => ({
          ...p,
          match: matchPost(p.text, property.auctionDates, nearbyDays),
        }))
        .filter((p) => p.match)
        .sort((a, b) => a.match.days - b.match.days);
      const posts = [];
      for (const candidate of candidates) {
        const previousPost = previousPosts.get(candidate.url);
        const expectedPhotos =
          Math.max(
            candidate.expectedPhotos,
            previousPost?.expectedPhotos || 0,
          ) || null;
        const images = [];
        const seen = new Set();
        const downloadedSources = new Set();
        const photoSources = new Map();
        let previousSrc = "";
        const startLink = candidate.photoUrls[0];
        const album = startLink && new URL(startLink).searchParams.get("set");
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
          photoSources.set(photoId, src);
        };
        for (const link of new Set(
          [startLink, candidate.albumStart, ...candidate.photoUrls].filter(
            Boolean,
          ),
        )) {
          if (seen.size >= expectedPhotos) break;
          const seed = new URL(link);
          const traverse = link === startLink || link === candidate.albumStart;
          if (seen.has(seed.searchParams.get("fbid")) && !traverse) continue;
          try {
            await page.goto(link, {
              waitUntil: "domcontentloaded",
              timeout: 30000,
            });
            const visited = new Set();
            previousSrc = "";
            while (
              seen.size < expectedPhotos &&
              visited.size < expectedPhotos
            ) {
              const current = new URL(page.url());
              const photoId = current.searchParams.get("fbid");
              if (
                !/^\d+$/.test(photoId || "") ||
                visited.has(photoId) ||
                current.searchParams.get("set") !== album
              )
                break;
              visited.add(photoId);
              if (!seen.has(photoId)) {
                try {
                  await capture(photoId);
                  seen.add(photoId);
                } catch {
                  // An unavailable image must not prevent checking the next one.
                }
              } else {
                previousSrc = photoSources.get(photoId) || "";
              }
              if (!traverse || seen.size >= expectedPhotos) break;
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
                const login = page.getByRole("dialog").filter({
                  hasText:
                    /See more on Facebook|Log in to Facebook|เข้าสู่ระบบ/,
                });
                if (await login.first().isVisible()) loginRequired = true;
                // Other links visible on the post can still be read directly.
                break;
              }
            }
          } catch (e) {
            warnings.push(
              `อ่านรูปบางส่วนไม่สำเร็จ: ${e.message.split("\n")[0]}`,
            );
          }
        }
        for (const prior of previousPost?.images || []) {
          if (
            seen.has(prior.photoId) ||
            !/^\/evidence\/fb-[a-z0-9-]+\.(jpg|png|webp)$/.test(prior.url)
          )
            continue;
          const filename = path.basename(prior.url);
          try {
            await copyFile(
              path.join(evidencePath, filename),
              path.join(staging, filename),
            );
            images.push(prior);
            seen.add(prior.photoId);
          } catch (error) {
            if (error.code !== "ENOENT") throw error;
          }
        }
        if (expectedPhotos == null || images.length < expectedPhotos)
          warnings.push(
            expectedPhotos == null
              ? "Facebook ไม่แสดงจำนวนรูปในโพสต์ จึงยังยืนยันไม่ได้ว่าดึงครบ"
              : `เก็บได้ ${images.length} จาก ${expectedPhotos} รูปที่ Facebook ระบุ`,
          );
        posts.push({
          url: candidate.url,
          text: candidate.text,
          match: candidate.match,
          images,
          rowMatched: images.some((image) => image.caseBoxes?.length),
          expectedPhotos,
          downloadedPhotos: images.length,
        });
      }
      const filtered = await filterFacebookImages(
        posts,
        property.caseNumber,
        staging,
      );
      const requiresSignIn =
        loginRequired && filtered.caseFilter?.status === "incomplete";
      if (requiresSignIn)
        warnings.push("Facebook ขอให้เข้าสู่ระบบเพื่อเปิดรูปถัดไป");
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
        albumCoverage: posts.map(({ images, rowMatched, ...album }) => album),
        warnings,
        requiresSignIn,
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
        try {
          if (interactiveContext) await page?.close().catch(() => {});
          else await context?.close();
        } finally {
          await browser?.close();
        }
      } finally {
        busy = false;
        if (staging) await rm(staging, { recursive: true, force: true });
      }
    }
  }
  return { search, openSignIn };
}
