import { setTimeout as delay } from "node:timers/promises";

export async function waitForEvidenceImages(
  page,
  signal,
  { timeout = 45000, settle = 3000 } = {},
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
  let timedOut = false;
  try {
    await page.waitForFunction(
      () => {
        const images = [...document.images].filter(
          (i) => i.getAttribute("src") || i.getAttribute("srcset"),
        );
        return (
          images.length > 0 &&
          images.every((i) => i.complete && i.naturalWidth > 0)
        );
      },
      null,
      { timeout },
    );
    await page.evaluate(async () => {
      await Promise.all(
        [...document.images]
          .filter((i) => i.complete && i.naturalWidth > 0)
          .map((i) => i.decode().catch(() => {})),
      );
    });
  } catch {
    timedOut = true;
  }
  signal.throwIfAborted();
  await delay(settle, undefined, { signal });
  const result = await page.evaluate(() => {
    const images = [...document.images].filter(
      (i) => i.getAttribute("src") || i.getAttribute("srcset"),
    );
    return {
      total: images.length,
      loaded: images.filter((i) => i.complete && i.naturalWidth > 0).length,
    };
  });
  return {
    ...result,
    ready: !timedOut && result.total > 0 && result.loaded === result.total,
    checkedAt: new Date().toISOString(),
  };
}
