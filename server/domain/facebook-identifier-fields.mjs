import { facebookCaseNumber } from "./facebook-case.mjs";

const compact = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[.\s\u200b-\u200f]/g, "");
function agreement(values, minimum = 2) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  return sorted[0]?.[1] >= minimum && sorted[0][1] > (sorted[1]?.[1] || 0)
    ? sorted[0][0]
    : null;
}
export function facebookFieldConsensus({
  prefixSamples,
  electronicSamples,
  numberSamples,
  allowEmptyPrefix = false,
}) {
  const prefixes = prefixSamples
    .map(compact)
    .filter(
      (value) => /^[ก-ฮ]+$/.test(value) || (allowEmptyPrefix && value === ""),
    );
  const prefix = agreement(prefixes);
  const electronic = agreement(
    electronicSamples.filter((value) => typeof value === "boolean"),
  );
  if (prefix === null || electronic === null || (!prefix && electronic))
    return null;
  const candidates = new Map();
  for (const sample of numberSamples) {
    const match = compact(sample.text).match(/^(\d+)\/(\d{2}|\d{4})$/);
    if (!match) continue;
    const number = `${match[1]}/${match[2].slice(-2)}`;
    if (!candidates.has(number)) candidates.set(number, new Set());
    candidates.get(number).add(sample.model);
  }
  const winners = [...candidates].filter(([, models]) => models.size >= 2);
  if (winners.length !== 1) return null;
  const text = prefix + (electronic ? "E" : "") + winners[0][0];
  return facebookCaseNumber(text) ? text : null;
}

export function facebookFieldPrefix(samples) {
  return agreement(
    samples.map(compact).filter((value) => /^[ก-ฮ]+$/.test(value)),
  );
}
