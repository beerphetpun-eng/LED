import { stat, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

export async function existingFacebookImages(images, evidencePath) {
  const found = new Map();
  for (const { url, sourceUrl, photoId } of images) {
    if (
      !/^\d+$/.test(photoId) ||
      !/^\/evidence\/fb-[a-z0-9-]+\.(jpg|png|webp)$/.test(url) ||
      found.has(photoId)
    )
      continue;
    const file = await stat(path.join(evidencePath, path.basename(url))).catch(
      (error) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
    if (file?.isFile() && file.size)
      found.set(photoId, { url, sourceUrl, photoId });
  }
  return [...found.values()];
}

export async function downloadFacebookAlbum({
  page,
  context,
  candidate,
  priorImages,
  expectedPhotos,
  evidencePath,
  warnings,
  navigate,
}) {
  const images = [];
  let loginRequired = false;
  const seen = new Set();
  const downloadedSources = new Set();

  let previousSrc = "";
  const startLink = candidate.photoUrls?.[0];
  const album = startLink && new URL(startLink).searchParams.get("set");
  const findPhoto = async () => {
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
    return src;
  };
  const capture = async (photoId) => {
    const src = await findPhoto();
    if (downloadedSources.has(src)) throw Error("ภาพเดิมยังแสดงอยู่ในตัวดูรูป");
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
    const filename = `fb-${photoId}-shared.${extension}`;
    const temporaryFile = path.join(
      evidencePath,
      `.${filename}-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryFile, await response.body());
      await rename(temporaryFile, path.join(evidencePath, filename));
    } finally {
      await rm(temporaryFile, { force: true });
    }
    images.push({
      url: "/evidence/" + filename,
      sourceUrl: page.url(),
      photoId,
    });
    downloadedSources.add(src);
  };
  for (const photo of priorImages) {
    images.push(photo);
    seen.add(photo.photoId);
  }

  const links = new Set(
    [startLink, candidate.albumStart, ...(candidate.photoUrls || [])].filter(
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
      while (seen.size < expectedPhotos && visited.size < expectedPhotos) {
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
          await findPhoto().catch(() => {});
        }
        if (!traverse || seen.size >= expectedPhotos) break;
        const step = await navigate(page, current, direction);
        loginRequired ||= step.loginRequired;
        if (!step.advanced) break;
      }
    } catch (e) {
      warnings.push(`อ่านรูปบางส่วนไม่สำเร็จ: ${e.message.split("\n")[0]}`);
    }
  }
  return { images, loginRequired };
}
