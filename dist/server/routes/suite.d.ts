/**
 * Crucible — Suite Routes
 * Suite execution with flake detection and status.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export interface SuiteTaskResult {
    task_id: string;
    bundle_id: string;
    score: number;
    pass: boolean;
    duration_sec: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    error?: string | undefined;
    attempts?: number | undefined;
    pass_count?: number | undefined;
    fail_count?: number | undefined;
    pass_rate?: number | undefined;
    is_flaky?: boolean | undefined;
    outcome?: "stable_pass" | "stable_fail" | "flaky_pass" | "flaky_fail" | undefined;
    confidence?: "high" | "medium" | "low" | undefined;
    first_run_result?: {
        passed: boolean;
        score: number;
        bundle_id: string;
    } | undefined;
    aggregate_result?: {
        passed: boolean;
        score: number;
    } | undefined;
}
export interface SuiteFlakeSummary {
    stable_passes: number;
    stable_fails: number;
    flaky_passes: number;
    flaky_fails: number;
    average_pass_rate: number;
    overall_outcome: "stable_pass" | "stable_fail" | "mixed" | "flaky_mixed";
    percentage_stable: number;
    percentage_flaky: number;
}
export interface ActiveSuiteRun {
    id: string;
    status: "running" | "complete" | "error";
    total: number;
    completed: number;
    results: SuiteTaskResult[];
    summary: {
        total: number;
        passed: number;
        failed: number;
        pass_rate: number;
        avg_score: number;
        total_time_sec: number;
        total_tokens: number;
        total_cost_usd: number;
        flake_summary?: SuiteFlakeSummary | undefined;
        confidence?: "high" | "medium" | "low" | undefined;
    } | null;
    error?: string | undefined;
}
export declare const activeSuiteRuns: Map<string, ActiveSuiteRun>;
export declare function handleRunSuitePost(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleRunSuiteStatus(_req: IncomingMessage, res: ServerResponse, path: string): Promise<void>;
//# sourceMappingURL=suite.d.ts.map