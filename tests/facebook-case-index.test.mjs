import test from "node:test";
import assert from "node:assert/strict";
import { createFacebookCaseIndex } from "../server/infrastructure/facebook-case-index.mjs";

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
const photo = (photoId) => ({
  photoId,
  url: `/evidence/fb-${photoId}-shared.jpg`,
});
const photos = [photo("1"), photo("2")];

test("shared pictures are scanned once and only a matching case can see each picture", async () => {
  let finish;
  let runs = 0;
  const saved = new Map();
  const index = createFacebookCaseIndex({
    evidencePath: ".",
    read: async (url) => saved.get(url),
    write: async (url, data) => saved.set(url, data),
    recognize: async () => {
      runs++;
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const albums = [{ expectedPhotos: 2, images: photos }];
  const [waitingA, waitingB] = await Promise.all([
    index.forAlbums(albums, "ผบE.4958 / 2568"),
    index.forAlbums(albums, "พ.1854 / 2563"),
  ]);
  assert.equal(waitingA.caseFilter.status, "scanning");
  assert.deepEqual(waitingB.posts, []);
  finish([
    { column: { "ผบE4958/68": [box] } },
    { fullPage: { "พ1854/63": [box] } },
  ]);
  await new Promise((resolve) => setImmediate(resolve));

  const first = await index.forAlbums(albums, "ผบE.4958 / 2568");
  const second = await index.forAlbums(albums, "พ.1854 / 2563");
  assert.deepEqual(first.posts[0].images, [{ ...photos[0], caseBoxes: [box] }]);
  assert.deepEqual(second.posts[0].images, [
    { ...photos[1], caseBoxes: [box] },
  ]);
  assert.deepEqual(albums[0].images, photos);
  assert.equal(runs, 1);
  assert.equal(saved.size, 2);

  const absent = await index.forAlbums(albums, "พ.1854 / 2568");
  assert.deepEqual(absent.posts, []);
  assert.equal(absent.caseFilter.status, "no_match");
  const partial = await index.forAlbums(
    [{ ...albums[0], expectedPhotos: 3 }],
    "พ.1854 / 2568",
  );
  assert.equal(partial.caseFilter.status, "incomplete");
  assert.equal(partial.caseFilter.checked, 2);
  const partialMatch = await index.forAlbums(
    [{ ...albums[0], expectedPhotos: 3 }],
    "พ.1854 / 2563",
  );
  assert.equal(partialMatch.posts[0].images.length, 1);
  assert.equal(partialMatch.caseFilter.incomplete, 1);
  await index.stop();

  const restarted = createFacebookCaseIndex({
    evidencePath: ".",
    read: async (url) => saved.get(url),
    write: async () => assert.fail("already indexed"),
    recognize: async () => assert.fail("already indexed"),
  });
  assert.deepEqual(await restarted.forAlbums(albums, "ผบE4958/2568"), first);
  const otherPrefix = await restarted.forAlbums(albums, "ผบ4958/2568");
  assert.deepEqual(otherPrefix.posts, []);
  await restarted.stop();
});

test("rebuilding ignores the old cache that discarded E and caches every shared photo", async () => {
  const saved = new Map();
  const index = createFacebookCaseIndex({
    evidencePath: ".",
    read: async () => ({ column: { "ผบ1066/60": [box] } }),
    write: async (url, data) => saved.set(url, data),
    recognize: async () => [
      { column: { "ผบE1066/60": [box] } },
      { column: { "ผบ1066/60": [box] } },
    ],
  });
  const albums = [{ expectedPhotos: 2, images: photos }];
  assert.deepEqual(await index.rebuild(albums), { total: 2, checked: 2 });
  assert.equal(saved.get(photos[0].url).version, 3);
  const plain = await index.forAlbums(albums, "ผบ.1066/2560");
  const electronic = await index.forAlbums(albums, "ผบE.1066/2560");
  assert.deepEqual(
    plain.posts[0].images.map((image) => image.photoId),
    ["2"],
  );
  assert.deepEqual(
    electronic.posts[0].images.map((image) => image.photoId),
    ["1"],
  );
  await index.stop();
});
