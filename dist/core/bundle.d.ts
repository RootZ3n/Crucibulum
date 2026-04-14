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
    suiteId?: string | undefined;
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
 *
 * The stored bundle contains a `trust.bundle_verified` field that is set to
 * `true` at build time — that flag alone is worthless, because anyone who
 * edits the JSON on disk can flip it. Use this function (or
 * `loadVerifiedBundle`) on every read from disk and trust the result, not
 * the flag already inside the file.
 */
export declare function verifyBundle(bundle: EvidenceBundle): {
    valid: boolean;
    expected: string;
    computed: string;
};
/**
 * Parse a bundle JSON string, re-verify its hash, and normalize its trust state
 * to reflect reality. Returns `null` if the payload is not a valid bundle
 * object. A bundle that fails verification is still returned so operators can
 * inspect it — but `trust.bundle_verified` is forced to `false` so downstream
 * consumers cannot be misled.
 */
export declare function loadVerifiedBundle(raw: string, sourceLabel?: string): EvidenceBundle | null;
//# sourceMappingURL=bundle.d.ts.map