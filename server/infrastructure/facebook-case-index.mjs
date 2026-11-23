import path from "node:path";
import {
  facebookCaseNumber,
  facebookCaseVersion,
  findFacebookCaseBoxes,
} from "../domain/facebook-case.mjs";
import { recognizeFacebookCases } from "./facebook-image-filter.mjs";

const imageUrl = /^\/evidence\/fb-[a-z0-9-]+\.(jpg|png|webp)$/;
const retryDelay = 15 * 60_000;

export function createFacebookCaseIndex({
  evidencePath,
  read,
  write,
  recognize = recognizeFacebookCases,
  clock = () => Date.now(),
}) {
  const entries = new Map();
  const queue = new Set();
  const abort = new AbortController();
  let task;

  async function processQueue() {
    while (queue.size && !abort.signal.aborted) {
      const urls = [...queue].slice(0, 4);
      for (const url of urls) queue.delete(url);
      let indexes = [];
      try {
        indexes = await recognize(
          urls.map((url) => path.join(evidencePath, path.basename(url))),
          abort.signal,
        );
      } catch (error) {
        if (abort.signal.aborted) return;
        console.warn("Facebook OCR:", error.message.split("\n")[0]);
      }
      if (abort.signal.aborted) return;
      for (const [position, url] of urls.entries()) {
        const entry = entries.get(url);
        const recognized = indexes[position];
        const index = recognized
          ? { ...recognized, version: facebookCaseVersion }
          : null;
        entry.pending = false;
        entry.index = index || null;
        if (!index) {
          entry.retryAt = clock() + retryDelay;
          try {
            await write(url, {
              version: facebookCaseVersion,
              status: "unreadable",
              retryAt: entry.retryAt,
            });
          } catch (error) {
            console.warn("Facebook OCR cache:", error.message.split("\n")[0]);
          }
          continue;
        }
        try {
          await write(url, index);
        } catch (error) {
          console.warn("Facebook OCR cache:", error.message.split("\n")[0]);
        }
      }
    }
  }

  function start() {
    if (!task && queue.size && !abort.signal.aborted) {
      // Bound the CPU and memory cost while rebuilding a shared image library.
      task = Promise.all(
        Array.from({ length: 3 }, () => processQueue()),
      ).finally(() => {
        task = undefined;
        start();
      });
    }
  }

  async function queueImage(url) {
    let entry = entries.get(url);
    if (!entry) {
      entry = { index: null, pending: false, retryAt: 0 };
      entries.set(url, entry);
      entry.loaded = read(url)
        .then((saved) => {
          entry.index =
            saved?.version === facebookCaseVersion &&
            saved.status !== "unreadable"
              ? saved
              : null;
          if (
            saved?.version === facebookCaseVersion &&
            saved.status === "unreadable"
          )
            entry.retryAt = saved.retryAt || 0;
        })
        .catch((error) => {
          console.warn("Facebook OCR cache:", error.message.split("\n")[0]);
        });
    }
    await entry.loaded;
    if (
      !entry.index &&
      !entry.pending &&
      entry.retryAt <= clock() &&
      !abort.signal.aborted
    ) {
      entry.pending = true;
      queue.add(url);
    }
    return entry;
  }

  async function forAlbums(albums, caseNumber) {
    if (!albums.length) return { posts: [] };
    const urls = [
      ...new Set(
        albums.flatMap((album) => album.images.map((image) => image.url)),
      ),
    ];
    const incomplete = albums.filter(
      (album) =>
        !Number.isSafeInteger(album.expectedPhotos) ||
        album.expectedPhotos <= 0 ||
        album.images.length < album.expectedPhotos,
    ).length;
    const counts = {
      total: urls.length,
      checked: 0,
      matched: 0,
      unreadable: 0,
      uncertainRows: 0,
      incomplete,
    };
    if (!facebookCaseNumber(caseNumber))
      return { posts: [], caseFilter: { ...counts, status: "no_case" } };

    const supported = urls.filter((url) => imageUrl.test(url));
    await Promise.all(supported.map(queueImage));
    start();
    const matches = new Map();
    let pending = false;
    for (const url of supported) {
      const entry = entries.get(url);
      pending ||= entry.pending;
      if (!entry.index) continue;
      counts.checked++;
      counts.uncertainRows += entry.index.rowReview?.unresolved || 0;
      const boxes = findFacebookCaseBoxes(entry.index, caseNumber);
      if (boxes.length) matches.set(url, boxes);
    }
    counts.matched = matches.size;
    counts.unreadable =
      urls.length -
      counts.checked -
      supported.filter((url) => entries.get(url).pending).length;
    const posts = albums.flatMap((album) => {
      const images = album.images
        .filter((image) => matches.has(image.url))
        .map((image) => ({ ...image, caseBoxes: matches.get(image.url) }));
      return images.length ? [{ ...album, images }] : [];
    });
    const status = pending
      ? "scanning"
      : counts.matched
        ? "matched"
        : incomplete
          ? "incomplete"
          : counts.unreadable
            ? "unreadable"
            : "no_match";
    return { posts, caseFilter: { ...counts, status } };
  }

  async function stop() {
    abort.abort();
    queue.clear();
    await task;
  }

  async function rebuild(albums) {
    const urls = [
      ...new Set(
        albums.flatMap((album) => album.images.map((image) => image.url)),
      ),
    ].filter((url) => imageUrl.test(url));
    await Promise.all(urls.map(queueImage));
    start();
    while (task) await task;
    return {
      total: urls.length,
      checked: urls.filter((url) => entries.get(url).index).length,
    };
  }

  return { forAlbums, rebuild, stop };
}
