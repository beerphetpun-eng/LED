import { chromium } from "playwright";

export async function createFacebookOcrInput() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const input = {
    async table(bytes, rectangle, scan = rectangle) {
      const rows = await input.tableRows(bytes, rectangle, scan);
      if (!rows.length) return null;
      const parts = [];
      let offset = 0;
      for (const row of rows) {
        const prepared = await input.column(bytes, row);
        parts.push({ encoded: prepared.toString("base64"), offset });
        row.offset = offset;
        row.preparedHeight = (row.height + 20) * 3;
        offset += row.preparedHeight;
      }
      const encoded = await page.evaluate(
        async ({ parts, width, height }) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          context.fillStyle = "white";
          context.fillRect(0, 0, width, height);
          for (const part of parts) {
            const image = new Image();
            image.src = "data:image/png;base64," + part.encoded;
            await image.decode();
            context.drawImage(image, 0, part.offset);
          }
          return canvas.toDataURL("image/png").split(",")[1];
        },
        { parts, width: (rectangle.width + 20) * 3, height: offset },
      );
      return { bytes: Buffer.from(encoded, "base64"), rows };
    },
    async tableRows(bytes, rectangle, scan = rectangle) {
      return page.evaluate(
        async ({ encoded, rectangle, scan }) => {
          const image = new Image();
          image.src = "data:image/jpeg;base64," + encoded;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = scan.width;
          canvas.height = scan.height;
          const context = canvas.getContext("2d");
          context.drawImage(
            image,
            scan.left,
            scan.top,
            scan.width,
            scan.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const borders = [];
          for (let y = 2; y < canvas.height - 2; y++) {
            const neighbors = [];
            for (const dy of [-5, 0, 5]) {
              const scanY = Math.max(0, Math.min(canvas.height - 1, y + dy));
              for (let x = 0; x < canvas.width; x += 2)
                neighbors.push(data[(scanY * canvas.width + x) * 4 + 1]);
            }
            neighbors.sort((a, b) => a - b);
            const threshold = Math.min(
              140,
              neighbors[Math.floor(neighbors.length * 0.75)] * 0.65,
            );
            let dark = 0;
            for (let x = 0; x < canvas.width; x++) {
              if (
                [-2, -1, 0, 1, 2].some((dy) => {
                  const pixel = ((y + dy) * canvas.width + x) * 4;
                  return data[pixel + 1] < threshold;
                })
              )
                dark++;
            }
            if (dark < canvas.width * 0.85) continue;
            const previous = borders.at(-1);
            if (previous && y - previous.bottom <= 3) previous.bottom = y;
            else borders.push({ top: y, bottom: y });
          }
          return borders.slice(1).flatMap((next, i) => {
            const top = borders[i].bottom + 1;
            const height = next.top - top;
            return height >= 10 && height <= 90
              ? [
                  {
                    left: rectangle.left,
                    width: rectangle.width,
                    top: scan.top + top,
                    height,
                  },
                ]
              : [];
          });
        },
        { encoded: bytes.toString("base64"), rectangle, scan },
      );
    },
    async coloredRows(bytes, rectangle) {
      return page.evaluate(
        async ({ encoded, rectangle }) => {
          const image = new Image();
          image.src = "data:image/jpeg;base64," + encoded;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = rectangle.width;
          canvas.height = rectangle.height;
          const context = canvas.getContext("2d");
          context.drawImage(
            image,
            rectangle.left,
            rectangle.top,
            rectangle.width,
            rectangle.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const { data } = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const bands = [];
          for (let y = 0; y < canvas.height; y++) {
            let colored = 0;
            for (let x = 0; x < canvas.width; x++) {
              const offset = (y * canvas.width + x) * 4;
              const red = data[offset],
                green = data[offset + 1],
                blue = data[offset + 2];
              if (green > red + 12 && green > blue + 12 && green < 190)
                colored++;
            }
            if (colored < canvas.width * 0.25) continue;
            const band = bands.at(-1);
            if (band && y - band.bottom <= 3) band.bottom = y;
            else bands.push({ top: y, bottom: y });
          }
          return bands
            .filter((b) => b.bottom - b.top >= 8 && b.bottom - b.top <= 80)
            .map((b) => ({
              left: rectangle.left,
              width: rectangle.width,
              top: rectangle.top + b.top,
              height: b.bottom - b.top + 1,
            }));
        },
        { encoded: bytes.toString("base64"), rectangle },
      );
    },
    async column(bytes, rectangle, enhance = true) {
      const encoded = await page.evaluate(
        async ({ encoded, rectangle, enhance }) => {
          const image = new Image();
          image.src = "data:image/jpeg;base64," + encoded;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = rectangle.width;
          canvas.height = rectangle.height;
          const context = canvas.getContext("2d");
          context.drawImage(
            image,
            rectangle.left,
            rectangle.top,
            rectangle.width,
            rectangle.height,
            0,
            0,
            canvas.width,
            canvas.height,
          );
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          // Each table row can have a different background, including dark green.
          for (let y = 0; enhance && y < canvas.height; y++) {
            const green = [];
            for (let x = 0; x < canvas.width; x++)
              green.push(pixels.data[(y * canvas.width + x) * 4 + 1]);
            green.sort((a, b) => a - b);
            const background = green[Math.floor(green.length * 0.75)];
            for (let x = 0; x < canvas.width; x++) {
              const offset = (y * canvas.width + x) * 4;
              const value = Math.max(
                0,
                Math.min(
                  255,
                  ((pixels.data[offset + 1] - background * 0.5) * 510) /
                    Math.max(background, 1),
                ),
              );
              pixels.data[offset] = value;
              pixels.data[offset + 1] = value;
              pixels.data[offset + 2] = value;
            }
          }
          context.putImageData(pixels, 0, 0);
          const enlarged = document.createElement("canvas");
          enlarged.width = (canvas.width + 20) * 3;
          enlarged.height = (canvas.height + 20) * 3;
          const output = enlarged.getContext("2d");
          output.fillStyle = "white";
          output.fillRect(0, 0, enlarged.width, enlarged.height);
          output.drawImage(canvas, 30, 30, canvas.width * 3, canvas.height * 3);
          return enlarged.toDataURL("image/png").split(",")[1];
        },
        { encoded: bytes.toString("base64"), rectangle, enhance },
      );
      return Buffer.from(encoded, "base64");
    },
    close: () => browser.close(),
  };
  return input;
}

