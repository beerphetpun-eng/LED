import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recognizeFacebookCases } from "../server/infrastructure/facebook-image-filter.mjs";
import { findFacebookCaseBoxes } from "../server/domain/facebook-case.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const fixtures = JSON.parse(
  await readFile(
    process.argv[2] ||
      path.join(root, "server/data/facebook-ocr-regressions.json"),
    "utf8",
  ),
);
const pipelineFiles = [
  "server/domain/facebook-case.mjs",
  "server/infrastructure/facebook-ocr-worker.mjs",
  "server/infrastructure/facebook-ocr-input.mjs",
];
async function fingerprint() {
  const hash = createHash("sha256");
  for (const file of pipelineFiles)
    hash.update(await readFile(path.join(root, file)));
  return hash.digest("hex");
}
const pipelineHash = await fingerprint();
const files = [...new Set(fixtures.map((sample) => sample.file))];
assert(
  files.every((file) => /^fb-[a-z0-9-]+\.(jpg|png|webp)$/.test(file)),
  "Use original shared evidence filenames only",
);
const results = [];
for (let offset = 0; offset < files.length; offset += 4) {
  results.push(
    ...(await recognizeFacebookCases(
      files
        .slice(offset, offset + 4)
        .map((file) => path.join(root, "server/data/evidence", file)),
    )),
  );
}
const failed = [];
let checks = 0;
for (const sample of fixtures) {
  const index = results[files.indexOf(sample.file)];
  for (const caseNumber of sample.cases || []) {
    checks++;
    if (!findFacebookCaseBoxes(index, caseNumber).length)
      failed.push({ file: sample.file, caseNumber, expected: "matched" });
  }
  for (const caseNumber of sample.excludedCases || []) {
    checks++;
    if (findFacebookCaseBoxes(index, caseNumber).length)
      failed.push({ file: sample.file, caseNumber, expected: "absent" });
  }
}
assert.equal(
  await fingerprint(),
  pipelineHash,
  "OCR pipeline changed during verification",
);
await writeFile(
  path.join(root, "server/data/facebook-ocr-regression-results.json"),
  JSON.stringify({ pipelineHash, files, results, checks, failed }, null, 2),
);
console.log(JSON.stringify({ files: files.length, checks, failed }));
assert.equal(
  failed.length,
  0,
  "Stored evidence regression failed; do not deploy the new OCR index",
);
