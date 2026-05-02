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

const smokeRoot = mkdtempSync(join(tmpdir(), "crucible-smoke-"));
const runsDir = join(smokeRoot, "runs");
const stateDir = join(smokeRoot, "state");
mkdirSync(runsDir, { recursive: true });
mkdirSync(stateDir, { recursive: true });

const env = {
  ...process.env,
  CRUCIBULUM_RUNS_DIR: runsDir,
  CRUCIBLE_STATE_ROOT: stateDir,
  CRUCIBULUM_STATE_DIR: stateDir,
  CRUCIBLE_HMAC_KEY: "crucible-smoke-local-only-key",
  CRUCIBLE_ALLOW_LOCAL: "true",
};

try {
  console.log("Crucible smoke test: deterministic offline mock run.");
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

