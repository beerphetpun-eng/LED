import test from "node:test";
import assert from "node:assert/strict";
import { reviewFacebookCases } from "../server/domain/facebook-case-review.mjs";
import { createFacebookCaseReview } from "../server/application/facebook-case-review.mjs";
import { facebookCaseVersion } from "../server/domain/facebook-case.mjs";
const image = "/evidence/fb-1-shared.jpg";
const album = {
  text: "ผลการขายทอดตลาดทรัพย์ ประจำวันที่ 5 พฤศจิกายน 2569",
  publishedOn: "2026-11-09",
  expectedPhotos: 1,
  images: [{ url: image }],
};
const property = (
  id,
  caseNumber = "ผบE.6757 / 2566",
  auctionDates = ["05/11/2569"],
) => ({ id, caseNumber, auctionDates, assetSequence: "26 - 1" });
const indexes = new Map([
  [image, { column: { ผบE675766: [{}] }, rowReview: { unresolved: 7 } }],
]);

test("a source discrepancy is visible only for the same property, case and eligible original, never a substitute match", () => {
  const p = property("different", "ผบE.6586 / 2566");
  const finding = {
    propertyId: p.id,
    caseNumber: p.caseNumber,
    imageUrl: image,
    message: "Facebook prints E586, LED has E6586",
  };
  const result = reviewFacebookCases([p], [album], indexes, "2026-11-24", [
    finding,
  ]);
  assert.equal(result.items[0].status, "needs_ocr_review");
  assert.deepEqual(result.items[0].auditNotes, [finding]);
  for (const other of [
    { ...p, id: "other" },
    { ...p, caseNumber: "ผบ.6586 / 2566" },
    { ...p, auctionDates: ["19/11/2569"] },
  ])
    assert.deepEqual(
      reviewFacebookCases([other], [album], indexes, "2026-11-24", [finding])
        .items[0].auditNotes,
      [],
    );
});

test("review covers every property and distinguishes OCR misses, missing posts and future auctions", () => {
  const result = reviewFacebookCases(
    [
      property("matched"),
      property("ordinary", "ผบ.6757 / 2566"),
      property("missing", undefined, ["19/11/2569"]),
      property("future", undefined, ["26/11/2569"]),
      property("invalid", "???"),
    ],
    [album],
    indexes,
    "2026-11-24",
  );
  assert.deepEqual(
    result.items.map((item) => item.status),
    [
      "matched",
      "needs_ocr_review",
      "missing_posts",
      "awaiting_announcement",
      "invalid_case",
    ],
  );
  assert.equal(result.summary.total, 5);
  assert.equal(
    Object.entries(result.summary)
      .filter(([key]) => key !== "total")
      .reduce((n, [, count]) => n + count, 0),
    5,
  );
  assert.equal(result.items[1].unreadableRows, 7);
  assert.equal(
    result.items[1].otherDatePhotos.length,
    0,
    "E remains significant",
  );
  assert.deepEqual(result.items[2].matchedPhotos, []);
  assert.deepEqual(
    result.items[2].otherDatePhotos,
    [image],
    "a case found on another date must not be silently attached",
  );
});

test("an incomplete album and an unfinished OCR pass never become a confirmed negative search", () => {
  const p = property("unmatched", "ผบE.1234/2567");
  assert.equal(
    reviewFacebookCases(
      [p],
      [{ ...album, expectedPhotos: 2 }],
      indexes,
      "2026-11-24",
    ).items[0].status,
    "incomplete_album",
  );
  assert.equal(
    reviewFacebookCases([p], [album], new Map(), "2026-11-24").items[0].status,
    "processing",
  );
  const failed = reviewFacebookCases(
    [p],
    [album],
    new Map([[image, { status: "unreadable" }]]),
    "2026-11-24",
  ).items[0];
  assert.equal(failed.status, "needs_ocr_review");
  assert.equal(failed.failedPhotos, 1);
});

test("the review use case only reads the catalog, current OCR version and shared albums", async () => {
  const review = createFacebookCaseReview({
    repository: {
      allProperties: async () => [property("one")],
      getState: async (key) => {
        assert.equal(key, "facebook_public_posts");
        return { albums: [album] };
      },
      facebookCaseIndexes: async (version) => {
        assert.equal(version, facebookCaseVersion);
        return indexes;
      },
    },
    clock: () => new Date("2026-11-23T18:00:00Z"),
  });
  const report = await review();
  assert.equal(report.today, "2026-11-24");
  assert.equal(report.summary.matched, 1);
  assert.equal(report.version, facebookCaseVersion);
});

test("missing Chiang Mai posts retain the source office and warn when the announcement sells in Bangkok", () => {
  const p = {
    ...property("other-office", "856 / 2545", ["09/11/2569"]),
    rawText:
      "ติดต่อ สำนักงานบังคับคดี/กอง\nล้มละลาย 1\nโทรศัพท์\n02\nสถานที่จำหน่าย\nจำหน่าย ณ อาคารกรมบังคับคดี กรุงเทพมหานคร\nนัดที่",
  };
  const item = reviewFacebookCases([p], [album], indexes, "2026-11-24")
    .items[0];
  assert.equal(item.status, "missing_posts");
  assert.equal(item.sourceOffice, "ล้มละลาย 1");
  assert.match(item.sourceNotice, /กรุงเทพ/);
});
