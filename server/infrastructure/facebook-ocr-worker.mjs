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
  facebookCaseNumber,
  facebookRowConsensus,
} from "../domain/facebook-case.mjs";
import {
  createFacebookOcrInput,
  facebookTableLines,
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
async function recognizeReadings(prepared, mode) {
  const thai = await recognize(
    prepared,
    null,
    mode,
    "กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮE0123456789/.",
  );
  await englishWorker.setParameters({
    tessedit_pageseg_mode: mode,
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
  return [thai, latin, numbers];
}
async function recognizeRow(bytes, rectangle, enhance = true) {
  const prepared = await input.column(bytes, rectangle, enhance);
  const line = combineFacebookRow(
    ...(await recognizeReadings(prepared, PSM.SINGLE_LINE)),
  );
  return line;
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
      let rowLeft = columnRectangle.left - 1;
      let rowWidth = Math.ceil(width * 0.0516);
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
      const rowRectangle = {
        ...columnRectangle,
        left: rowLeft,
        width: rowWidth,
        height: Math.min(
          height - columnRectangle.top,
          Math.floor(height * 0.89),
        ),
      };
      const scanLeft = Math.floor(width * 0.015);
      const table = await input.table(bytes, rowRectangle, {
        ...rowRectangle,
        left: scanLeft,
        width: rowRectangle.left + rowRectangle.width - scanLeft,
      });
      const readings = table
        ? await recognizeReadings(table.bytes, PSM.SINGLE_BLOCK)
        : [];
      const coloredRows = await input.coloredRows(bytes, {
        ...rowRectangle,
        width: columnRectangle.width - 1,
      });
      const rows =
        table?.rows ||
        coloredRows.map((row) => ({
          ...row,
          top: row.top + 2,
          height: row.height - 4,
        }));
      const review = { detected: 0, confirmed: 0, unresolved: 0, rows: [] };
      for (const row of rows) {
        const cells = readings.map((lines) => facebookTableLines(lines, row));
        const line = cells.length ? combineFacebookRow(...cells) : null;
        const known = Object.values(columnIndex)
          .flat()
          .some((box) => {
            const center = (box.y + box.height / 2) * height;
            return center >= row.top && center < row.top + row.height;
          });
        const candidate =
          known ||
          cells.some((lines) => lines.some((line) => /[0-9]/.test(line.text)));
        const record = {
          top: row.top,
          height: row.height,
          candidate,
          readings: cells.map((lines) =>
            lines.map((line) => line.text).join(""),
          ),
          caseNumber: null,
        };
        review.rows.push(record);
        if (table && !candidate) continue;
        review.detected++;
        const cell = await recognizeRow(bytes, row);
        const key = (line) =>
          line ? facebookCaseNumber(line.words[0].text) : null;
        const votes = [line, cell];
        const rectangles = new Map();
        if (!key(line) || key(line) !== key(cell))
          votes.push(await recognizeRow(bytes, row, false));
        let agreed = facebookRowConsensus(votes);
        const colored = coloredRows.find(
          (color) =>
            row.top + row.height / 2 >= color.top &&
            row.top + row.height / 2 <= color.top + color.height,
        );
        if (!agreed && colored)
          for (const inset of [0, 1]) {
            const legacy = {
              ...colored,
              width: colored.width - inset,
              top: colored.top + 2,
              height: colored.height - 4,
            };
            if (
              legacy.left === row.left &&
              legacy.top === row.top &&
              legacy.width === row.width &&
              legacy.height === row.height
            )
              continue;
            const recovered = await recognizeRow(bytes, legacy);
            if (recovered) {
              rectangles.set(recovered, legacy);
              votes.push(recovered);
              agreed = facebookRowConsensus(votes);
            }
            if (agreed) break;
          }
        if (!agreed) {
          const coarse = new Set();
          for (const index of [columnIndex, fullIndex])
            for (const [stored, boxes] of Object.entries(index)) {
              if (
                boxes.some((box) => {
                  const x = (box.x + box.width / 2) * width;
                  const y = (box.y + box.height / 2) * height;
                  return (
                    x >= row.left - 5 &&
                    x <= row.left + row.width + 5 &&
                    y >= row.top &&
                    y < row.top + row.height
                  );
                })
              )
                coarse.add(facebookCaseNumber(stored) || stored);
            }
          record.coarse = [...coarse];
          agreed = votes.find((vote) => key(vote) && coarse.has(key(vote)));
        }
        record.attempts = votes.map((line) => line?.words[0].text || null);
        if (!agreed) {
          review.unresolved++;
          continue;
        }
        const lines = restoreFacebookColumnBoxes(
          [agreed],
          rectangles.get(agreed) || row,
        );
        review.confirmed++;
        record.caseNumber = lines[0].words[0].text;
        if (!lines.length) continue;
        for (const index of [columnIndex, fullIndex])
          for (const [key, boxes] of Object.entries(index)) {
            index[key] = boxes.filter(
              (box) =>
                (box.y + box.height / 2) * height < row.top ||
                (box.y + box.height / 2) * height >= row.top + row.height,
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
              rowReview: review,
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
