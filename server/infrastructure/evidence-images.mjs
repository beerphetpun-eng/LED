import { setTimeout as delay } from "node:timers/promises";

export const evidenceVersion = 3;

function inspectImages() {
  const images = [...document.images];
  const photos = images.filter(
    (img) =>
      /(?:ภาพทรัพย์|รูปถ่ายทรัพย์)/.test(img.alt) ||
      /\/PPKPicture\//i.test(img.currentSrc || img.getAttribute("src") || ""),
  );
  const resources = images.filter(
    (img) =>
      img.getAttribute("src") ||
      img.getAttribute("srcset") ||
      photos.includes(img),
  );
  const loaded = (img) =>
    img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  return {
    total: resources.length,
    loaded: resources.filter(loaded).length,
    photos: { total: photos.length, loaded: photos.filter(loaded).length },
  };
}

export async function waitForEvidenceImages(
  page,
  signal,
  { timeout = 45000, settle = 3000, requirePhoto = false } = {},
) {
  signal.throwIfAborted();
  // Scrolling activates lazy images before the full-page evidence capture.
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  for (let y = 0; y < Math.min(height, 100000); y += 800) {
    signal.throwIfAborted();
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await delay(80, undefined, { signal });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  const deadline = Date.now() + timeout;
  const complete = (r) =>
    r.total > 0 &&
    r.total === r.loaded &&
    (!requirePhoto || r.photos.total > 0);
  let result = await page.evaluate(inspectImages);
  while (!complete(result) && Date.now() < deadline) {
    await delay(Math.min(250, Math.max(0, deadline - Date.now())), undefined, {
      signal,
    });
    result = await page.evaluate(inspectImages);
  }
  await delay(settle, undefined, { signal });
  result = await page.evaluate(inspectImages);
  const decoded = await page.evaluate(async () => {
    const images = [...document.images].filter(
      (i) => i.complete && i.naturalWidth > 0,
    );
    const pending = Promise.all(
      images.map((i) =>
        i.decode().then(
          () => true,
          () => false,
        ),
      ),
    );
    let timer;
    try {
      const values = await Promise.race([
        pending,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve([]), 3000);
        }),
      ]);
      return values.length === images.length && values.every(Boolean);
    } finally {
      clearTimeout(timer);
    }
  });
  signal.throwIfAborted();
  const final = await page.evaluate(inspectImages);
  return {
    ...final,
    ready:
      decoded &&
      complete(result) &&
      complete(final) &&
      final.total === result.total &&
      final.photos.total === result.photos.total,
    checkedAt: new Date().toISOString(),
  };
}
