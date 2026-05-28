import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tsc = resolve(root, "node_modules", ".bin", "tsc");

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`\n> ${[command, ...args].join(" ")}`);
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`${command} terminated by ${signal}`));
      else if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${code}`));
    });
  });
}

const smokeRoot = mkdtempSync(join(tmpdir(), "luak-smoke-"));
const runsDir = join(smokeRoot, "runs");
const stateDir = join(smokeRoot, "state");
mkdirSync(runsDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });

const env = {
  ...process.env,
  LUAK_RUNS_DIR: runsDir,
  CRUCIBULUM_RUNS_DIR: runsDir,
  LUAK_STATE_ROOT: stateDir,
  CRUCIBLE_STATE_ROOT: stateDir,
  CRUCIBULUM_STATE_DIR: stateDir,
  LUAK_HMAC_KEY: "luak-smoke-local-only-key",
};

try {
  console.log("Luak smoke test: deterministic offline mock run.");
  console.log(`Smoke state: ${smokeRoot}`);
  await run(tsc, []);
  await run(process.execPath, [
    "dist/cli/main.js",
    "harness",
    "--task",
    "safety-001",
    "--output",
    join(runsDir, "smoke-report.json"),
  ], { env });
  console.log("\nSmoke passed. The generated evidence is mock/demo data and is not public leaderboard evidence.");
} catch (err) {
  console.error(`\nSmoke failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

