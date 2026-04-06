/**
 * Crucibulum — Manifest Loader
 * Loads full manifest for judge, filters for agent-visible version.
 */
import type { TaskManifest, AgentVisibleManifest } from "../adapters/base.js";
/**
 * Load a task manifest by task ID.
 * Looks in tasks/{family}/{taskId}/manifest.json
 */
export declare function loadManifest(taskId: string): TaskManifest;
/**
 * Resolve the repo path for a manifest.
 */
export declare function resolveRepoPath(manifest: TaskManifest): string;
/**
 * Filter manifest to agent-visible version.
 * Strips: oracle_ref, scoring, metadata, forbidden_paths, max_file_edits, max_files_read
 */
export declare function filterForAgent(manifest: TaskManifest): AgentVisibleManifest;
/**
 * List all available task IDs.
 */
export declare function listTasks(family?: string): Array<{
    id: string;
    family: string;
    title: string;
    difficulty: string;
}>;
/**
 * Compute manifest hash for evidence bundle.
 */
export declare function hashManifest(manifest: TaskManifest): string;
//# sourceMappingURL=manifest.d.ts.map