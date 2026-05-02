import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const tsc = resolve(root, "node_modules", ".bin", "tsc");

const steps = [
  ["typecheck", tsc, ["--noEmit"]],
  ["build:clean", node, [resolve(root, "scripts", "build-clean.mjs")]],
  ["test", node, [resolve(root, "scripts", "test.mjs")]],
  ["build", tsc, []],
  ["oracle hash check", node, [resolve(root, "dist", "cli", "main.js"), "oracle-hash", "--check"]],
  ["smoke", node, [resolve(root, "scripts", "smoke.mjs")]],
];

function run(label, cmd, args) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`\n=== ${label} ===`);
    console.log(`> ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: "inherit",
      shell: false,
    });
    child.on("error", rejectRun);
    child.on("exit", (code, signal) => {
      if (signal) rejectRun(new Error(`${label} terminated by ${signal}`));
      else if (code === 0) resolveRun();
      else rejectRun(new Error(`${label} exited with ${code}`));
    });
  });
}

try {
  for (const [label, cmd, args] of steps) {
    await run(label, cmd, args);
  }
  console.log("\nRelease verification passed.");
} catch (err) {
  console.error(`\nRelease verification failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
