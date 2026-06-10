/**
 * Luak — Workspace Cleanup
 * Conservative cleanup of stale run workspaces and artifacts.
 */

import { readdirSync, statSync, rmSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";
import { luakStateRoot } from "../utils/env.js";

// Evaluate per call so tests can inject CRUCIBULUM_RUNS_DIR via env or
// pass `runsDir` directly. The previous module-load constant captured
// process.cwd()/runs once, which made the test against the real
// production runs/ directory non-deterministic (parallel writes from
// other tests would change the file count between two consecutive
// scans — that was the "respects maxAgeMs" flake's root cause).
function resolveRunsDir(override?: string): string {
  if (override) return override;
  return process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
}

export interface CleanupOptions {
  /** Maximum age in milliseconds before a workspace/artifact is considered stale. Default: 7 days */
  maxAgeMs?: number | undefined;
  /** If true, only report what would be deleted without actually deleting (dry run) */
  dryRun?: boolean | undefined;
  /** If true, keep workspaces with 'ws_' prefix (they may be in use) */
  keepWorkspaces?: boolean | undefined;
  /** Override the runs directory (test fixtures, alternate workspaces). Defaults to env CRUCIBULUM_RUNS_DIR or ./runs. */
  runsDir?: string | undefined;
}

export interface CleanupResult {
  /** Number of items scanned */
  scanned: number;
  /** Number of items deleted */
  deleted: number;
  /** Number of items skipped (not stale or protected) */
  skipped: number;
  /** List of deleted item names */
  deleted_items: string[];
  /** List of skipped item names with reasons */
  skipped_items: Array<{ name: string; reason: string }>;
  /** Errors encountered during cleanup */
  errors: string[];
}

const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Clean up stale run artifacts and workspaces.
 *
 * Safety rules:
 * - Never deletes .git directories
 * - Skips files that aren't .json or don't start with expected prefixes
 * - Workspaces (ws_*) are kept by default
 * - Only deletes bundles (.json) and workspace directories (ws_*)
 * - Respects dryRun mode
 */
export function cleanupStaleArtifacts(options: CleanupOptions = {}): CleanupResult {
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const dryRun = options.dryRun ?? false;
  // Default to reaping stale workspaces. Keeping them by default meant a
  // SIGKILL/OOM mid-run leaked the workspace dir forever (the runner's
  // destroyWorkspace finally-block never ran). Stale here still means older
  // than maxAgeMs, so an in-flight workspace is never touched. (Audit M6.)
  const keepWorkspaces = options.keepWorkspaces ?? false;
  const runsDir = resolveRunsDir(options.runsDir);
  const now = Date.now();

  const result: CleanupResult = {
    scanned: 0,
    deleted: 0,
    skipped: 0,
    deleted_items: [],
    skipped_items: [],
    errors: [],
  };

  if (!existsSync(runsDir)) {
    log("info", "cleanup", `Runs directory does not exist: ${runsDir}`);
    return result;
  }

  let entries: string[];
  try {
    entries = readdirSync(runsDir);
  } catch (err) {
    result.errors.push(`Failed to read runs directory: ${String(err)}`);
    return result;
  }

  for (const entry of entries) {
    const fullPath = join(runsDir, entry);
    result.scanned++;

    try {
      const stat = statSync(fullPath);
      const ageMs = now - stat.mtimeMs;
      const isStale = ageMs > maxAgeMs;

      // Skip non-stale items
      if (!isStale) {
        result.skipped++;
        result.skipped_items.push({ name: entry, reason: "not stale" });
        continue;
      }

      // Handle workspace directories (ws_*)
      if (entry.startsWith("ws_")) {
        if (!stat.isDirectory()) {
          result.skipped++;
          result.skipped_items.push({ name: entry, reason: "ws_ prefix but not directory" });
          continue;
        }
        if (keepWorkspaces) {
          result.skipped++;
          result.skipped_items.push({ name: entry, reason: "workspace protected" });
        } else if (dryRun) {
          result.skipped++;
          result.skipped_items.push({ name: entry, reason: "dry run" });
        } else {
          rmSync(fullPath, { recursive: true, force: true });
          result.deleted++;
          result.deleted_items.push(entry);
          log("debug", "cleanup", `Deleted stale workspace: ${entry}`);
        }
        continue;
      }

      // Handle bundle JSON files (run_*.json)
      if (entry.endsWith(".json") && entry.startsWith("run_")) {
        if (dryRun) {
          result.skipped++;
          result.skipped_items.push({ name: entry, reason: "dry run" });
        } else {
          rmSync(fullPath, { force: true });
          result.deleted++;
          result.deleted_items.push(entry);
          log("debug", "cleanup", `Deleted stale bundle: ${entry}`);
        }
        continue;
      }

      // Skip everything else
      result.skipped++;
      result.skipped_items.push({ name: entry, reason: "not a recognized artifact" });
    } catch (err) {
      result.errors.push(`Error processing ${entry}: ${String(err)}`);
    }
  }

  if (result.deleted > 0 || dryRun) {
    log("info", "cleanup", `Cleanup complete: ${result.deleted} deleted, ${result.skipped} skipped, ${result.scanned} scanned (dry=${dryRun})`);
  }

  return result;
}

export interface ReaperResult {
  /** ws_* directories examined this cycle */
  checked: number;
  /** stale ws_* directories removed */
  deleted: number;
  /** ws_* directories kept (not yet stale) */
  kept: number;
  errors: string[];
}

export interface ReaperStatus {
  /** Epoch ms of the last reaper cycle, or null if it has never run */
  lastRun: number | null;
  lastChecked: number;
  lastDeleted: number;
  lastKept: number;
  lastErrors: string[];
}

// Module-level record of the most recent reaper cycle. Surfaced via
// getReaperStatus() / GET /api/health/reaper so an operator can confirm the
// reaper is actually running (the C2 symptom: 78 stale workspaces survived a
// 3.6-day uptime with an hourly reaper that left no trace it had run).
let lastReaper: ReaperStatus = { lastRun: null, lastChecked: 0, lastDeleted: 0, lastKept: 0, lastErrors: [] };

export function getReaperStatus(): ReaperStatus {
  return { ...lastReaper, lastErrors: [...lastReaper.lastErrors] };
}

/** Touch state/.reaper-last-run so the reaper's liveness is verifiable on disk. */
function touchReaperHeartbeat(runAt: number, stateDir?: string): void {
  try {
    const dir = stateDir ?? luakStateRoot();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, ".reaper-last-run"), `${new Date(runAt).toISOString()}\n`);
  } catch (err) {
    log("warn", "cleanup", `Failed to write reaper heartbeat: ${String(err)}`);
  }
}

