import test from "node:test";
import assert from "node:assert/strict";
import { facebookFullCellReading } from "../server/domain/facebook-full-cell.mjs";
const reading = (prefix, electronic, full) => ({
  prefixSamples: [prefix],
  electronicSamples: [electronic, electronic],
  full,
});

test("full-cell language and image contexts retain a leading digit lost by a narrow crop", () => {
  assert.equal(
    facebookFullCellReading([
      reading("ผบ", false, ["ผบ19477/62", "Hu19477/62", "19477/62"]),
      reading("ผบ", false, ["ผบ190477/62", "WU19477/62", "19477/62"]),
    ]),
    "ผบ19477/62",
  );
});
test("separate full cells recover a prefix while the physical E remains independently observed", () => {
  const traces = [
    reading("ผบ", true, ["ผบ2569767", "IE2569/67", "E2569/67"]),
    reading("ผบ", true, ["ผบ2569/67", "WUE25R69/67", "E2569/67"]),
  ];
  assert.equal(facebookFullCellReading(traces), "ผบE2569/67");
  assert.equal(
    facebookFullCellReading([
      traces[0],
      { ...traces[1], prefixSamples: ["พบ"] },
    ]),
    null,
  );
  assert.equal(
    facebookFullCellReading([
      traces[0],
      { ...traces[1], electronicSamples: [false, false] },
    ]),
    null,
  );
  assert.equal(facebookFullCellReading([traces[0]]), null);
});
test("English contexts alone, a common trailing fragment and conflicting complete numbers are insufficient", () => {
  assert.equal(
    facebookFullCellReading([
      reading("ผบ", false, ["ผบ19477/62", "Hu9477/62", "9477/62"]),
      reading("ผบ", false, ["ผบ190477/62", "WU9477/62", "9477/62"]),
    ]),
    null,
  );
  assert.equal(
    facebookFullCellReading([
      reading("ผบ", false, ["ผบ12/62", "HU12/62", "12/62"]),
      reading("ผบ", false, ["ผบ13/62", "HU13/62", "13/62"]),
    ]),
    null,
  );
  assert.equal(
    facebookFullCellReading([
      reading("", true, ["826/60", "WE26/60", "E26/60"]),
      reading("", true, ["826/60", "WE26/60", "E26/60"]),
    ]),
    null,
  );
  assert.equal(
    facebookFullCellReading([
      reading("ผบ", true, ["ผบ6326/67", "HU6326/67", "E326/67"]),
      reading("ผบ", true, ["ผบ6326/67", "HU6326/67", "E326/67"]),
    ]),
    null,
    "a Thai prefix or a misread E cannot pollute the serial shared by the full readers",
  );
});
