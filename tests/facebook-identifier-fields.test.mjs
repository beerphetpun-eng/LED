import test from "node:test";
import assert from "node:assert/strict";
import { facebookFieldConsensus } from "../server/domain/facebook-identifier-fields.mjs";

const readings = () => ({
  prefixSamples: ["ผบ", "ผบ.", "ผง"],
  electronicSamples: [true, true],
  numberSamples: [
    { model: "cell", text: "6757/2566" },
    { model: "eng", text: "6757/66" },
  ],
});

test("identifier fields agree across contexts without changing an electronic prefix", () => {
  assert.equal(facebookFieldConsensus(readings()), "ผบE6757/66");
  assert.equal(
    facebookFieldConsensus({
      ...readings(),
      electronicSamples: [false, false],
    }),
    "ผบ6757/66",
  );
  assert.equal(
    facebookFieldConsensus({ ...readings(), electronicSamples: [false, true] }),
    null,
  );
  assert.equal(
    facebookFieldConsensus({ ...readings(), prefixSamples: ["ผบ", "พ"] }),
    null,
  );
});

test("repeated readings of one context and competing serials do not prove a match", () => {
  assert.equal(
    facebookFieldConsensus({
      ...readings(),
      numberSamples: [
        { model: "cell", text: "6/59" },
        { model: "cell", text: "6/59" },
      ],
    }),
    null,
  );
  assert.equal(
    facebookFieldConsensus({
      ...readings(),
      numberSamples: [
        ...readings().numberSamples,
        { model: "cell", text: "757/66" },
        { model: "eng", text: "757/66" },
      ],
    }),
    null,
  );
});

test("numeric-only cases require explicit empty-prefix evidence and cannot become E cases", () => {
  const numbers = {
    prefixSamples: ["", ""],
    electronicSamples: [false, false],
    numberSamples: [
      { model: "eng", text: "8056/49" },
      { model: "tha", text: "8056/2549" },
    ],
  };
  assert.equal(facebookFieldConsensus(numbers), null);
  assert.equal(
    facebookFieldConsensus({ ...numbers, allowEmptyPrefix: true }),
    "8056/49",
  );
  assert.equal(
    facebookFieldConsensus({
      ...numbers,
      allowEmptyPrefix: true,
      electronicSamples: [true, true],
    }),
    null,
  );
});
