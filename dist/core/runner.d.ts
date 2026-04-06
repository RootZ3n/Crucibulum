/**
 * Crucibulum — Runner
 * Orchestrates the full evaluation lifecycle.
 * Load → Workspace → Security → Execute → Judge → Bundle
 */
import type { CrucibulumAdapter, EvidenceBundle } from "../adapters/base.js";
export interface RunOptions {
    taskId: string;
    adapter: CrucibulumAdapter;
    model: string;
    runs?: number | undefined;
    keepWorkspace?: boolean | undefined;
}
export interface RunResult {
    bundle: EvidenceBundle;
    passed: boolean;
    score: number;
    exitCode: number;
}
export declare function runTask(options: RunOptions): Promise<RunResult>;
//# sourceMappingURL=runner.d.ts.map