/**
 * Crucibulum — Workspace Cleanup
 * Conservative cleanup of stale run workspaces and artifacts.
 */
import { readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";
const RUNS_DIR = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
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
export function cleanupStaleArtifacts(options = {}) {
    const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    const dryRun = options.dryRun ?? false;
    const keepWorkspaces = options.keepWorkspaces ?? true;
    const now = Date.now();
    const result = {
        scanned: 0,
        deleted: 0,
        skipped: 0,
        deleted_items: [],
        skipped_items: [],
        errors: [],
    };
    if (!existsSync(RUNS_DIR)) {
        log("info", "cleanup", `Runs directory does not exist: ${RUNS_DIR}`);
        return result;
    }
    let entries;
    try {
        entries = readdirSync(RUNS_DIR);
    }
    catch (err) {
        result.errors.push(`Failed to read runs directory: ${String(err)}`);
        return result;
    }
    for (const entry of entries) {
        const fullPath = join(RUNS_DIR, entry);
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
                }
                else if (dryRun) {
                    result.skipped++;
                    result.skipped_items.push({ name: entry, reason: "dry run" });
                }
                else {
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
                }
                else {
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
        }
        catch (err) {
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
export function getCleanupStats(options = {}) {
    return cleanupStaleArtifacts({ ...options, dryRun: true });
}
//# sourceMappingURL=cleanup.js.map