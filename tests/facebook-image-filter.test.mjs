import test from "node:test";
import assert from "node:assert/strict";
import {
  caseBoxes,
  facebookCaseNumber,
  combineFacebookRow,
} from "../server/domain/facebook-case.mjs";
import { filterFacebookImages } from "../server/infrastructure/facebook-image-filter.mjs";

test("matches Thai digits and short Buddhist years without matching another case prefix or number", () => {
  const lines = [
    [
      { text: "ผบ.", bbox: { x0: 10, y0: 20, x1: 25, y1: 32 } },
      { text: "๕๙๔/๕๙", bbox: { x0: 28, y0: 20, x1: 68, y1: 32 } },
    ],
  ].map((words) => ({ words }));
  assert.deepEqual(caseBoxes(lines, "ผบ.594 / 2559", 100, 100), [
    { x: 0.08, y: 0.18, width: 0.62, height: 0.16 },
  ]);
  assert.deepEqual(caseBoxes(lines, "พ.594/2559", 100, 100), []);
  assert.deepEqual(caseBoxes(lines, "ผบ.94/2559", 100, 100), []);
  assert.deepEqual(caseBoxes(lines, "ผบ.594/2560", 100, 100), []);
});

test("preserves E as part of the case prefix while normalizing punctuation and Buddhist years", () => {
  const bbox = { x0: 10, y0: 20, x1: 65, y1: 35 };
  for (const [target, examples] of [
    ["พ.1854 / 2563", ["พ1854/63", "พ.1854/63"]],
    ["ผบ.1066 / 2560", ["ผบ1066/60", "ผบ.1066/60"]],
    ["ผบE.1066 / 2560", ["ผบE1066/60", "ผบ.E1066/60", "ผบe.1066/2560"]],
    ["ผบE.670 / 2567", ["ผบE670/67", "ผบ.E 670 / 67", "ผบE67067"]],
  ]) {
    for (const text of examples)
      assert.equal(
        caseBoxes([{ words: [{ text, bbox }] }], target, 100, 100).length,
        1,
      );
  }
  for (const [target, text] of [
    ["ผบ.1066/2560", "ผบE1066/60"],
    ["ผบE.1066/2560", "ผบ1066/60"],
    ["พ.1854/2563", "พE1854/63"],
    ["พE.1854/2563", "พ1854/63"],
  ])
    assert.deepEqual(
      caseBoxes([{ words: [{ text, bbox }] }], target, 100, 100),
      [],
    );
  assert.deepEqual(
    caseBoxes(
      [{ words: [{ text: "พE1066/60", bbox }] }],
      "ผบ.1066/2560",
      100,
      100,
    ),
    [],
  );
});

test("compact case keys remove punctuation and spaces, shorten the year and retain E", () => {
  assert.equal(facebookCaseNumber("ผบE.670 / 2567"), "ผบE67067");
  assert.equal(facebookCaseNumber("ผบE670/67"), "ผบE67067");
  assert.equal(facebookCaseNumber("ผบE67067"), "ผบE67067");
  assert.equal(facebookCaseNumber("ผบ.670/2567"), "ผบ67067");
  assert.equal(facebookCaseNumber("37 / 2559"), "3759");
});

test("colored-row readings require independently observed E after the Thai prefix", () => {
  const make = (text, x0, x1) => ({ text, bbox: { x0, x1, y0: 30, y1: 60 } });
  const lines = (symbols, text) => [
    { text, words: [{ symbols, bbox: { x0: 0, x1: 180, y0: 30, y1: 60 } }] },
  ];
  const thai = lines(
    [make("ผ", 0, 15), make("บ", 16, 30), make("6", 32, 45)],
    "ผบ6670767",
  );
  const english = lines(
    [make("H", 0, 15), make("U", 16, 30), make("E", 32, 45), make("6", 46, 59)],
    "HUE6T0/67",
  );
  const numbers = lines([make("E", 0, 45), make("670/67", 46, 180)], "E670/67");
  const joined = combineFacebookRow(thai, english, numbers);
  assert.equal(joined.words[0].text, "ผบE670/67");
  assert.equal(caseBoxes([joined], "ผบE.670/2567", 300, 100).length, 1);
  assert.equal(caseBoxes([joined], "ผบ.670/2567", 300, 100).length, 0);
  const unconfirmed = lines([make("E", 0, 30), make("6", 46, 59)], "E670/67");
  assert.equal(combineFacebookRow(thai, unconfirmed, numbers), null);
});

test("filters across posts when there is a match and keeps every image otherwise", async () => {
  const photos = ["/evidence/fb-123.jpg", "/evidence/fb-456.jpg"];
  const posts = photos.map((url) => ({ expectedPhotos: 1, images: [{ url }] }));
  const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.1 };
  const found = await filterFacebookImages(
    posts,
    "ผบ.594/2559",
    ".",
    async () => [[], [box]],
  );
  assert.equal(found.caseFilter.status, "matched");
  assert.equal(found.posts.length, 1);
  assert.deepEqual(found.posts[0].images, [
    { url: photos[1], caseBoxes: [box] },
  ]);
  for (const [results, status] of [
    [[[], []], "no_match"],
    [[null, []], "unreadable"],
  ]) {
    const filtered = await filterFacebookImages(
      posts,
      "ผบ.594/2559",
      ".",
      async () => results,
    );
    assert.equal(filtered.caseFilter.status, status);
    assert.deepEqual(filtered.posts, posts);
  }
});

test("OCR waits while any album has missing images or an unknown size", async () => {
  const url = "/evidence/fb-123.jpg";
  const partialPost = {
    expectedPhotos: 20,
    downloadedPhotos: 1,
    images: [{ url }],
  };
  const posts = [partialPost, { expectedPhotos: null, images: [] }];
  let calls = 0;
  const recognize = async () => {
    calls++;
    return [[]];
  };
  const missing = await filterFacebookImages(
    posts,
    "พ.1854/2563",
    ".",
    recognize,
  );
  assert.equal(calls, 0);
  assert.equal(missing.caseFilter.status, "incomplete");
  assert.equal(missing.caseFilter.incompletePosts, 2);
  assert.equal(missing.caseFilter.checked, 0);
  assert.deepEqual(missing.posts, posts);
});
