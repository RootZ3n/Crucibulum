import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  ["typecheck", ["run", "typecheck"]],
  ["test", ["test"]],
  ["build", ["run", "build"]],
  ["oracle hash check", ["run", "oracle:hash", "--", "--check"]],
  ["smoke", ["run", "smoke"]],
];

function run(label, args) {
  return new Promise((resolveRun, rejectRun) => {
    console.log(`\n=== ${label} ===`);
    console.log(`> npm ${args.join(" ")}`);
    const child = spawn(npm, args, {
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
  for (const [label, args] of steps) {
    await run(label, args);
  }
  console.log("\nRelease verification passed.");
} catch (err) {
  console.error(`\nRelease verification failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

