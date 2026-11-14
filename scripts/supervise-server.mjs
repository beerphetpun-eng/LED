import { fork } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

export async function superviseServer(
  entry,
  { cwd, args = [], signal, log, initialDelayMs = 1000 },
) {
  let restartDelayMs = initialDelayMs;
  while (!signal.aborted) {
    const startedAt = performance.now();
    const child = fork(entry, args, {
      cwd,
      stdio: ["inherit", "inherit", "pipe", "ipc"],
    });
    args = [];
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      process.stderr.write(chunk);
      stderr = (stderr + chunk).slice(-16_384);
    });
    let forceStop;
    const stop = () => {
      if (child.connected) child.send("shutdown", () => {});
      forceStop = setTimeout(() => child.kill(), 15_000).unref();
    };
    signal.addEventListener("abort", stop, { once: true });
    const result = await new Promise((resolve) => {
      let error;
      child.on("error", (err) => {
        error = err;
      });
      child.once("spawn", () => log(`Server started (PID ${child.pid})`));
      child.once("close", (code, exitSignal) =>
        resolve({ code, exitSignal, error }),
      );
    });
    clearTimeout(forceStop);
    signal.removeEventListener("abort", stop);
    if (signal.aborted || result.code === 0) {
      log("Server stopped");
      return;
    }

    if (performance.now() - startedAt >= 60_000)
      restartDelayMs = initialDelayMs;
    const reason =
      result.error?.message ?? result.exitSignal ?? `exit code ${result.code}`;
    log(
      `Server stopped unexpectedly (${reason}). Restarting in ${restartDelayMs} ms.` +
        (stderr.trim() ? `\n${stderr.trimEnd()}` : ""),
    );
    try {
      await delay(restartDelayMs, undefined, { signal });
    } catch (error) {
      if (signal.aborted) return;
      throw error;
    }
    restartDelayMs = Math.min(restartDelayMs * 2, 30_000);
  }
}
