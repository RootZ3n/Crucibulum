/**
 * Crucible — release audit wrapper.
 *
 * Runs `npm audit --json --audit-level=moderate` with retries to handle
 * transient npm registry failures (the deprecated quick advisory endpoint
 * returns 400 "Invalid package tree" under load or rate-limiting).
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

function runAudit() {
  return new Promise((resolveRun, rejectRun) => {
    const chunks = [];
    const child = spawn(npm, ["audit", "--json", "--audit-level=moderate"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    child.stdout.on("data", (d) => chunks.push(d));
    child.on("error", rejectRun);
    child.on("close", (code) => {
      const raw = Buffer.concat(chunks).toString("utf-8").trim();
      try {
        const report = JSON.parse(raw);
        const total = report?.metadata?.vulnerabilities?.total ?? 0;
        const moderate = (report?.metadata?.vulnerabilities?.moderate ?? 0)
          + (report?.metadata?.vulnerabilities?.high ?? 0)
          + (report?.metadata?.vulnerabilities?.critical ?? 0);
        if (moderate > 0) {
          console.error(`npm audit found ${moderate} moderate+ vulnerabilities`);
          rejectRun(new Error("audit failed"));
        } else {
          resolveRun(total);
        }
      } catch {
        // JSON parse failure means the audit endpoint returned an error
        rejectRun(new Error(raw.slice(0, 200) || `audit exited with ${code}`));
      }
    });
  });
}

let lastErr;
for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    const total = await runAudit();
    console.log(`found ${total} vulnerabilities`);
    process.exit(0);
  } catch (err) {
    lastErr = err;
    if (attempt < MAX_RETRIES) {
      console.error(`Audit attempt ${attempt} failed, retrying in ${RETRY_DELAY_MS}ms...`);
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
}
console.error(`Audit failed after ${MAX_RETRIES} attempts: ${lastErr?.message ?? lastErr}`);
process.exit(1);
