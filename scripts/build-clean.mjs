import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

await rm(resolve(root, "dist"), { recursive: true, force: true });

const tsc = resolve(root, "node_modules", ".bin", "tsc");
const child = spawn(tsc, [], {
  cwd: root,
  stdio: "inherit",
  shell: false,
});

child.on("error", (err) => {
  console.error(`Failed to start build: ${err.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
