import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, access, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEvidenceStore } from "../server/infrastructure/evidence-store.mjs";
test("evidence deletion accepts only files inside its directory and is repeatable", async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), "led-evidence-test-")),
    file = path.join(folder, "fixture.png");
  const store = createEvidenceStore(folder);
  try {
    await writeFile(file, "fixture");
    await assert.rejects(store.remove("/evidence/../fixture.png"));
    await assert.rejects(store.remove("C:/Windows/file.png"));
    await access(file);
    await store.remove("/evidence/fixture.png");
    await assert.rejects(access(file));
    await store.remove("/evidence/fixture.png");
  } finally {
    await rmdir(folder);
  }
});
