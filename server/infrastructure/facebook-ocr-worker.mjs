import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";
import { createWorker, PSM } from "tesseract.js";
import thai from "@tesseract.js-data/tha";
import english from "@tesseract.js-data/eng";
import { imageSize } from "image-size";
import { caseBoxes } from "../domain/facebook-case.mjs";

const { caseNumber, files, langPath } = JSON.parse(await text(process.stdin));
const languages = [thai, english];
for (const { code, langPath: packagePath } of languages) {
  const file = `${code}.traineddata.gz`;
  await copyFile(
    path.join(packagePath, "../4.0.0_best_int", file),
    path.join(langPath, file),
  );
}
const worker = await createWorker(
  languages.map(({ code }) => code),
  1,
  { langPath, cacheMethod: "none", errorHandler: () => {} },
);
const linesOf = (data) =>
  data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
async function recognize(bytes, rectangle, mode) {
  await worker.setParameters({ tessedit_pageseg_mode: mode });
  const { data } = await worker.recognize(
    bytes,
    rectangle ? { rectangle } : {},
    { blocks: true, text: false },
  );
  return linesOf(data);
}
const results = [];
try {
  for (const file of files) {
    try {
      const bytes = await readFile(file);
      const { width, height } = imageSize(bytes);
      const standardColumn = await recognize(
        bytes,
        {
          left: Math.floor(width * 0.1015),
          top: Math.floor(height * 0.055),
          width: Math.ceil(width * 0.054),
          height: Math.floor(height * 0.86),
        },
        PSM.SINGLE_BLOCK,
      );
      if (
        standardColumn.some((line) =>
          line.text.replace(/\s/g, "").includes("เลขคดี"),
        )
      ) {
        let boxes = caseBoxes(standardColumn, caseNumber, width, height);
        if (!boxes.length) {
          // Text in surrounding cells can help OCR distinguish Thai case prefixes.
          const fullPage = await recognize(bytes, null, PSM.AUTO);
          boxes = caseBoxes(fullPage, caseNumber, width, height);
        }
        results.push(boxes);
        continue;
      }
      const header = await recognize(
        bytes,
        {
          left: 0,
          top: 0,
          width,
          height: Math.ceil(height * 0.22),
        },
        PSM.SPARSE_TEXT,
      );
      const cell = header
        .flatMap((line) => line.words)
        .find((word) => word.text.replace(/\s/g, "").includes("เลขคดี"));
      let lines;
      if (cell) {
        const center = (cell.bbox.x0 + cell.bbox.x1) / 2;
        const left = Math.max(0, Math.floor(center - width * 0.027));
        const right = Math.min(width, Math.ceil(center + width * 0.027));
        lines = await recognize(
          bytes,
          {
            left,
            top: cell.bbox.y1,
            width: right - left,
            height: height - cell.bbox.y1,
          },
          PSM.SINGLE_BLOCK,
        );
      } else {
        lines = await recognize(bytes, null, PSM.AUTO);
      }
      let boxes = caseBoxes(lines, caseNumber, width, height);
      if (!boxes.length && cell) {
        const fullPage = await recognize(bytes, null, PSM.AUTO);
        boxes = caseBoxes(fullPage, caseNumber, width, height);
      }
      results.push(
        lines.length || boxes.length ? boxes : null,
      );
    } catch {
      results.push(null);
    }
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await worker.terminate();
}
