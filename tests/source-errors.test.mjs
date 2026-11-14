import test from "node:test";
import assert from "node:assert/strict";
import {
  checkLandsSearchResponse,
  SourceRateLimitError,
  SourceUnavailableError,
} from "../server/domain/errors.mjs";
test("HTTP 200 quota responses are never classified as missing parcels", () => {
  assert.throws(
    () =>
      checkLandsSearchResponse({
        status: 500,
        error: true,
        message: "เกินจำกัด 20 /วัน\nกรุณาลงทะเบียนติดต่อกรมที่ดิน",
      }),
    SourceRateLimitError,
  );
  assert.throws(() => checkLandsSearchResponse({}, 429), SourceRateLimitError);
  assert.doesNotThrow(() =>
    checkLandsSearchResponse({ error: true, message: "ไม่พบข้อมูล" }),
  );
  assert.throws(
    () => checkLandsSearchResponse({ error: true, message: "ระบบขัดข้อง" }),
    SourceUnavailableError,
  );
});

test("an unrecognized response is a source failure, never a parcel miss", () => {
  for (const response of [null, {}, [], { error: "false" }])
    assert.throws(
      () => checkLandsSearchResponse(response),
      SourceUnavailableError,
    );
  assert.doesNotThrow(() => checkLandsSearchResponse({ error: false }));
});
