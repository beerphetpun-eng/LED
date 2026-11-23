import { chromium } from "playwright";
import {
  bangkokDay,
  auctionISO,
  facebookPublishedDay,
  isFacebookAuctionCaption,
  selectFacebookPosts,
  facebookPostDetails,
} from "../domain/catalog.mjs";
import { facebookLibraryGroups } from "../domain/facebook-library.mjs";
import {
  downloadFacebookAlbum,
  existingFacebookImages,
} from "./facebook-album.mjs";

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

export async function readFacebookMetadata(page) {
  return page
    .locator('script[type="application/json"]')
    .evaluateAll((scripts) => {
      const posts = new Map();
      const attachments = (value, result) => {
        if (!value || typeof value !== "object") return;
        const gallery = value.all_subattachments;
        if (gallery) {
          if (Number.isSafeInteger(gallery.count) && gallery.count > 0)
            result.counts.add(gallery.count);
          for (const item of gallery.nodes || []) {
            if (
              /^\d+$/.test(item.media?.id || "") &&
              (!item.media.__typename || item.media.__typename === "Photo")
            )
              result.photos.add(item.media.id);
          }
        }
        for (const child of Object.values(value))
          if (child && typeof child === "object") attachments(child, result);
      };
      const walk = (value) => {
        if (!value || typeof value !== "object") return;
        if (/^\d+$/.test(value.post_id || "")) {
          const id = value.post_id;
          const post = posts.get(id) || {
            id,
            text: "",
            created: null,
            counts: new Set(),
            photos: new Set(),
          };
          if (
            typeof value.message?.text === "string" &&
            value.message.text.length > post.text.length
          )
            post.text = value.message.text;
          if (Number.isFinite(value.creation_time) && value.creation_time > 0)
            post.created = value.creation_time;
          if (value.attachments) attachments(value.attachments, post);
          posts.set(id, post);
        }
        for (const child of Object.values(value))
          if (child && typeof child === "object") walk(child);
      };
      for (const script of scripts) {
        try {
          walk(JSON.parse(script.textContent));
        } catch {
          /* Other embedded data may be incomplete. */
        }
      }
      return [...posts.values()].map((post) => ({
        id: post.id,
        text: post.text,
        publishedOn: post.created
          ? new Date(post.created * 1000 + 7 * 3600000)
              .toISOString()
              .slice(0, 10)
          : null,
        expectedPhotos: post.counts.size === 1 ? [...post.counts][0] : null,
        photos: [...post.photos],
      }));
    });
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
  const metadata = new Map(
    (await readFacebookMetadata(page)).map((post) => [post.id, post]),
  );
  const found = new Map();
  rememberPosts(
    found,
    posts.map(({ publicationLabel, ...post }) => {
      const album =
        post.photoUrls[0] && new URL(post.photoUrls[0]).searchParams.get("set");
      const data = metadata.get(album?.replace(/^pcb\./, ""));
      return {
        ...post,
        ...(album && { albumKey: album }),
        text: data?.text || post.text,
        publishedOn:
          data?.publishedOn || facebookPublishedDay(publicationLabel),
        ...(data?.expectedPhotos && {
          expectedPhotos: data.expectedPhotos,
          photoCountVerified: true,
        }),
        photoUrls: [
          ...new Set([
            ...post.photoUrls.map((url) => {
              const link = new URL(url);
              return `https://web.facebook.com/photo/?fbid=${link.searchParams.get("fbid")}&set=${link.searchParams.get("set")}`;
            }),
            ...(data?.photos || []).map(
              (id) => `https://web.facebook.com/photo/?fbid=${id}&set=${album}`,
            ),
          ]),
        ],
      };
    }),
  );
  return [...found.values()];
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
    const previous = found.get(post.url);
    found.set(post.url, {
      ...previous,
      ...post,
      text:
        (previous?.text?.length || 0) > (post.text?.length || 0)
          ? previous.text
          : post.text,
      publishedOn: post.publishedOn || previous?.publishedOn || null,
      photoUrls: [
        ...new Set([...(previous?.photoUrls || []), ...(post.photoUrls || [])]),
      ],
    });
  }
}

