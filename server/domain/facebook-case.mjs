export const facebookCaseVersion = 4;

const normalize = (text) =>
  text
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[.\s\u200b-\u200f]/g, "")
    .toUpperCase();

export function facebookCaseNumber(caseNumber) {
  const parts = normalize(caseNumber || "").match(
    /^([\p{L}]*)(\d+)\/(\d{2}|\d{4})$/u,
  );
  if (parts) return `${parts[1]}${parts[2]}${parts[3].slice(-2)}`;
  return /^[\p{L}]+\d{3,}$/u.test(normalize(caseNumber || ""))
    ? normalize(caseNumber)
    : null;
}

export function findFacebookCaseBoxes(index, caseNumber) {
  const key = facebookCaseNumber(caseNumber);
  if (!key || !index) return [];
  const lookup = (rows) =>
    Object.entries(rows || {}).flatMap(([stored, boxes]) =>
      stored === key || facebookCaseNumber(stored) === key ? boxes : [],
    );
  const column = lookup(index.column);
  return column.length ? column : lookup(index.fullPage);
}

export function combineFacebookRow(thaiLines, latinLines, numberLines) {
  const symbolsOf = (lines) =>
    lines
      .flatMap((line) =>
        line.words.flatMap((word) =>
          word.symbols?.length ? word.symbols : [word],
        ),
      )
      .filter((symbol) => normalize(symbol.text));
  const thai = [];
  for (const symbol of symbolsOf(thaiLines)) {
    if (!/^[ก-ฮ]+$/.test(normalize(symbol.text))) break;
    thai.push(symbol);
  }
  if (!thai.length) return null;
  const suffix = normalize(numberLines.map((line) => line.text).join(""));
  if (!/^E?\d+(?:\/(?:\d{2}|\d{4}))?$/.test(suffix)) return null;
  const right = Math.max(...thai.map((symbol) => symbol.bbox.x1));
  const latin = symbolsOf(latinLines);
  const firstNumber = latin.find(
    (symbol) => /^\d$/.test(symbol.text) && symbol.bbox.x0 >= right - 3,
  );
  const electronic = latin.find(
    (symbol) =>
      symbol.text.toUpperCase() === "E" &&
      symbol.bbox.x0 >= right - 3 &&
      (!firstNumber || symbol.bbox.x0 < firstNumber.bbox.x0),
  );
  if (suffix.startsWith("E") !== Boolean(electronic)) return null;
  // A constrained digit reader may drop a digit or turn a Thai letter into one.
  // Require the mixed-language reading to independently contain the same digits.
  // Locate the slash geometrically: it can resemble a 7 in the mixed reading.
  const slash = latin.find((symbol) => symbol.text === "/");
  const boundary = electronic ? electronic.bbox.x1 : right;
  const corroborated = symbolsOf(thaiLines)
    .filter((symbol) => symbol.bbox.x1 > boundary + 3)
    .filter(
      (symbol) =>
        !slash ||
        (symbol.bbox.x0 + symbol.bbox.x1) / 2 < slash.bbox.x0 ||
        (symbol.bbox.x0 + symbol.bbox.x1) / 2 > slash.bbox.x1,
    )
    .map((symbol) => normalize(symbol.text))
    .join("")
    .replace(/[^0-9]/g, "");
  if (corroborated !== suffix.replace(/[^0-9]/g, "")) return null;
  const text = thai.map((symbol) => normalize(symbol.text)).join("") + suffix;
  if (!facebookCaseNumber(text)) return null;
  const boxes = [...thai, ...symbolsOf(numberLines)].map(
    (symbol) => symbol.bbox,
  );
  return {
    words: [
      {
        text,
        bbox: {
          x0: Math.min(...boxes.map((box) => box.x0)),
          y0: Math.min(...boxes.map((box) => box.y0)),
          x1: Math.max(...boxes.map((box) => box.x1)),
          y1: Math.max(...boxes.map((box) => box.y1)),
        },
      },
    ],
  };
}

export function facebookRowConsensus(lines) {
  const key = (line) => (line ? facebookCaseNumber(line.words[0].text) : null);
  return (
    lines.find(
      (candidate) =>
        key(candidate) &&
        lines.filter((line) => key(line) === key(candidate)).length >= 2,
    ) || null
  );
}

export function indexFacebookCases(lines, width, height) {
  const matches = {};
  for (const line of lines) {
    let text = "";
    const boxes = [];
    for (const word of line.words) {
      for (const symbol of word.symbols?.length ? word.symbols : [word]) {
        const value = normalize(symbol.text);
        text += value;
        for (let i = 0; i < value.length; i++) boxes.push(symbol.bbox);
      }
    }
    for (const match of text.matchAll(
      /[\p{L}]+\d+(?:\/\d{2,4})?(?![\d/])|(?<![\p{L}\d])\d+\/\d{2,4}(?!\d)/gu,
    )) {
      const key = facebookCaseNumber(match[0]);
      if (!key) continue;
      const symbols = boxes.slice(match.index, match.index + match[0].length);
      const left = Math.max(0, Math.min(...symbols.map((b) => b.x0)) - 2);
      const top = Math.max(0, Math.min(...symbols.map((b) => b.y0)) - 2);
      const right = Math.min(width, Math.max(...symbols.map((b) => b.x1)) + 2);
      const bottom = Math.min(
        height,
        Math.max(...symbols.map((b) => b.y1)) + 2,
      );
      if (right > left && bottom > top) {
        (matches[key] ||= []).push({
          x: left / width,
          y: top / height,
          width: (right - left) / width,
          height: (bottom - top) / height,
        });
      }
    }
  }
  return matches;
}

export function caseBoxes(lines, caseNumber, width, height) {
  return findFacebookCaseBoxes(
    { column: indexFacebookCases(lines, width, height) },
    caseNumber,
  );
}
