import test from "node:test";
import assert from "node:assert/strict";
import { facebookLibraryGroups } from "../server/domain/facebook-library.mjs";

test("library groups use the caption date, include delayed results and expose missing auction days", () => {
  const result = {
    albumKey: "pcb.1",
    url: "result",
    text: "ผลการขายทอดตลาดทรัพย์ ประจำวันที่ 5 พฤศจิกายน 2569",
    publishedOn: "2026-11-09",
    expectedPhotos: 1,
    images: [{ photoId: "1", url: "/evidence/fb-1-shared.jpg" }],
  };
  const groups = facebookLibraryGroups(
    {
      albums: [
        result,
        result,
        {
          ...result,
          albumKey: "pcb.2",
          url: "announcement",
          text: "บัญชีขายทอดตลาดทรัพย์ วันที่ 5 พฤศจิกายน 2569",
          publishedOn: "2026-11-04",
        },
      ],
    },
    [
      {
        id: "a",
        auctionDates: ["05/11/2569", "05/11/2569", "19/11/2569", "03/12/2569"],
      },
      { id: "b", auctionDates: ["05/11/2569"] },
    ],
    "2026-11-23",
  );
  assert.deepEqual(
    groups.map(({ date }) => date),
    ["2026-12-03", "2026-11-19", "2026-11-05"],
  );
  assert.equal(groups[0].awaitingAnnouncement, true);
  assert.equal(groups[1].available, false);
  assert.equal(groups[1].properties, 1);
  assert.equal(groups[2].available, true);
  assert.equal(groups[2].properties, 2);
  assert.equal(groups[2].posts.length, 2);
  assert.equal(groups[2].posts[0].eligible, true);
  assert.equal(groups[2].posts[1].eligible, false);
  assert.deepEqual(groups[2].posts[0].images, result.images);
});
