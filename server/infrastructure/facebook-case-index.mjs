import path from "node:path";
import {
  facebookCaseNumber,
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
        const index = indexes[position];
        entry.pending = false;
        entry.index = index || null;
        if (!index) {
          entry.retryAt = Date.now() + retryDelay;
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
      task = processQueue().finally(() => {
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
          entry.index = saved;
        })
        .catch((error) => {
          console.warn("Facebook OCR cache:", error.message.split("\n")[0]);
        });
    }
    await entry.loaded;
    if (
      !entry.index &&
      !entry.pending &&
      entry.retryAt <= Date.now() &&
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
        album.images.length < album.expectedPhotos,
    ).length;
    const counts = {
      total: urls.length,
      checked: 0,
      matched: 0,
      unreadable: 0,
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

  return { forAlbums, stop };
}