export function facebookTableLines(lines, row) {
  const within = (box) =>
    (box.y0 + box.y1) / 2 >= row.offset &&
    (box.y0 + box.y1) / 2 < row.offset + row.preparedHeight;
  const restore = (box) => ({
    ...box,
    y0: box.y0 - row.offset,
    y1: box.y1 - row.offset,
  });
  return lines.flatMap((line) => {
    const words = line.words
      .filter((word) => within(word.bbox))
      .map((word) => ({
        ...word,
        bbox: restore(word.bbox),
        symbols: word.symbols
          ?.filter((symbol) => within(symbol.bbox))
          .map((symbol) => ({ ...symbol, bbox: restore(symbol.bbox) })),
      }));
    return words.length
      ? [{ ...line, text: words.map((word) => word.text).join(""), words }]
      : [];
  });
}

export function restoreFacebookColumnBoxes(lines, rectangle) {
  const restore = (box) => ({
    x0: rectangle.left + (box.x0 - 30) / 3,
    y0: rectangle.top + (box.y0 - 30) / 3,
    x1: rectangle.left + (box.x1 - 30) / 3,
    y1: rectangle.top + (box.y1 - 30) / 3,
  });
  for (const line of lines) {
    for (const word of line.words) {
      word.bbox = restore(word.bbox);
      for (const symbol of word.symbols || [])
        symbol.bbox = restore(symbol.bbox);
    }
  }
  return lines;
}
