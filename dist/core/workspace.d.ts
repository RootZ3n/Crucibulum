/**
 * Crucible — Workspace Manager
 * Git-based isolation. Clone task repo, reset between runs, snapshot state.
 */
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
export declare function createWorkspace(taskRepoPath: string, taskId: string): WorkspaceInfo;
/**
 * Reset workspace to initial commit state.
 */
export declare function resetWorkspace(wsPath: string): void;
/**
 * Clean up workspace directory entirely.
 */
export declare function destroyWorkspace(wsPath: string): void;
/**
 * Snapshot current workspace state by committing all changes.
 * Returns the new commit hash.
 */
export declare function snapshotWorkspace(wsPath: string, message: string): string;
//# sourceMappingURL=workspace.d.ts.map