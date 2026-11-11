import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
test("domain and application cannot depend on delivery or infrastructure frameworks", async () => {
  for (const layer of ["domain", "application"]) {
    const dir = new URL(`../server/${layer}/`, import.meta.url);
    for (const file of await readdir(dir)) {
      const source = await readFile(new URL(file, dir), "utf8");
      const imports = [
        ...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g),
      ].map((m) => m[1]);
      assert.ok(
        imports.every(
          (i) =>
            !/(?:infrastructure|presentation|express|playwright|^pg$)/.test(i),
        ),
        `${layer}/${file} violates dependency direction`,
      );
    }
  }
});
