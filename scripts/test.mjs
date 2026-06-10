import { readdirSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = resolve(root, "dist", "tests");
const files = readdirSync(testsDir)
  .filter((name) => name.endsWith(".test.js"))
  .sort()
  .map((name) => join(testsDir, name));

if (files.length === 0) {
  console.error("No compiled tests found in dist/tests. Run npm run build first.");
  process.exit(1);
}

const child = spawn(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
  shell: false,
  // node --test runs files in parallel processes that share state/. Circuit
  // breaker persistence (Audit C3) would otherwise let one suite's opened
  // circuit leak into another via state/circuit-breaker.json and block its
  // runs. Disable persistence globally for the suite; the C3 test re-enables
  // it against its own temp file. (Suites that don't touch it are unaffected.)
  env: { ...process.env, LUAK_DISABLE_CIRCUIT_PERSIST: "1" },
});

child.on("error", (err) => {
  console.error(`Failed to start node --test: ${err.message}`);
  process.exit(1);
});

// Post-suite workspace sweep (Audit H3). Tests that call createWorkspace
// directly can leak ws_* dirs when teardown fails (e.g. tool-006's setup.sh
// locks a subdir, defeating a naive rmSync). Reap any leftovers through the
// permission-recovering destroyWorkspace so the test runner never accretes
// workspaces across runs.
async function sweepLeakedWorkspaces() {
  const runsDir = process.env.CRUCIBULUM_RUNS_DIR ?? join(root, "runs");
  if (!existsSync(runsDir)) return;
  let entries = [];
  try { entries = readdirSync(runsDir).filter((n) => n.startsWith("ws_")); } catch { return; }
  if (entries.length === 0) return;
  try {
    const { destroyWorkspace } = await import(join(testsDir, "..", "core", "workspace.js"));
    for (const entry of entries) destroyWorkspace(join(runsDir, entry));
    console.error(`[test] swept ${entries.length} leftover workspace(s) from ${runsDir}`);
  } catch (err) {
    console.error(`[test] workspace sweep skipped: ${err?.message ?? err}`);
  }
}

child.on("exit", (code, signal) => {
  void sweepLeakedWorkspaces().finally(() => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 1);
  });
});
