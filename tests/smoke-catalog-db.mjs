import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import * as db from "../server/infrastructure/postgres-repository.mjs";
const id = randomBytes(16).toString("hex");
try {
  await db.init();
  const property = {
    id,
    auctionDates: ["01/01/2600"],
    price: 100,
    areaSqWa: 900,
    deed: "test",
    province: "fixture",
    district: "fixture",
    subdistrict: "fixture",
    parcels: [],
    status: "pending",
  };
  await db.upsertProperty(property, "first", "engaged");
  await db.updateUser(id, {
    bookmarked: true,
    stars: 4,
    comment: "verification",
    auctionStatus: "ended",
    protected: true,
  });
  await db.upsertProperty({ ...property, price: 200 }, "second", "engaged");
  await db.upsertProperty({ ...property, price: 300 }, "second", "engaged");
  const result = await db.getProperty(id);
  assert.equal(result.price, 300);
  assert.equal(result.syncCount, 2);
  assert.equal(result.user.stars, 4);
  assert.equal(result.user.comment, "verification");
  assert.equal(result.user.auctionStatus, "ended");
  assert.equal(
    (
      await db.pool.query(
        "SELECT count(*)::int AS n FROM land_radar.properties WHERE id=$1",
        [id],
      )
    ).rows[0].n,
    1,
  );
  console.log("PostgreSQL upsert, run counting and user annotations verified.");
} finally {
  await db.pool.query("DELETE FROM land_radar.properties WHERE id=$1", [id]);
  await db.pool.query("DELETE FROM land_radar.sync_seen WHERE id=$1", [id]);
  await db.close();
}
