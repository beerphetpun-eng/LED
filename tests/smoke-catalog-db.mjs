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
  const component = {
    ...property,
    price: 300,
    componentKey: "room-one",
    rawText: "fixture",
    screenshotUrl: "/evidence/db-smoke-one.png",
    evidenceReady: true,
    areaSqWa: 10,
  };
  await db.upsertProperty(component, "second", "engaged");
  await db.upsertProperty(
    {
      ...component,
      componentKey: "room-two",
      screenshotUrl: "/evidence/db-smoke-two.png",
      areaSqWa: 20,
    },
    "second",
    "engaged",
  );
  await db.upsertProperty(component, "second", "engaged");
  const bundle = await db.getProperty(id);
  assert.equal(bundle.assetComponents.length, 2);
  assert.equal(bundle.areaSqWa, 30);
  assert.equal(bundle.price, 300);
  assert.equal(bundle.syncCount, 2);
  assert.equal(bundle.user.comment, "verification");
  assert.equal(await db.fileReferenced("/evidence/db-smoke-two.png"), true);
  const rawText =
    "จะทำการขายโดย การจำนองติดไป ติดจำนอง ธนาคาร ยอดหนี้จำนอง 640,242.67 บาท ราคาประเมิน 300 บาท";
  const beforeMigration = (
    await db.pool.query(
      "SELECT source,user_data FROM land_radar.properties WHERE id=$1",
      [id],
    )
  ).rows[0];
  const legacy = {
    ...beforeMigration.source,
    rawText,
    assetComponents: bundle.assetComponents.map((c) => ({ ...c, rawText })),
  };
  delete legacy.pricing;
  await db.pool.query(
    "UPDATE land_radar.properties SET source=$2 WHERE id=$1",
    [id, JSON.stringify(legacy)],
  );
  assert.equal(await db.migratePricing(), 1);
  assert.equal(await db.migratePricing(), 0);
  const stored = (
    await db.pool.query(
      "SELECT source,user_data FROM land_radar.properties WHERE id=$1",
      [id],
    )
  ).rows[0];
  assert.equal(stored.source.pricing.total, 640542.67);
  assert.deepEqual(stored.user_data, beforeMigration.user_data);
  const { pricing, ...unchanged } = stored.source;
  assert.deepEqual(unchanged, legacy);
  await db.updateSource(id, { price: 100 });
  assert.equal((await db.getProperty(id)).pricing.total, 640342.67);
  await db.upsertProperty(
    { ...component, rawText, price: 200 },
    "third",
    "engaged",
  );
  const refreshed = await db.getProperty(id);
  assert.equal(refreshed.pricing.total, 640442.67);
  assert.equal(refreshed.syncCount, 3);
  assert.equal(refreshed.user.comment, "verification");
  assert.ok(
    (
      await db.queryProperties({ minPrice: "640442.67", maxPrice: "640442.67" })
    ).items.some((p) => p.id === id),
  );
  console.log(
    "PostgreSQL upsert, bundled assets, run counting and user annotations verified.",
  );
} finally {
  await db.pool.query("DELETE FROM land_radar.properties WHERE id=$1", [id]);
  await db.pool.query("DELETE FROM land_radar.sync_seen WHERE id=$1", [id]);
  await db.close();
}
