import { auctionISO, bangkokDay, selectFacebookPosts } from "./catalog.mjs";
import { facebookCaseNumber } from "./facebook-case.mjs";

export function reviewFacebookCases(
  properties,
  albums,
  indexes,
  today = bangkokDay(),
  findings = [],
) {
  const allImages = [
    ...new Set(
      albums.flatMap((album) => album.images.map((image) => image.url)),
    ),
  ];
  const caseImages = new Map();
  for (const url of allImages) {
    const index = indexes.get(url);
    for (const [stored, boxes] of [
      ...Object.entries(index?.column || {}),
      ...Object.entries(index?.fullPage || {}),
    ]) {
      if (!boxes.length) continue;
      const key = facebookCaseNumber(stored) || stored;
      if (!caseImages.has(key)) caseImages.set(key, new Set());
      caseImages.get(key).add(url);
    }
  }
  const items = properties.map((property) => {
    const posts = selectFacebookPosts(
      albums,
      property.auctionDates || [],
      today,
    );
    const images = [
      ...new Set(
        posts.flatMap((post) => post.images.map((image) => image.url)),
      ),
    ];
    const recognized =
      caseImages.get(facebookCaseNumber(property.caseNumber)) || new Set();
    const matches = images.filter((url) => recognized.has(url));
    const pending = images.filter((url) => !indexes.has(url)).length;
    const failedPhotos = images.filter(
      (url) => indexes.get(url)?.status === "unreadable",
    ).length;
    const incompleteAlbums = posts.filter(
      (post) =>
        !Number.isSafeInteger(post.expectedPhotos) ||
        post.expectedPhotos <= 0 ||
        post.images.length < post.expectedPhotos,
    ).length;
    const unreadableRows = images.reduce(
      (count, url) => count + (indexes.get(url)?.rowReview?.unresolved || 0),
      0,
    );
    const dates = (property.auctionDates || []).map(auctionISO).filter(Boolean);
    const sourceOffice =
      (property.rawText || "")
        .match(/ติดต่อ\s*สำนักงานบังคับคดี\/กอง\s*\n([^\n]+)/)?.[1]
        ?.trim() || "";
    const saleLocation =
      (property.rawText || "")
        .match(/สถานที่จำหน่าย\s*\n([^\n]+)/)?.[1]
        ?.trim() || "";
    const past = dates.filter((date) => date <= today);
    const status = !facebookCaseNumber(property.caseNumber)
      ? "invalid_case"
      : matches.length
        ? "matched"
        : !images.length
          ? past.length || !dates.length
            ? "missing_posts"
            : "awaiting_announcement"
          : incompleteAlbums
            ? "incomplete_album"
            : pending
              ? "processing"
              : "needs_ocr_review";
    return {
      id: property.id,
      caseNumber: property.caseNumber,
      assetSequence: property.assetSequence,
      sourceOffice,
      auditNotes: findings.filter(
        (finding) =>
          finding.propertyId === property.id &&
          finding.caseNumber === property.caseNumber &&
          images.includes(finding.imageUrl),
      ),
      sourceNotice:
        sourceOffice &&
        !sourceOffice.includes("เชียงใหม่") &&
        saleLocation.includes("กรุงเทพมหานคร")
          ? "ต้นทางระบุหน่วยงานอื่นและสถานที่ขายในกรุงเทพฯ ควรตรวจประกาศจากหน่วยงานเจ้าของเรื่องด้วย"
          : "",
      status,
      auctionDates: property.auctionDates || [],
      postDates: [...new Set(posts.map((post) => post.match.date))],
      eligiblePosts: posts
        .filter((post) => post.url)
        .map((post) => ({ date: post.match.date, url: post.url })),
      eligiblePhotos: images.length,
      matchedPhotos: matches,
      pendingPhotos: pending,
      failedPhotos,
      incompleteAlbums,
      unreadableRows,
      otherDatePhotos: matches.length
        ? []
        : [...recognized].filter((url) => !images.includes(url)),
    };
  });
  const summary = {
    total: items.length,
    matched: 0,
    needs_ocr_review: 0,
    missing_posts: 0,
    awaiting_announcement: 0,
    processing: 0,
    invalid_case: 0,
    incomplete_album: 0,
  };
  for (const item of items) summary[item.status]++;
  return { today, summary, items };
}
