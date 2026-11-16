import { chromium } from "playwright";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  bangkokDay,
  auctionISO,
  facebookPublishedDay,
  facebookPublicationRelevant,
  matchPost,
  selectFacebookPosts,
} from "../domain/catalog.mjs";
import { filterFacebookImages } from "./facebook-image-filter.mjs";

const PAGE = "https://web.facebook.com/ledcm2";
const postUrl =
  /^https:\/\/(?:web\.|www\.)?facebook\.com\/ledcm2\/posts\/(?:[A-Za-z0-9]+|[\p{L}\p{N}%._-]+\/\d+)\/?$/u;
const truncatedCaption = /(?:…|\.\.\.)\s*(?:See more|ดูเพิ่มเติม)/i;

async function dismiss(page) {
  const close = page.getByRole("button", { name: /^(Close|ปิด)$/ }).last();
  if (await close.isVisible())
    await close.click({ timeout: 4000 }).catch(() => {});
}

export async function navigateFacebookPhoto(page, current, direction = "next") {
  const photoId = current.searchParams.get("fbid");
  const album = current.searchParams.get("set");
  const login = page
    .getByRole("dialog")
    .filter({
      hasText: /See more on Facebook|Log in to Facebook|เข้าสู่ระบบ/,
    })
    .first();
  const name =
    direction === "next"
      ? /^(Next photo|รูปภาพถัดไป)$/
      : /^(Previous photo|รูปภาพก่อนหน้า)$/;
  let loginRequired = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) {
      // Reload the current public photo to reset the viewer before using its controls again.
      const options = { waitUntil: "domcontentloaded", timeout: 20000 };
      if (page.url() === current.href) await page.reload(options);
      else await page.goto(current.href, options);
    }
    await dismiss(page);
    try {
      await page.getByRole("button", { name }).click({ timeout: 5500 });
      await page.waitForURL(
        (url) => {
          const nextId = url.searchParams.get("fbid");
          return (
            /^\d+$/.test(nextId || "") &&
            nextId !== photoId &&
            url.searchParams.get("set") === album
          );
        },
        { timeout: 5500 },
      );
      return { advanced: true, loginRequired: false };
    } catch {
      loginRequired ||= await login.isVisible();
    }
  }
  return { advanced: false, loginRequired };
}

export async function readFacebookPosts(page, includeReferences = false) {
  const posts = await page
    .locator('a[href*="/ledcm2/posts/"]')
    .evaluateAll((links, includeReferences) => {
      const result = [];
      for (const link of links) {
        const reference = {
          url: link.href.split("?")[0],
          publicationLabel: link.title + " " + link.parentElement.innerText,
        };
        let post;
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
            post = {
              ...reference,
              text,
              photoUrls,
              albumStart: more?.href,
              expectedPhotos: photoUrls.length + (more ? extraPhotos(more) : 0),
            };
            break;
          }
        }
        if (post || includeReferences)
          result.push(post || { ...reference, text: "", photoUrls: [] });
      }
      return result;
    }, includeReferences);
  return posts.map(({ publicationLabel, ...post }) => ({
    ...post,
    publishedOn: facebookPublishedDay(publicationLabel),
  }));
}

export async function readFacebookPermalink(page, url) {
  const posts = await readFacebookPosts(page);
  const exact = posts.find(
    (entry) => entry.url.replace(/\/$/, "") === url.replace(/\/$/, ""),
  );
  if (exact) return exact;

  // The timestamp link can use another opaque identifier for the same post.
  const canonical = await page
    .locator('link[rel="canonical"]')
    .evaluateAll((links) => links[0]?.href ?? "");
  const id = /\/ledcm2\/posts\/(?:[^/]+\/)?(\d+)\/?$/.exec(canonical)?.[1];
  return (
    id &&
    posts.find((entry) =>
      entry.photoUrls.some(
        (photo) => new URL(photo).searchParams.get("set") === `pcb.${id}`,
      ),
    )
  );
}

function rememberPosts(found, posts) {
  for (const post of posts) {
    if (!postUrl.test(post.url)) continue;
    if (post.text || !found.get(post.url)?.text) found.set(post.url, post);
  }
}

async function collectPublicPosts(page, found, maxScrolls, stableLimit = 5) {
  let unchanged = 0;
  let limited = false;
  for (let scroll = 0; scroll <= maxScrolls; scroll++) {
    const before = found.size;
    rememberPosts(found, await readFacebookPosts(page, true));
    const gate = page
      .getByRole("dialog")
      .filter({
        hasText: /See more on Facebook|Log in to Facebook|เข้าสู่ระบบ/,
      })
      .first();
    if (await gate.isVisible()) limited = true;
    unchanged = before === found.size ? unchanged + 1 : 0;
    if ((scroll >= 3 && unchanged >= stableLimit) || scroll === maxScrolls)
      break;
    await page.mouse.move(700, 840);
    await page.mouse.wheel(0, 1800);
    await page.waitForTimeout(1000);
    await dismiss(page);
  }
  return limited;
}

