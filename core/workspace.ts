/**
 * Luak — Workspace Manager
 * Git-based isolation. Clone task repo, reset between runs, snapshot state.
 */

import { execSync, execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync, lstatSync, chmodSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../utils/logger.js";

const BASELINE_FILE = ".crucibulum-baseline.json";

export interface WorkspaceInfo {
  path: string;
  taskId: string;
  commit: string;
  created: string;
}

/**
 * Create an isolated workspace by copying the task repo to a temp directory.
 * Initialize git if not already a repo. Commit the initial state.
 */
export function createWorkspace(taskRepoPath: string, taskId: string): WorkspaceInfo {
  const runsDir = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
  const wsId = `ws_${taskId}_${Date.now().toString(36)}_${randomUUID().slice(0, 6)}`;
  const wsPath = join(runsDir, wsId);

  log("info", "workspace", `Creating workspace: ${wsId}`);

  // Copy task repo to workspace
  const absRepo = resolve(taskRepoPath);
  if (!existsSync(absRepo)) {
    throw new Error(`Task repo not found: ${absRepo}`);
  }

  mkdirSync(wsPath, { recursive: true });
  cpSync(absRepo, wsPath, { recursive: true });
  writeBaselineSnapshot(wsPath);

  // Initialize git if not already a repo
  const gitDir = join(wsPath, ".git");
  if (!existsSync(gitDir)) {
    try {
      execSync("git init", { cwd: wsPath, stdio: "pipe" });
      execSync("git add -A", { cwd: wsPath, stdio: "pipe" });
      execSync('git commit -m "crucibulum: initial state" --allow-empty', {
        cwd: wsPath,
        stdio: "pipe",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "crucibulum",
          GIT_AUTHOR_EMAIL: "crucibulum@local",
          GIT_COMMITTER_NAME: "crucibulum",
          GIT_COMMITTER_EMAIL: "crucibulum@local",
        },
      });
    } catch (err) {
      log("warn", "workspace", `Git init unavailable, using baseline snapshot fallback: ${String(err).slice(0, 120)}`);
    }
  }

  // Get current commit
  let commit = "unknown";
  try {
    commit = execSync("git rev-parse HEAD", { cwd: wsPath, encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    /* non-git repo */
  }

  // Run setup script if it exists — OPT-IN ONLY.
  //
  // .crucibulum/setup.sh ships inside an arbitrary task repo, so auto-executing
  // it ran untrusted shell as the service user (with read access to plaintext
  // provider keys in .env). A "benchmark task" was therefore a trojan. The
  // script is still copied into the workspace by cpSync, but it is never run
  // unless the operator explicitly sets LUAK_ALLOW_SETUP_EXEC=true. (Audit C3.)
  const setupScript = join(wsPath, ".crucibulum", "setup.sh");
  if (existsSync(setupScript)) {
    if (process.env["LUAK_ALLOW_SETUP_EXEC"] === "true") {
      log("warn", "workspace", "LUAK_ALLOW_SETUP_EXEC=true — executing task-provided .crucibulum/setup.sh (ARBITRARY untrusted code from the task repo)");
      try {
        // execFileSync (no shell) so the workspace path can't be abused for
        // shell injection even when exec is opted in.
        execFileSync("bash", [setupScript], { cwd: wsPath, stdio: "pipe", timeout: 30_000 });
      } catch (err) {
        log("warn", "workspace", `Setup script failed: ${String(err).slice(0, 200)}`);
      }
    } else {
      log("warn", "workspace", "Task ships .crucibulum/setup.sh but auto-execution is disabled — skipping (copied into workspace, NOT run). Set LUAK_ALLOW_SETUP_EXEC=true to opt in.");
    }
  }

  return { path: wsPath, taskId, commit, created: new Date().toISOString() };
}

/**
 * Reset workspace to initial commit state.
 */
export function resetWorkspace(wsPath: string): void {
  log("info", "workspace", `Resetting workspace: ${wsPath}`);
  try {
    execSync("git checkout -- .", { cwd: wsPath, stdio: "pipe" });
    execSync("git clean -fd", { cwd: wsPath, stdio: "pipe" });
  } catch (err) {
    log("warn", "workspace", `Reset failed: ${String(err).slice(0, 200)}`);
  }
}

/**
 * Restore write/execute permissions across a tree so rmSync can delete it.
 * A task's setup.sh can chmod a directory non-writable (tool-006 does exactly
 * this to make a delete fail), which then blocks rmSync — the directory must
 * be chmod'd before its entries can be listed/removed. (Audit H3.)
 */
function chmodTreeWritable(p: string): void {
  let st;
  try { st = lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return; // never follow / chmod through a symlink
  try { chmodSync(p, 0o700); } catch { /* best effort */ }
  if (st.isDirectory()) {
    let entries: string[] = [];
    try { entries = readdirSync(p); } catch { return; }
    for (const entry of entries) chmodTreeWritable(join(p, entry));
  }
}

/**
 * Clean up workspace directory entirely. Retries once after restoring
 * permissions so a setup.sh that locked a subdir can't leak the workspace
 * forever (the H3 root cause: 78 ws_tool-006-fixture-audit_* dirs survived
 * because rmSync hit EACCES and the error was swallowed). (Audit H3.)
 */
export function destroyWorkspace(wsPath: string): void {
  try {
    rmSync(wsPath, { recursive: true, force: true });
    return;
  } catch {
    /* fall through to permission-recovery retry */
  }
  try {
    chmodTreeWritable(wsPath);
    rmSync(wsPath, { recursive: true, force: true });
  } catch (err) {
    log("warn", "workspace", `Failed to destroy workspace ${wsPath}: ${String(err).slice(0, 160)}`);
  }
}

function writeBaselineSnapshot(root: string): void {
  try {
    const snapshot = snapshotFiles(root);
    writeFileSync(join(root, BASELINE_FILE), JSON.stringify(snapshot), "utf-8");
  } catch (err) {
    log("warn", "workspace", `Failed to write baseline snapshot: ${String(err).slice(0, 120)}`);
  }
}

// Snapshot bounds: an adversarial task repo could otherwise OOM the host with
// one huge file, or disclose out-of-workspace files via a symlink. (Audit H8.)
const SNAPSHOT_MAX_FILE_BYTES = 1024 * 1024;        // 1MB per file
const SNAPSHOT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;  // 50MB total

function snapshotFiles(dir: string, prefix: string = "", root: string = dir, budget: { total: number } = { total: 0 }): Record<string, string> {
  const out: Record<string, string> = {};
  const rootResolved = resolve(root);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === BASELINE_FILE) {
      continue;
    }
    const abs = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    // lstat (not stat) so symlinks are detected and never followed — a link to
    // /etc/passwd or to a dir outside the workspace must not be read/recursed.
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    const absResolved = resolve(abs);
    if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + sep)) continue;
    if (st.isDirectory()) {
      Object.assign(out, snapshotFiles(abs, rel, root, budget));
    } else if (st.isFile()) {
      if (st.size > SNAPSHOT_MAX_FILE_BYTES) {
        log("warn", "workspace", `Skipping oversized file in snapshot (${st.size} bytes > ${SNAPSHOT_MAX_FILE_BYTES}): ${rel}`);
        continue;
      }
      if (budget.total + st.size > SNAPSHOT_MAX_TOTAL_BYTES) {
        log("warn", "workspace", `Snapshot total cap (${SNAPSHOT_MAX_TOTAL_BYTES} bytes) reached; skipping remaining files starting at ${rel}`);
        continue;
      }
      budget.total += st.size;
      out[rel] = readFileSync(abs, "utf-8");
    }
  }
  return out;
}
