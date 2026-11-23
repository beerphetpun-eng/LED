import { chromium } from "playwright";

export async function createFacebookOcrInput() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  return {
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
    async column(bytes, rectangle) {
      const encoded = await page.evaluate(
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
          const pixels = context.getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          // Each table row can have a different background, including dark green.
          for (let y = 0; y < canvas.height; y++) {
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
        { encoded: bytes.toString("base64"), rectangle },
      );
      return Buffer.from(encoded, "base64");
    },
    close: () => browser.close(),
  };
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
