/**
 * Luak — Workspace Cleanup
 * Conservative cleanup of stale run workspaces and artifacts.
 */

import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";

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
  const keepWorkspaces = options.keepWorkspaces ?? true;
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

/**
 * Get cleanup stats without deleting anything.
 */
export function getCleanupStats(options: { maxAgeMs?: number; runsDir?: string } = {}): CleanupResult {
  return cleanupStaleArtifacts({ ...options, dryRun: true });
}
