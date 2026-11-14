import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { superviseServer } from "../scripts/supervise-server.mjs";

async function worker(t, source) {
  const cwd = await mkdtemp(path.join(tmpdir(), "land-radar-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const entry = path.join(cwd, "worker.mjs");
  await writeFile(entry, source);
  return { entry, cwd };
}

test("restarts a crashed server and logs the failure", async (t) => {
  const { entry, cwd } = await worker(
    t,
    `if (process.argv.includes("--open")) throw Error("simulated crash");`,
  );
  const messages = [];
  await superviseServer(entry, {
    cwd,
    args: ["--open"],
    signal: AbortSignal.timeout(5_000),
    initialDelayMs: 5,
    log: (message) => messages.push(message),
  });
  assert.equal(
    messages.filter((message) => message.startsWith("Server started")).length,
    2,
  );
  assert.match(messages[1], /exit code 1.*Restarting in 5 ms\./);
  assert.match(messages[1], /simulated crash/);
  assert.equal(messages[3], "Server stopped");
});

test("requested shutdown lets the worker exit without restarting", async (t) => {
  const { entry, cwd } = await worker(
    t,
    `import { writeFileSync } from "node:fs";
     process.on("message", (message) => {
       if (message !== "shutdown") return;
       writeFileSync("shutdown.txt", "clean");
       process.exit(0);
     });`,
  );
  const stop = new AbortController();
  const messages = [];
  await superviseServer(entry, {
    cwd,
    signal: AbortSignal.any([stop.signal, AbortSignal.timeout(5_000)]),
    initialDelayMs: 5,
    log: (message) => {
      messages.push(message);
      if (message.startsWith("Server started")) stop.abort();
    },
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[1], "Server stopped");
  assert.equal(await readFile(path.join(cwd, "shutdown.txt"), "utf8"), "clean");
});

test("requested shutdown cancels pending restart", async (t) => {
  const { entry, cwd } = await worker(t, "process.exit(1);");
  const stop = new AbortController();
  const messages = [];
  await superviseServer(entry, {
    cwd,
    signal: stop.signal,
    initialDelayMs: 5,
    log: (message) => {
      messages.push(message);
      if (message.includes("Restarting")) stop.abort();
    },
  });
  assert.equal(messages.length, 2);
  assert.match(messages[1], /Restarting in 5 ms/);
});
