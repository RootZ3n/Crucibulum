/**
 * Crucible — Judge
 * Scores based on observable state transitions. Never trusts narration.
 * Scoring order: Integrity → Correctness → Regression → Efficiency
 */
import type { Oracle, TaskManifest, ExecutionResult, VerificationResults } from "../adapters/base.js";
export declare const DETERMINISTIC_JUDGE_METADATA: {
    kind: "deterministic";
    label: string;
    description: string;
    verifier_model: null;
    components: string[];
};
interface DiffData {
    files_changed: Array<{
        path: string;
        lines_added: number;
        lines_removed: number;
        patch: string;
    }>;
    files_created: string[];
    files_deleted: string[];
    forbidden_paths_touched: string[];
}
export interface JudgeResult {
    verification: VerificationResults;
    diagnosis: {
        localized_correctly: boolean;
        avoided_decoys: boolean;
        first_fix_correct: boolean;
        self_verified: boolean;
        failure_mode: string | null;
    };
}
export declare function judge(manifest: TaskManifest, oracle: Oracle, diff: DiffData, execution: ExecutionResult, workspacePath: string): JudgeResult;
export {};
//# sourceMappingURL=judge.d.ts.map