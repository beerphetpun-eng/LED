import { copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { text } from "node:stream/consumers";
import { createWorker, PSM } from "tesseract.js";
import thai from "@tesseract.js-data/tha";
import english from "@tesseract.js-data/eng";
import { imageSize } from "image-size";
import {
  indexFacebookCases,
  combineFacebookRow,
} from "../domain/facebook-case.mjs";
import {
  createFacebookOcrInput,
  restoreFacebookColumnBoxes,
} from "./facebook-ocr-input.mjs";

const { files, langPath } = JSON.parse(await text(process.stdin));
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
const input = await createFacebookOcrInput();
const englishWorker = await createWorker("eng", 1, {
  langPath,
  cacheMethod: "none",
  errorHandler: () => {},
});
const linesOf = (data) =>
  data.blocks?.flatMap((b) => b.paragraphs.flatMap((p) => p.lines)) ?? [];
async function recognize(bytes, rectangle, mode, whitelist = "") {
  await worker.setParameters({
    tessedit_pageseg_mode: mode,
    tessedit_char_whitelist: whitelist,
  });
  const { data } = await worker.recognize(
    bytes,
    rectangle ? { rectangle } : {},
    { blocks: true, text: false },
  );
  return linesOf(data);
}
async function recognizeColoredRow(bytes, rectangle) {
  const prepared = await input.column(bytes, rectangle);
  const thai = await recognize(
    prepared,
    null,
    PSM.SINGLE_LINE,
    "กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮE0123456789/.",
  );
  await englishWorker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    tessedit_char_whitelist: "",
  });
  const latin = linesOf(
    (await englishWorker.recognize(prepared, {}, { blocks: true, text: false }))
      .data,
  );
  await englishWorker.setParameters({
    tessedit_char_whitelist: "E0123456789/.",
  });
  const numbers = linesOf(
    (await englishWorker.recognize(prepared, {}, { blocks: true, text: false }))
      .data,
  );
  const line = combineFacebookRow(thai, latin, numbers);
  return line ? restoreFacebookColumnBoxes([line], rectangle) : [];
}
const results = [];
try {
  for (const file of files) {
    try {
      const bytes = await readFile(file);
      const { width, height } = imageSize(bytes);
      const columnRectangle = {
        left: Math.floor(width * 0.1015),
        top: Math.floor(height * 0.055),
        width: Math.ceil(width * 0.054),
        height: Math.floor(height * 0.86),
      };
      const standardColumn = await recognize(
        bytes,
        columnRectangle,
        PSM.SINGLE_BLOCK,
      );
      let column = standardColumn;
      if (
        !standardColumn.some((line) =>
          line.text.replace(/\s/g, "").includes("เลขคดี"),
        )
      ) {
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
        if (cell) {
          const center = (cell.bbox.x0 + cell.bbox.x1) / 2;
          const left = Math.max(0, Math.floor(center - width * 0.027));
          const right = Math.min(width, Math.ceil(center + width * 0.027));
          column = await recognize(
            bytes,
            {
              left,
              top: cell.bbox.y1,
              width: right - left,
              height: height - cell.bbox.y1,
            },
            PSM.SINGLE_BLOCK,
          );
        }
      }
      // Context around the column can disambiguate Thai case prefixes.
      const fullPage = await recognize(bytes, null, PSM.AUTO);
      const columnIndex = indexFacebookCases(column, width, height);
      const fullIndex = indexFacebookCases(fullPage, width, height);
      const coloredRows = await input.coloredRows(bytes, {
        ...columnRectangle,
        left: columnRectangle.left - 1,
        width: columnRectangle.width - 1,
      });
      for (const row of coloredRows) {
        const rectangle = { ...row, top: row.top + 2, height: row.height - 4 };
        const lines = await recognizeColoredRow(bytes, rectangle);
        if (!lines.length) continue;
        for (const index of [columnIndex, fullIndex])
          for (const [key, boxes] of Object.entries(index)) {
            index[key] = boxes.filter(
              (box) =>
                box.y + box.height < row.top / height ||
                box.y > (row.top + row.height) / height,
            );
            if (!index[key].length) delete index[key];
          }
        for (const [key, boxes] of Object.entries(
          indexFacebookCases(lines, width, height),
        ))
          columnIndex[key] = [...(columnIndex[key] || []), ...boxes];
      }
      results.push(
        column.length || fullPage.length || Object.keys(columnIndex).length
          ? {
              column: columnIndex,
              fullPage: fullIndex,
            }
          : null,
      );
    } catch {
      results.push(null);
    }
  }
  process.stdout.write(JSON.stringify(results));
} finally {
  await input.close();
  await englishWorker.terminate();
  await worker.terminate();
}