/**
 * Reap only stale workspace directories (ws_*), leaving bundles and every
 * other artifact untouched. Used by the server's periodic TTL reaper so a
 * crashed/OOM-killed run doesn't leak its workspace forever, without ever
 * risking deletion of evidence bundles. Default TTL: 1 hour. (Audit M6/C2.)
 *
 * Every cycle: logs a one-line summary at info level (so it's visible in the
 * file log now that C1 persists output), records the result for
 * getReaperStatus(), and touches state/.reaper-last-run.
 */
export function reapStaleWorkspaces(options: { maxAgeMs?: number; runsDir?: string; stateDir?: string } = {}): ReaperResult {
  const maxAgeMs = options.maxAgeMs ?? 60 * 60 * 1000; // 1h
  const runsDir = resolveRunsDir(options.runsDir);
  const now = Date.now();
  const out: ReaperResult = { checked: 0, deleted: 0, kept: 0, errors: [] };
  if (existsSync(runsDir)) {
    let entries: string[];
    try {
      entries = readdirSync(runsDir);
      for (const entry of entries) {
        if (!entry.startsWith("ws_")) continue;
        const fullPath = join(runsDir, entry);
        try {
          const stat = statSync(fullPath);
          if (!stat.isDirectory()) continue;
          out.checked++;
          if (now - stat.mtimeMs <= maxAgeMs) {
            out.kept++;
            continue;
          }
          rmSync(fullPath, { recursive: true, force: true });
          out.deleted++;
          log("debug", "cleanup", `Reaped stale workspace: ${entry}`);
        } catch (err) {
          out.errors.push(`Error reaping ${entry}: ${String(err)}`);
        }
      }
    } catch (err) {
      out.errors.push(String(err));
    }
  }

  // Always emit a heartbeat + status, even on a no-op cycle, so silence is
  // never ambiguous between "reaper not running" and "nothing to do".
  lastReaper = {
    lastRun: now,
    lastChecked: out.checked,
    lastDeleted: out.deleted,
    lastKept: out.kept,
    lastErrors: [...out.errors],
  };
  touchReaperHeartbeat(now, options.stateDir);
  log("info", "cleanup", `Reaper: checked ${out.checked} workspaces, deleted ${out.deleted}, kept ${out.kept}`);
  return out;
}

/**
 * Get cleanup stats without deleting anything.
 */
export function getCleanupStats(options: { maxAgeMs?: number; runsDir?: string } = {}): CleanupResult {
  return cleanupStaleArtifacts({ ...options, dryRun: true });
}
