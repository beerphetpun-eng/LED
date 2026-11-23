const compact = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/[.\s\u200b-\u200f]/g, "");
const numberOf = (value) => {
  const match = compact(value).match(/^[^0-9]*?(\d+)\/(\d{2}|\d{4})$/);
  return match ? `${match[1]}/${match[2].slice(-2)}` : null;
};

// Full-cell readings are independent of the narrow prefix/number crops. This
// recovers a complete identifier only when both language models and separate
// image contexts agree; it never guesses a clipped leading digit or an E.
export function facebookFullCellReading(traces) {
  if (traces.length < 2) return null;
  const prefixes = traces.map((trace) => compact(trace.prefixSamples?.[0]));
  if (
    prefixes.some(
      (prefix) => !/^[ก-ฮ]*$/.test(prefix) || prefix !== prefixes[0],
    )
  )
    return null;
  const electronic = traces.flatMap((trace) => trace.electronicSamples || []);
  if (
    electronic.length < traces.length * 2 ||
    electronic.some(
      (value) => typeof value !== "boolean" || value !== electronic[0],
    ) ||
    (electronic[0] && !prefixes[0])
  )
    return null;
  const numbers = new Map();
  for (const [context, trace] of traces.entries()) {
    for (const [position, text] of (trace.full || []).entries()) {
      const number = numberOf(text);
      if (!number) continue;
      if (!numbers.has(number))
        numbers.set(number, {
          thai: false,
          english: false,
          constrained: false,
          contexts: new Set(),
        });
      const proof = numbers.get(number);
      proof[position === 0 ? "thai" : "english"] = true;
      if (position === 2) proof.constrained = true;
      proof.contexts.add(context);
    }
  }
  const winners = [...numbers].filter(
    ([, proof]) =>
      proof.thai &&
      proof.english &&
      proof.constrained &&
      proof.contexts.size >= 2,
  );
  return winners.length === 1
    ? prefixes[0] + (electronic[0] ? "E" : "") + winners[0][0]
    : null;
}
