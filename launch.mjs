import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync, execFile } from "node:child_process";
const root = fileURLToPath(new URL(".", import.meta.url));
const noBrowser = process.argv.includes("--no-browser"),
  build = process.argv.includes("--build");
try {
  const health = await fetch("http://127.0.0.1:5080/api/health", {
    signal: AbortSignal.timeout(1500),
  }).then((r) => r.json());
  if (health.source === "LED + LandsMaps") {
    console.log("Land Radar is already running: http://127.0.0.1:5080");
    if (!noBrowser)
      execFile(
        "explorer.exe",
        ["http://127.0.0.1:5080"],
        { windowsHide: true },
        () => {},
      );
    process.exit(0);
  }
} catch {}
if (!existsSync(path.join(root, "server", "appsettings.Local.json"))) {
  console.error("Missing server/appsettings.Local.json. See README.md.");
  process.exit(1);
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: command === "npm.cmd",
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    console.error(result.error?.message || "Command failed");
    process.exit(result.status || 1);
  }
}
const client = path.join(root, "client"),
  server = path.join(root, "server");
if (build || !existsSync(path.join(server, "wwwroot", "index.html"))) {
  run("npm.cmd", ["ci", "--no-audit", "--no-fund"], client);
  run("npm.cmd", ["run", "build"], client);
}
if (!existsSync(path.join(server, "node_modules", "playwright")))
  run("npm.cmd", ["ci", "--no-audit", "--no-fund"], server);
run(
  process.execPath,
  ["node_modules/playwright/cli.js", "install", "chromium"],
  server,
);
run(process.execPath, ["app.mjs", ...(noBrowser ? [] : ["--open"])], server);