async function collectPublicPosts(page, found, maxScrolls, stableLimit = 5) {
  let unchanged = 0;
  let limited = false;
  for (let scroll = 0; scroll <= maxScrolls; scroll++) {
    const more = page.getByRole("button", { name: /^(See more|ดูเพิ่มเติม)$/ });
    for (const button of await more.all())
      if (await button.isVisible())
        await button.click({ timeout: 1500 }).catch(() => {});
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
  const unique = new Map(
    posts.map((post) => [post.albumKey || post.url, post]),
  );
  return [...unique.values()]
    .filter(
      (p) =>
        postUrl.test(p.url) &&
        !checked.has(p.url) &&
        !checked.has(p.albumKey) &&
        p.publishedOn,
    )
    .sort((a, b) => distance(a.publishedOn) - distance(b.publishedOn))[0]?.url;
}

function albumIdentity(post) {
  if (post.albumKey) return post.albumKey;
  const link =
    post.photoUrls?.[0] ||
    post.images?.find((image) =>
      /^https:\/\/(?:web\.|www\.)?facebook\.com\/photo\/?\?/.test(
        image.sourceUrl || "",
      ),
    )?.sourceUrl;
  const album = link && new URL(link).searchParams.get("set");
  return /^pcb\.\d+$/.test(album || "") ? album : post.url;
}

function completeAlbum(album) {
  return (
    Number.isSafeInteger(album.expectedPhotos) &&
    album.expectedPhotos > 0 &&
    album.images.length >= album.expectedPhotos
  );
}

export function createFacebookSource(
  evidencePath,
  {
    maxScrolls = 20,
    postIndex,
    caseIndex,
    readCatalog = async () => ({ dates: [], legacy: [] }),
    launchBrowser = () => chromium.launch({ headless: true }),
    downloadAlbum = downloadFacebookAlbum,
  },
) {
  let task,
    timer,
    browser,
    stopping = false;
  let progress = null;
  const feedOptions = {
    locale: "en-US",
    timezoneId: "Asia/Bangkok",
    viewport: { width: 1440, height: 1100 },
    acceptDownloads: false,
  };

  async function syncLibrary(force, requestedDate = null) {
    const index = await postIndex.read();
    if (
      !force &&
      index.albums &&
      Date.now() - Date.parse(index.checkedAt) < 6 * 3600000
    )
      return;
    const { dates, legacy } = await readCatalog();
    const references = new Map(
      (index.posts || [])
        .filter((post) => postUrl.test(post.url))
        .map((post) => [post.url, post]),
    );
    const albums = new Map(
      (index.albums || []).map((album) => [album.albumKey, album]),
    );
    const found = new Map();
    const warnings = [];
    const discovery = index.discovery || {};
    const save = (checkedAt = index.checkedAt) =>
      postIndex.write({
        checkedAt,
        posts: [...references.values()],
        albums: [...albums.values()],
        warnings: [...new Set(warnings)],
        discovery,
      });
    try {
      progress = {
        message: "กำลังอ่านฟีด Facebook",
        targetDate: requestedDate,
      };
      browser = await launchBrowser();
      const context = await browser.newContext(feedOptions);
      const page = await context.newPage();
      try {
        await page.goto(PAGE, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await dismiss(page);
        await page
          .locator('a[href*="/ledcm2/posts/"]')
          .first()
          .waitFor({ timeout: 12000 });
        if (await collectPublicPosts(page, found, maxScrolls))
          warnings.push(
            "Facebook จำกัดการเลื่อนฟีดสาธารณะ คลังมีเฉพาะอัลบั้มที่เปิดได้",
          );
      } catch {
        warnings.push(
          "อ่านฟีด Facebook สาธารณะไม่ได้ จะลองเปิดอัลบั้มจากลิงก์ที่เคยพบ",
        );
      }

      const today = bangkokDay();
      const recentPast = [
        ...new Set(
          dates
            .map(auctionISO)
            .filter(
              (date) =>
                date &&
                date < today &&
                (!requestedDate || date === requestedDate),
            ),
        ),
      ];
      const covered = new Set(
        selectFacebookPosts(
          [...albums.values(), ...references.values(), ...found.values()],
          dates,
          today,
        ).map((post) => post.match.date),
      );
      const missingDates = recentPast.filter((date) => !covered.has(date));
      const visited = new Map(
        missingDates.map((date) => [
          date,
          new Set(discovery[date]?.visited || []),
        ]),
      );
      for (
        let attempt = 0;
        attempt < 12 && missingDates.length && !stopping;
        attempt++
      ) {
        const targetDate = missingDates[attempt % missingDates.length];
        progress = { message: "กำลังค้นโพสต์ย้อนหลัง", targetDate };
        const checked = visited.get(targetDate);
        const link = nextFacebookArchiveLink(
          [...references.values(), ...found.values()],
          [targetDate],
          checked,
        );
        if (!link) continue;
        checked.add(link);
        const reference = [...references.values(), ...found.values()].find(
          (post) => post.url === link,
        );
        if (reference?.albumKey) checked.add(reference.albumKey);
        try {
          await page.goto(link, {
            waitUntil: "domcontentloaded",
            timeout: 12000,
          });
          await dismiss(page);
          await collectPublicPosts(page, found, 5, 2);
        } catch {
          warnings.push(
            "เปิดโพสต์ย้อนหลังบางรายการไม่ได้ ระบบจะตรวจลิงก์อื่นต่อ",
          );
        } finally {
          discovery[targetDate] = {
            visited: [...checked].slice(-250),
            checkedAt: new Date().toISOString(),
          };
          await save();
        }
      }

      // Read each eligible public album once, including incomplete albums from earlier runs.
      const candidates = new Map();
      for (const post of [
        ...references.values(),
        ...legacy,
        ...found.values(),
      ]) {
        if (!postUrl.test(post.url) || !isFacebookAuctionCaption(post.text))
          continue;
        const previous = candidates.get(post.url);
        if (!previous || post.photoUrls?.length || !previous.photoUrls?.length)
          candidates.set(post.url, post);
      }
      const imageOwners = new Map();
      for (const post of legacy) {
        const key = albumIdentity(post);
        imageOwners.set(key, [
          ...(imageOwners.get(key) || []),
          ...(post.images || []),
        ]);
      }

      const attempted = new Set();
      for (const [url, preview] of candidates) {
        if (stopping) break;
        if (
          requestedDate &&
          facebookPostDetails(preview)?.date !== requestedDate
        )
          continue;
        progress = {
          message: "กำลังเก็บรูปจากโพสต์",
          targetDate: facebookPostDetails(preview)?.date || null,
        };
        let key = albumIdentity(preview);
        let known =
          albums.get(key) || albums.get(references.get(url)?.albumKey);
        let priorImages = await existingFacebookImages(
          known?.images || [],
          evidencePath,
        );
        if (known && completeAlbum({ ...known, images: priorImages })) continue;
        let post = preview;
        if (
          !post.photoUrls?.length ||
          !post.publishedOn ||
          truncatedCaption.test(post.text)
        ) {
          try {
            await page.goto(url, {
              waitUntil: "domcontentloaded",
              timeout: 18000,
            });
            await page
              .locator('a[href*="/photo"]')
              .first()
              .waitFor({ timeout: 4500 });
            post = (await readFacebookPermalink(page, url)) || preview;
          } catch {
            warnings.push("เปิดโพสต์บางรายการเพื่อซิงค์รูปไม่ได้");
          }
        }
        if (
          !post.publishedOn ||
          truncatedCaption.test(post.text) ||
          !isFacebookAuctionCaption(post.text)
        )
          continue;
        key = albumIdentity(post);
        known = albums.get(key) || known;
        references.set(url, {
          url,
          text: post.text,
          publishedOn: post.publishedOn,
          expectedPhotos: post.expectedPhotos,
          albumKey: key,
        });
        if (attempted.has(key)) continue;
        attempted.add(key);
        priorImages = await existingFacebookImages(
          [
            ...(known?.images || []),
            ...(imageOwners.get(key) || []),
            ...(imageOwners.get(url) || []),
          ],
          evidencePath,
        );
        const expectedPhotos = post.photoCountVerified
          ? post.expectedPhotos
          : Math.max(post.expectedPhotos || 0, known?.expectedPhotos || 0) ||
            null;
        if (completeAlbum({ expectedPhotos, images: priorImages })) {
          albums.set(key, {
            albumKey: key,
            url: known?.url || url,
            text: post.text,
            publishedOn: post.publishedOn,
            expectedPhotos,
            photoCountVerified: Boolean(post.photoCountVerified),
            downloadedPhotos: priorImages.length,
            images: priorImages,
          });
          await save();
          continue;
        }
        const { images, loginRequired } = await downloadAlbum({
          page,
          context,
          candidate: post,
          priorImages,
          expectedPhotos,
          evidencePath,
          warnings,
          navigate: navigateFacebookPhoto,
        });
        const album = {
          albumKey: key,
          url: known?.url || url,
          text: post.text,
          publishedOn: post.publishedOn,
          expectedPhotos,
          photoCountVerified: Boolean(post.photoCountVerified),
          downloadedPhotos: images.length,
          images,
        };
        albums.set(key, album);
        if (loginRequired && !completeAlbum(album))
          warnings.push(
            "ตัวดูรูปสาธารณะของ Facebook ยังเปิดรูปบางส่วนไม่ได้ ระบบจะลองใหม่ในรอบถัดไป",
          );
        await save();
      }

      for (const post of found.values()) {
        if (
          !postUrl.test(post.url) ||
          !post.publishedOn ||
          references.has(post.url)
        )
          continue;
        references.set(post.url, {
          url: post.url,
          publishedOn: post.publishedOn,
          text: post.text,
          expectedPhotos: post.expectedPhotos,
          albumKey: albumIdentity(post),
        });
      }
      if (!stopping) {
        if (requestedDate)
          discovery[requestedDate] = {
            ...discovery[requestedDate],
            checkedAt: new Date().toISOString(),
          };
        await save(requestedDate ? index.checkedAt : new Date().toISOString());
        // Index each new shared photo for every property, without waiting for a details view.
        void caseIndex
          ?.rebuild?.([...albums.values()])
          .catch((error) =>
            console.warn("Facebook case index:", error.message.split("\n")[0]),
          );
      }
    } finally {
      await browser?.close();
      browser = undefined;
      progress = null;
    }
  }

  async function status() {
    const index = await postIndex.read();
    const albums = index.albums || [];
    const complete = albums.filter(completeAlbum).length;
    return {
      running: Boolean(task),
      checkedAt: index.checkedAt,
      total: albums.length,
      complete,
      partial: albums.length - complete,
      photos: new Set(
        albums.flatMap((album) => album.images.map((image) => image.photoId)),
      ).size,
      warnings: index.warnings || [],
      progress,
    };
  }

  async function refresh(force = true, date = null) {
    if (!task && !stopping)
      task = syncLibrary(force, date).finally(() => {
        task = undefined;
      });
    await task;
    return status();
  }

  async function start(date = null) {
    void refresh(true, date)
      .catch(async (error) => {
        const index = await postIndex.read();
        await postIndex.write({
          ...index,
          warnings: [
            ...new Set([
              ...(index.warnings || []),
              error.message.split("\n")[0],
            ]),
          ],
        });
      })
      .catch((error) =>
        console.warn("Facebook library:", error.message.split("\n")[0]),
      );
    return status();
  }

  async function library() {
    const index = await postIndex.read();
    const catalog = await readCatalog();
    return {
      ...(await status()),
      groups: facebookLibraryGroups(index, catalog.properties || []),
    };
  }

  async function forProperty(property) {
    const index = await postIndex.read();
    const posts = selectFacebookPosts(
      index.albums || [],
      property.auctionDates || [],
    );
    return {
      checkedAt: index.checkedAt,
      ...(caseIndex
        ? await caseIndex.forAlbums(posts, property.caseNumber)
        : { posts }),
    };
  }

  function scheduleIndex() {
    if (timer || stopping) return;
    const tick = () =>
      void refresh(false).catch((error) =>
        console.warn("Facebook albums:", error.message.split("\n")[0]),
      );
    timer = setInterval(tick, 15 * 60000);
    timer.unref();
    tick();
  }

  async function stopIndex() {
    stopping = true;
    clearInterval(timer);
    await browser?.close().catch(() => {});
    await task?.catch(() => {});
  }

  return {
    status,
    refresh,
    start,
    library,
    forProperty,
    scheduleIndex,
    stopIndex,
  };
}
