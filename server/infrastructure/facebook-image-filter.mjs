import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFacebookCaseBoxes } from "../domain/facebook-case.mjs";

export async function recognizeFacebookCases(files, signal, previous = []) {
  const langPath = await mkdtemp(path.join(tmpdir(), "land-radar-ocr-"));
  try {
    return await new Promise((resolve, reject) => {
      const child = execFile(
        process.execPath,
        [fileURLToPath(new URL("./facebook-ocr-worker.mjs", import.meta.url))],
        {
          timeout: 600_000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true,
          signal,
        },
        (error, stdout) => {
          if (error) return reject(error);
          try {
            resolve(JSON.parse(stdout));
          } catch (e) {
            reject(e);
          }
        },
      );
      child.stdin.on("error", reject);
      child.stdin.end(JSON.stringify({ files, langPath, previous }));
    });
  } finally {
    await rm(langPath, { recursive: true, force: true });
  }
}

async function recognizeCases(caseNumber, files) {
  return (await recognizeFacebookCases(files)).map((index) =>
    index ? findFacebookCaseBoxes(index, caseNumber) : null,
  );
}

export async function filterFacebookImages(
  posts,
  caseNumber,
  directory,
  recognize = recognizeCases,
) {
  const urls = [
    ...new Set(posts.flatMap((post) => post.images.map((image) => image.url))),
  ];
  const incompletePosts = posts.filter(
    (post) =>
      !Number.isSafeInteger(post.expectedPhotos) ||
      post.images.length < post.expectedPhotos,
  ).length;
  if (incompletePosts)
    return {
      caseFilter: {
        status: "incomplete",
        checked: 0,
        kept: urls.length,
        total: urls.length,
        incompletePosts,
      },
      posts,
    };
  if (!urls.length) return { posts };
  let results = [];
  try {
    const files = urls.map((url) => {
      if (!/^\/evidence\/fb-[a-z0-9-]+\.(jpg|png|webp)$/.test(url))
        throw Error("Invalid Facebook image path");
      return path.join(directory, path.basename(url));
    });
    if (caseNumber && files.length)
      results = await recognize(caseNumber, files);
  } catch {
    // Preserve the original selection if OCR cannot run.
  }
  const matches = new Map(
    urls.flatMap((url, index) =>
      results[index]?.length ? [[url, results[index]]] : [],
    ),
  );
  const checked = urls.filter((_, index) =>
    Array.isArray(results[index]),
  ).length;
  const status = matches.size
    ? "matched"
    : checked === urls.length
      ? "no_match"
      : "unreadable";
  return {
    caseFilter: {
      status,
      checked,
      kept: matches.size || urls.length,
      total: urls.length,
      incompletePosts,
    },
    posts: matches.size
      ? posts.flatMap((post) => {
          const images = post.images
            .filter((image) => matches.has(image.url))
            .map((image) => ({ ...image, caseBoxes: matches.get(image.url) }));
          return images.length ? [{ ...post, rowMatched: true, images }] : [];
        })
      : posts,
  };
}
