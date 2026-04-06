/**
 * Crucibulum — Evidence Bundle Builder
 * Builds, signs (SHA256), and stores immutable evidence bundles.
 */
import type { TaskManifest, Oracle, ExecutionResult, EvidenceBundle, DiffEntry } from "../adapters/base.js";
import type { JudgeResult } from "./judge.js";
import type { CrucibulumAdapter } from "../adapters/base.js";
import type { WorkspaceInfo } from "./workspace.js";
export interface BundleBuildInput {
    manifest: TaskManifest;
    oracle: Oracle;
    executionResult: ExecutionResult;
    diff: {
        files_changed: DiffEntry[];
        files_created: string[];
        files_deleted: string[];
        forbidden_paths_touched: string[];
    };
    judgeResult: JudgeResult;
    security: {
        injection_scan: "clean" | "detected";
        forbidden_paths_violations: number;
        anti_cheat_violations: number;
        workspace_escape_attempts: number;
    };
    startTime: string;
    endTime: string;
    workspace: WorkspaceInfo;
    adapter: CrucibulumAdapter;
    model: string;
}
export declare function buildBundle(input: BundleBuildInput): EvidenceBundle;
/**
 * Store evidence bundle to disk.
 */
export declare function storeBundle(bundle: EvidenceBundle): string;
/**
 * Verify a stored bundle's integrity by recomputing its hash.
 */
export declare function verifyBundle(bundle: EvidenceBundle): {
    valid: boolean;
    expected: string;
    computed: string;
};
//# sourceMappingURL=bundle.d.ts.map