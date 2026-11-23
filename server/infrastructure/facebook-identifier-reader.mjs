import { createWorker, PSM } from "tesseract.js";
import { facebookFieldConsensus } from "../domain/facebook-identifier-fields.mjs";

const consonants = "กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรฤลฦวศษสหฬอฮ";
const linesOf = (data) =>
  data.blocks?.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) => paragraph.lines),
  ) || [];
const symbolsOf = (result) =>
  result.lines.flatMap((line) =>
    line.words.flatMap((word) =>
      word.symbols?.length ? word.symbols : [word],
    ),
  );
const clean = (text) =>
  String(text || "")
    .normalize("NFKC")
    .replace(/[.\s]/g, "");

export async function createFacebookIdentifierReader({ langPath, input }) {
  const options = { langPath, cacheMethod: "none", errorHandler: () => {} };
  const config = { load_system_dawg: "0", load_freq_dawg: "0" };
  const thai = await createWorker("tha", 1, options, config);
  const english = await createWorker("eng", 1, options, config);
  async function read(worker, bytes, mode, whitelist = "") {
    await worker.setParameters({
      tessedit_pageseg_mode: mode,
      tessedit_char_whitelist: whitelist,
    });
    const { data } = await worker.recognize(
      bytes,
      {},
      { blocks: true, text: true },
    );
    return { text: data.text || "", lines: linesOf(data) };
  }
  return {
    async read(bytes, rectangle, enhance = true) {
      const trace = {
        prefixSamples: [],
        electronicSamples: [],
        numberSamples: [],
        prefixLatin: [],
        bounds: rectangle,
      };
      const prepared = await input.column(bytes, rectangle, enhance);
      let fullThai = await read(
        thai,
        prepared,
        PSM.SINGLE_LINE,
        consonants + "E0123456789/.",
      );
      let fullEnglish = await read(english, prepared, PSM.SINGLE_LINE);
      let fullNumbers = await read(
        english,
        prepared,
        PSM.SINGLE_LINE,
        "E0123456789/.",
      );
      if (!fullThai.text.trim()) {
        fullThai = await read(
          thai,
          prepared,
          PSM.RAW_LINE,
          consonants + "E0123456789/.",
        );
        fullEnglish = await read(english, prepared, PSM.RAW_LINE);
        fullNumbers = await read(
          english,
          prepared,
          PSM.RAW_LINE,
          "E0123456789/.",
        );
      }
      const requiredNumber = clean(fullNumbers.text).match(
        /^E(\d+\/\d{2,4})$/,
      )?.[1];
      trace.full = [fullThai.text, fullEnglish.text, fullNumbers.text];
      const thaiSymbols = symbolsOf(fullThai);
      const leading = [];
      for (const symbol of thaiSymbols) {
        if (!clean(symbol.text)) continue;
        if (!/^[ก-ฮ]+$/.test(clean(symbol.text))) break;
        leading.push(symbol);
      }
      const englishSymbols = symbolsOf(fullEnglish),
        digitSymbols = symbolsOf(fullNumbers);
      const observedE = englishSymbols.find(
        (s) => s.text.toUpperCase() === "E",
      );
      const constrainedE = clean(fullNumbers.text).startsWith("E")
        ? digitSymbols.find((s) => s.text === "E")
        : null;
      trace.electronicSamples.push(Boolean(observedE), Boolean(constrainedE));
      if (Boolean(observedE) !== Boolean(constrainedE))
        return { line: null, trace };
      const electronic = Boolean(observedE);
      const prefixSymbols = electronic
        ? leading.filter((s) => (s.bbox.x0 + s.bbox.x1) / 2 < observedE.bbox.x0)
        : leading;
      const prefixEnd = prefixSymbols.length
        ? Math.max(...prefixSymbols.map((s) => s.bbox.x1))
        : 30;
      const firstThaiNumber = thaiSymbols.find(
        (s) => /^\d$/.test(s.text) && s.bbox.x0 >= prefixEnd - 1,
      );
      const suffixSymbols = digitSymbols.slice(
        digitSymbols.indexOf(constrainedE) + 1,
      );
      const digitStart = electronic
        ? Math.min(
            observedE.bbox.x1,
            suffixSymbols.find((s) => /^\d$/.test(s.text))?.bbox.x0 ??
              observedE.bbox.x1,
          )
        : firstThaiNumber?.bbox.x0;
      if (digitStart === undefined) return { line: null, trace };
      let numberLeft = Math.max(
        rectangle.left,
        rectangle.left + (digitStart - 30) / 3,
      );
      const allowEmptyPrefix =
        !thaiSymbols.some((s) => /[ก-ฮ]/.test(s.text)) &&
        !electronic &&
        numberLeft - rectangle.left <= 6 &&
        /^\d+\/\d{2,4}$/.test(clean(fullEnglish.text));
      const thaiRight = electronic
        ? rectangle.left + (observedE.bbox.x0 - 30) / 3
        : numberLeft;
      if (allowEmptyPrefix) trace.prefixSamples.push("", "");
      else {
        trace.prefixSamples.push(
          prefixSymbols.map((symbol) => symbol.text).join(""),
        );
        const width = Math.floor(thaiRight - rectangle.left);
        if (width < 3) return { line: null, trace };
        const prefixRect = { ...rectangle, width };
        for (const profile of [enhance, false])
          trace.prefixSamples.push(
            (
              await read(
                thai,
                await input.column(bytes, prefixRect, profile),
                PSM.SINGLE_LINE,
                consonants,
              )
            ).text,
          );
        trace.prefixSamples.push(
          (
            await read(
              thai,
              await input.column(bytes, prefixRect, enhance),
              PSM.SINGLE_WORD,
              consonants,
            )
          ).text,
        );
        for (const adjusted of [
          { ...prefixRect, width: prefixRect.width + 1 },
          {
            ...prefixRect,
            top: prefixRect.top + 2,
            height: prefixRect.height - 4,
          },
        ])
          trace.prefixSamples.push(
            (
              await read(
                thai,
                await input.column(bytes, adjusted, enhance),
                PSM.SINGLE_LINE,
                consonants,
              )
            ).text,
          );
      }
      const fullNumber = clean(fullThai.text).match(/(\d+\/\d{2,4})$/)?.[1];
      if (fullNumber)
        trace.numberSamples.push({ model: "cell", text: fullNumber });
      for (const full of [fullEnglish, fullNumbers]) {
        const number = clean(full.text).match(/^[^0-9]*?(\d+\/\d{2,4})$/)?.[1];
        if (number) trace.numberSamples.push({ model: "cell", text: number });
      }
      const numberRect = {
        ...rectangle,
        left: Math.floor(numberLeft),
        width: Math.ceil(rectangle.left + rectangle.width - numberLeft),
      };
      if (numberRect.width < 5) return { line: null, trace };
      for (const profile of [enhance, false]) {
        const numberImage = await input.column(bytes, numberRect, profile);
        trace.numberSamples.push({
          model: "eng",
          text: (
            await read(english, numberImage, PSM.SINGLE_LINE, "0123456789/.")
          ).text,
        });
        trace.numberSamples.push({
          model: "tha",
          text: (await read(thai, numberImage, PSM.SINGLE_LINE, "0123456789/."))
            .text,
        });
        if (facebookFieldConsensus({ ...trace, allowEmptyPrefix })) break;
      }
      if (!facebookFieldConsensus({ ...trace, allowEmptyPrefix })) {
        const numberImage = await input.column(bytes, numberRect, enhance);
        trace.numberSamples.push({
          model: "eng",
          text: (await read(english, numberImage, PSM.RAW_LINE, "0123456789/."))
            .text,
        });
        trace.numberSamples.push({
          model: "tha",
          text: (await read(thai, numberImage, PSM.RAW_LINE, "0123456789/."))
            .text,
        });
      }
      trace.numberBounds = numberRect;
      let text = facebookFieldConsensus({ ...trace, allowEmptyPrefix });
      if (
        requiredNumber &&
        text &&
        text.match(/(\d+\/\d{2,4})$/)?.[1] !== requiredNumber
      )
        text = null;
      const line = text
        ? {
            fieldVerified: true,
            words: [
              {
                text,
                bbox: {
                  x0: 30,
                  y0: 30,
                  x1: 30 + rectangle.width * 3,
                  y1: 30 + rectangle.height * 3,
                },
              },
            ],
          }
        : null;
      return { line, trace };
    },
    async close() {
      await Promise.all([thai.terminate(), english.terminate()]);
    },
  };
}
