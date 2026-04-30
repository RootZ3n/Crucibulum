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
