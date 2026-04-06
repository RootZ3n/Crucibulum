/**
 * Crucibulum — Runner
 * Orchestrates the full evaluation lifecycle.
 * Load → Workspace → Security → Execute → Judge → Bundle
 */
import type { CrucibulumAdapter, EvidenceBundle } from "../adapters/base.js";
import { type RunReviewConfig } from "./review.js";
export interface RunOptions {
    taskId: string;
    adapter: CrucibulumAdapter;
    model: string;
    runs?: number | undefined;
    keepWorkspace?: boolean | undefined;
    reviewConfig?: RunReviewConfig | undefined;
}
export interface RunResult {
    bundle: EvidenceBundle;
    passed: boolean;
    score: number;
    exitCode: number;
}
export declare function runTask(options: RunOptions): Promise<RunResult>;
//# sourceMappingURL=runner.d.ts.map