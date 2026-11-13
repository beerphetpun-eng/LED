export class SourceUnavailableError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "SourceUnavailableError";
  }
}
export class SourceRateLimitError extends SourceUnavailableError {
  constructor(message, options) {
    super(message, options);
    this.name = "SourceRateLimitError";
    this.retryAfterMs = 302 * 60000;
  }
}
export function checkLandsSearchResponse(payload, httpStatus = 200) {
  const message =
    typeof payload?.message === "string" ? payload.message.trim() : "";
  if (
    httpStatus === 429 ||
    /เกิน.*(?:จำกัด|กำหนด)|จำกัด\s*\d+\s*\/\s*วัน|quota|rate.limit|too many/i.test(
      message,
    )
  )
    throw new SourceRateLimitError(
      `LandsMaps จำกัดจำนวนการค้นหา: ${message || "ต้นทางแจ้งว่าถึงโควตา"} · ระบบเก็บคิวและจะลองต่อหลัง 5 ชั่วโมง 2 นาที`,
    );
  if (
    httpStatus >= 400 ||
    (payload?.error === true && !/ไม่พบข้อมูล|not found/i.test(message))
  )
    throw new SourceUnavailableError(
      `LandsMaps ค้นหาไม่สำเร็จ: ${message || `HTTP ${httpStatus}`}`,
    );
}
