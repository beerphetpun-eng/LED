import test from "node:test";
import assert from "node:assert/strict";
import { applyVerifiedFacebookReadings } from "../server/domain/facebook-verified-readings.mjs";
import { findFacebookCaseBoxes } from "../server/domain/facebook-case.mjs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createFacebookVerifiedReadings } from "../server/infrastructure/facebook-verified-readings.mjs";

const hash = "a".repeat(64);
const box = { x: 0.1, y: 0.2, width: 0.06, height: 0.03 };
const neighbor = { ...box, y: 0.4 };
const original = {
  column: { "ผงE5189/67": [box], "ผบ5189/67": [neighbor] },
  fullPage: { "ผงE5189/67": [box] },
};
const record = {
  sha256: hash,
  readings: [{ caseNumber: "ผบE5189/67", box, reviewedAt: "2026-11-24" }],
};

test("a visually verified literal cell replaces an OCR mistake without touching neighboring rows or prefixes", () => {
  const result = applyVerifiedFacebookReadings(original, record, hash);
  assert.equal(findFacebookCaseBoxes(result, "ผบE.5189/2567").length, 1);
  assert.equal(findFacebookCaseBoxes(result, "ผงE.5189/2567").length, 0);
  assert.deepEqual(findFacebookCaseBoxes(result, "ผบ.5189/2567"), [neighbor]);
  assert.deepEqual(original.column["ผงE5189/67"], [box]);
  assert.deepEqual(
    applyVerifiedFacebookReadings(result, record, hash),
    result,
    "repeated application does not duplicate a box",
  );
});

test("verified readings expire for changed image bytes and invalid geometry never creates a match", () => {
  assert.equal(
    applyVerifiedFacebookReadings(original, record, "b".repeat(64)),
    original,
  );
  assert.equal(
    applyVerifiedFacebookReadings(original, { ...record, sha256: "" }, hash),
    original,
  );
  for (const changed of [
    { x: -1 },
    { width: NaN },
    { height: 0 },
    { x: 0.99 },
  ]) {
    const result = applyVerifiedFacebookReadings(
      original,
      {
        ...record,
        readings: [{ ...record.readings[0], box: { ...box, ...changed } }],
      },
      hash,
    );
    assert.deepEqual(findFacebookCaseBoxes(result, "ผบE.5189/2567"), []);
  }
});

test("the adapter hashes current file bytes and rejects stale evidence without reusing an OCR override", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "land-radar-verified-test-"));
  try {
    const bytes = Buffer.from("controlled original evidence");
    const url = "/evidence/fb-1-shared.jpg";
    await writeFile(path.join(dir, "fb-1-shared.jpg"), bytes);
    const adapter = createFacebookVerifiedReadings({
      evidencePath: dir,
      records: {
        [url]: {
          ...record,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        },
      },
    });
    assert.equal(
      findFacebookCaseBoxes(
        await adapter.verify(url, original),
        "ผบE.5189/2567",
      ).length,
      1,
    );
    await writeFile(
      path.join(dir, "fb-1-shared.jpg"),
      Buffer.from("changed evidence"),
    );
    assert.equal(await adapter.verify(url, original), original);
    assert.equal(
      await adapter.verify("/evidence/../other.jpg", original),
      original,
    );
  } finally {
    assert(path.resolve(dir).startsWith(path.resolve(tmpdir()) + path.sep));
    await rm(dir, { recursive: true, force: true });
  }
});
