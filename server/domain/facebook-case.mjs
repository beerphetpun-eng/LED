const normalize = (text) =>
  text
    .normalize("NFKC")
    .replace(/[๐-๙]/g, (digit) => String(digit.charCodeAt(0) - 0x0e50))
    .replace(/[.\s\u200b-\u200f]/g, "")
    .toUpperCase();

export function caseBoxes(lines, caseNumber, width, height) {
  const target = normalize(caseNumber || "").match(
    /^([\p{L}]+)(\d+)\/(\d{4})$/u,
  );
  if (!target) return [];
  const [, prefix, number, year] = target;
  const matches = [];
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
    for (const match of text.matchAll(/[\p{L}]+\d+\/\d{2,4}(?!\d)/gu)) {
      if (
        match[0] !== `${prefix}${number}/${year}` &&
        match[0] !== `${prefix}${number}/${year.slice(-2)}`
      )
        continue;
      const symbols = boxes.slice(match.index, match.index + match[0].length);
      const left = Math.max(0, Math.min(...symbols.map((b) => b.x0)) - 2);
      const top = Math.max(0, Math.min(...symbols.map((b) => b.y0)) - 2);
      const right = Math.min(width, Math.max(...symbols.map((b) => b.x1)) + 2);
      const bottom = Math.min(
        height,
        Math.max(...symbols.map((b) => b.y1)) + 2,
      );
      if (right > left && bottom > top)
        matches.push({
          x: left / width,
          y: top / height,
          width: (right - left) / width,
          height: (bottom - top) / height,
        });
    }
  }
  return matches;
}
