import { facebookCaseNumber } from "./facebook-case.mjs";

export function applyVerifiedFacebookReadings(index, record, imageHash) {
  if (
    !index ||
    !record ||
    !/^[a-f0-9]{64}$/.test(record.sha256 || "") ||
    record.sha256 !== imageHash
  )
    return index;
  const result = structuredClone(index);
  const verified = [];
  for (const reading of record.readings || []) {
    const key = facebookCaseNumber(reading.caseNumber);
    const box = reading.box;
    if (
      !key ||
      !reading.reviewedAt ||
      !box ||
      ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
      box.x < 0 ||
      box.y < 0 ||
      box.width <= 0 ||
      box.height <= 0 ||
      box.x + box.width > 1 ||
      box.y + box.height > 1
    )
      continue;
    // A literal visual reading replaces only this cell, including an erroneous
    // OCR prefix. It never attaches another row or makes E optional.
    for (const field of ["column", "fullPage"]) {
      for (const [stored, boxes] of Object.entries(result[field] || {})) {
        result[field][stored] = boxes.filter((candidate) => {
          const x = candidate.x + candidate.width / 2,
            y = candidate.y + candidate.height / 2;
          return (
            x < box.x - 0.01 ||
            x > box.x + box.width + 0.01 ||
            y < box.y ||
            y > box.y + box.height
          );
        });
        if (!result[field][stored].length) delete result[field][stored];
      }
    }
    result.column ||= {};
    result.column[key] = [...(result.column[key] || []), { ...box }];
    verified.push({
      caseNumber: reading.caseNumber,
      reviewedAt: reading.reviewedAt,
      box: { ...box },
    });
  }
  if (verified.length) result.verifiedReadings = verified;
  return result;
}