export function nextFacebookArchiveLink(posts, auctionDates, checked) {
  const days = auctionDates.map(Date.parse);
  const distance = (day) =>
    Math.min(...days.map((date) => Math.abs(date - Date.parse(day))));
  return [...posts]
    .filter((p) => postUrl.test(p.url) && !checked.has(p.url) && p.publishedOn)
    .sort((a, b) => distance(a.publishedOn) - distance(b.publishedOn))[0]?.url;
}

export function createFacebookSource(
  evidencePath,
  {
    maxScrolls = 20,
    postIndex,
    launchBrowser = () => chromium.launch({ headless: true }),
  } = {},
) {
  let busy = false;
  let indexTask, indexTimer, indexBrowser;
  const feedOptions = {
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: false,
  };
  async function savePostIndex(index, posts) {
    if (!postIndex) return;
    const entries = new Map(index.posts.map((p) => [p.url, p]));
    for (const { url, publishedOn, text, expectedPhotos } of posts) {
      if (!publishedOn || !postUrl.test(url)) continue;
      const caption = truncatedCaption.test(text) ? "" : text;
      const previous = entries.get(url);
      entries.set(url, {
        url,
        publishedOn,
        text: caption || previous?.text || "",
        expectedPhotos: expectedPhotos || previous?.expectedPhotos,
      });
    }
    await postIndex.write({
      checkedAt: index.checkedAt,
      posts: [...entries.values()],
    });
  }

  async function indexFeed() {
    const index = await postIndex.read();
    if (Date.now() - Date.parse(index.checkedAt) < 6 * 3600000) return;
    const found = new Map();
    indexBrowser = await launchBrowser();
    try {
      const page = await indexBrowser.newPage(feedOptions);
      await page.goto(PAGE, { waitUntil: "domcontentloaded", timeout: 30000 });
      await dismiss(page);
      await collectPublicPosts(page, found, 8);
      const alreadyRead = new Set(
        index.posts.filter((post) => post.text).map((post) => post.url),
      );
      const previews = [...found.values()]
        .filter(
          (post) =>
            truncatedCaption.test(post.text) && !alreadyRead.has(post.url),
        )
        .slice(0, 4);
      for (const preview of previews) {
        try {
          await page.goto(preview.url, {
            waitUntil: "domcontentloaded",
            timeout: 12000,
          });
          const post = await readFacebookPermalink(page, preview.url);
          if (post)
            found.set(preview.url, {
              ...post,
              url: preview.url,
              publishedOn: post.publishedOn || preview.publishedOn,
            });
        } catch {
          /* Keep the observed public link for the next search. */
        }
      }
      await savePostIndex(
        { ...index, checkedAt: new Date().toISOString() },
        found.values(),
      );
    } finally {
      await indexBrowser.close();
      indexBrowser = undefined;
    }
  }

  function scheduleIndex() {
    if (!postIndex || indexTimer) return;
    indexTimer = setInterval(() => {
      if (busy || indexTask) return;
      indexTask = indexFeed()
        .catch((error) =>
          console.warn("Facebook index:", error.message.split("\n")[0]),
        )
        .finally(() => {
          indexTask = undefined;
        });
    }, 15 * 60000);
    indexTimer.unref();
  }

  async function stopIndex() {
    clearInterval(indexTimer);
    await indexBrowser?.close().catch(() => {});
    await indexTask;
  }
  async function search(property, { postUrls = [] } = {}) {
    const requestedPosts = new Set(postUrls);
    if (postUrls.some((url) => !postUrl.test(url)))
      throw Error("ใช้ลิงก์โพสต์จากเพจสำนักงานบังคับคดีเชียงใหม่ (ledcm2)");
    if (busy) throw Error("กำลังอ่าน Facebook กรุณารอให้รอบก่อนเสร็จ");
    if (!property.auctionDates?.length)
      throw Error("ทรัพย์นี้ไม่มีวันประมูลสำหรับจับคู่โพสต์");
    const today = bangkokDay();
    busy = true;
    let browser, staging;
    const runId = randomUUID();
    try {
      await indexTask;
      const index = postIndex ? await postIndex.read() : { posts: [] };
      staging = await mkdtemp(path.join(tmpdir(), "land-radar-facebook-"));
      browser = await launchBrowser();
      const context = await browser.newContext(feedOptions);
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const found = new Map();
      const warnings = [];
      let loginRequired = false;
      try {
        if (!requestedPosts.size) {
          await page.goto(PAGE, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
          });
          await dismiss(page);
          await page
            .locator('a[href*="/ledcm2/posts/"]')
            .first()
            .waitFor({ timeout: 25000 });
          if (await collectPublicPosts(page, found, maxScrolls))
            warnings.push(
              "Facebook จำกัดการเลื่อนฟีดสาธารณะ ระบบจะตรวจลิงก์โพสต์อื่นที่เปิดได้เพิ่มเติม",
            );
        }
      } catch {
        warnings.push(
          "Facebook ไม่แสดงโพสต์ในฟีด จะลองเปิดโพสต์ที่บันทึกไว้โดยตรง",
        );
      }
      const previousPosts = new Map(
        [
          ...(property.facebook?.albumCoverage || []),
          ...(property.facebook?.posts || []),
        ].map((post) => [post.url, post]),
      );
      if (!requestedPosts.size) {
        const archive = new Map(index.posts.map((p) => [p.url, p]));
        rememberPosts(archive, previousPosts.values());
        rememberPosts(archive, found.values());
        const checked = new Set();
        for (let attempt = 0; attempt < 4; attempt++) {
          const foundDates = new Set(
            selectFacebookPosts(
              [...found.values()],
              property.auctionDates,
              today,
            ).map((p) => p.match.date),
          );
          const pastDates = property.auctionDates
            .map(auctionISO)
            .filter((date) => date && date < today && !foundDates.has(date));
          if (!pastDates.length) break;
          const link = nextFacebookArchiveLink(
            archive.values(),
            pastDates,
            checked,
          );
          if (!link) break;
          checked.add(link);
          try {
            await page.goto(link, {
              waitUntil: "domcontentloaded",
              timeout: 12000,
            });
            await dismiss(page);
            await collectPublicPosts(page, found, 6, 2);
            rememberPosts(archive, found.values());
          } catch {
            /* Other public post pages may still be reachable. */
          }
        }
      }
      const knownUrls = requestedPosts.size
        ? requestedPosts
        : new Set([
            ...previousPosts.keys(),
            ...index.posts
              .filter((p) =>
                facebookPublicationRelevant(
                  p.publishedOn,
                  property.auctionDates,
                  today,
                ),
              )
              .map((p) => p.url),
            ...[...found.values()]
              .filter((p) =>
                facebookPublicationRelevant(
                  p.publishedOn,
                  property.auctionDates,
                  today,
                ),
              )
              .map((p) => p.url),
          ]);
      for (const url of knownUrls) {
        if (!postUrl.test(url)) continue;
        const fromFeed = found.get(url);
        if (fromFeed && matchPost(fromFeed, property.auctionDates, today))
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
          const post = await readFacebookPermalink(page, url);
          if (post) {
            if (post.url !== url) found.delete(post.url);
            found.set(url, { ...post, url });
          } else if (!fromFeed?.text || requestedPosts.has(url))
            warnings.push(
              "เปิดข้อความหรืออัลบั้มของบางโพสต์จากลิงก์โดยตรงไม่ได้",
            );
        } catch {
          warnings.push("Facebook เปิดโพสต์ที่บันทึกไว้บางรายการไม่สำเร็จ");
        }
      }
      for (const url of requestedPosts) {
        const post = found.get(url);
        if (post && !matchPost(post, property.auctionDates, today))
          warnings.push(
            "โพสต์ที่ระบุไม่เข้าเงื่อนไขวันประมูล ประเภทโพสต์ หรือวันเผยแพร่ภายใน 3 วัน",
          );
      }
      for (const [url, prior] of previousPosts) {
        if (
          postUrl.test(url) &&
          !found.get(url)?.text &&
          (!requestedPosts.size || requestedPosts.has(url))
        )
          found.set(url, {
            url,
            text: prior.text,
            publishedOn: prior.publishedOn,
            photoUrls: [],
            expectedPhotos: 0,
          });
      }
      if (!requestedPosts.size) {
        for (const saved of index.posts) {
          const current = found.get(saved.url);
          if (
            postUrl.test(saved.url) &&
            !current?.text &&
            matchPost(saved, property.auctionDates, today)
          )
            found.set(saved.url, { ...saved, photoUrls: [] });
        }
      }
      const candidates = selectFacebookPosts(
        [...found.values()],
        property.auctionDates,
        today,
      );
      await savePostIndex(index, found.values());
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
        const links = new Set(
          [startLink, candidate.albumStart, ...candidate.photoUrls].filter(
            Boolean,
          ),
        );
        const visits = [...links].map((link) => {
          const traverse = link === startLink || link === candidate.albumStart;
          return { link, traverse, direction: "next" };
        });
        if (startLink && expectedPhotos > links.size)
          visits.push({
            link: startLink,
            traverse: true,
            direction: "previous",
          });
        for (const { link, traverse, direction } of visits) {
          if (seen.size >= expectedPhotos) break;
          const seed = new URL(link);
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
              const step = await navigateFacebookPhoto(
                page,
                current,
                direction,
              );
              loginRequired ||= step.loginRequired;
              if (!step.advanced) break;
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
          publishedOn: candidate.publishedOn,
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
      if (loginRequired && filtered.caseFilter?.status === "incomplete")
        warnings.push(
          "ตัวดูรูปสาธารณะของ Facebook ยังเปิดรูปถัดไปไม่ได้หลังรีเฟรช",
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
        albumCoverage: posts.map(({ images, rowMatched, ...album }) => album),
        warnings: [...new Set(warnings)],
        scannedPosts: found.size,
        note: "ตรวจวันประมูลและวันเผยแพร่ของโพสต์สาธารณะ",
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
  return { search, scheduleIndex, stopIndex };
}
