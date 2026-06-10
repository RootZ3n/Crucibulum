/**
 * Luak — Workspace Manager
 * Git-based isolation. Clone task repo, reset between runs, snapshot state.
 */

import { execSync, execFileSync } from "node:child_process";
import { mkdirSync, existsSync, rmSync, cpSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
 * Clean up workspace directory entirely.
 */
export function destroyWorkspace(wsPath: string): void {
  try {
    rmSync(wsPath, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

/**
 * Snapshot current workspace state by committing all changes.
 * Returns the new commit hash.
 */
export function snapshotWorkspace(wsPath: string, message: string): string {
  try {
    execSync("git add -A", { cwd: wsPath, stdio: "pipe" });
    execSync(`git commit -m "${message.replace(/"/g, '\\"')}" --allow-empty`, {
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
    return execSync("git rev-parse HEAD", { cwd: wsPath, encoding: "utf-8" }).trim();
  } catch {
    return "snapshot-failed";
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

function snapshotFiles(dir: string, prefix: string = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === BASELINE_FILE) {
      continue;
    }
    const abs = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(out, snapshotFiles(abs, rel));
    } else if (entry.isFile()) {
      out[rel] = readFileSync(abs, "utf-8");
    }
  }
  return out;
}
