const normalize = (text) =>
  text
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[.\s\u200b-\u200f]/g, "")
    .toUpperCase();

export function facebookCaseNumber(caseNumber) {
  const parts = normalize(caseNumber || "").match(
    /^([\p{L}]+)(\d+)\/(\d{4})$/u,
  );
  return parts ? `${parts[1].replace(/E$/, "")}${parts[2]}/${parts[3]}` : null;
}

export function findFacebookCaseBoxes(index, caseNumber) {
  const key = facebookCaseNumber(caseNumber);
  if (!key || !index) return [];
  const short = key.replace(/\/(\d{2})(\d{2})$/, "/$2");
  const lookup = (rows) => [...(rows?.[key] || []), ...(rows?.[short] || [])];
  const column = lookup(index.column);
  return column.length ? column : lookup(index.fullPage);
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
    for (const match of text.matchAll(/([\p{L}]+)(\d+)\/(\d{2,4})(?!\d)/gu)) {
      const [, photoPrefix, photoNumber, photoYear] = match;
      if (photoYear.length === 3) continue;
      const symbols = boxes.slice(match.index, match.index + match[0].length);
      const left = Math.max(0, Math.min(...symbols.map((b) => b.x0)) - 2);
      const top = Math.max(0, Math.min(...symbols.map((b) => b.y0)) - 2);
      const right = Math.min(width, Math.max(...symbols.map((b) => b.x1)) + 2);
      const bottom = Math.min(
        height,
        Math.max(...symbols.map((b) => b.y1)) + 2,
      );
      if (right > left && bottom > top) {
        const key = `${photoPrefix.replace(/E$/, "")}${photoNumber}/${photoYear}`;
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
