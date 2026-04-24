/**
 * Crucible — Workspace Cleanup
 * Conservative cleanup of stale run workspaces and artifacts.
 */
export interface CleanupOptions {
    /** Maximum age in milliseconds before a workspace/artifact is considered stale. Default: 7 days */
    maxAgeMs?: number | undefined;
    /** If true, only report what would be deleted without actually deleting (dry run) */
    dryRun?: boolean | undefined;
    /** If true, keep workspaces with 'ws_' prefix (they may be in use) */
    keepWorkspaces?: boolean | undefined;
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
    skipped_items: Array<{
        name: string;
        reason: string;
    }>;
    /** Errors encountered during cleanup */
    errors: string[];
}
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
export declare function cleanupStaleArtifacts(options?: CleanupOptions): CleanupResult;
/**
 * Get cleanup stats without deleting anything.
 */
export declare function getCleanupStats(options?: {
    maxAgeMs?: number;
}): CleanupResult;
//# sourceMappingURL=cleanup.d.ts.map