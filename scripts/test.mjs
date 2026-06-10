import { readdirSync } from "node:fs";
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

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
