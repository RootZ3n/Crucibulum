/**
 * Crucible — Flake Detection / Retry Support
 * Wraps runTask with configurable retry logic for benchmark reliability.
 */
import { type RunOptions, type RunResult } from "./runner.js";
/**
 * Test-only injection point for `runTask`. Production callers never set
 * this — they go through the imported `runTask` directly, so behaviour is
 * unchanged. The unit tests for flake-detection use this to feed canned
 * RunResult fixtures without booting a real adapter / workspace.
 *
 * Kept as a function-level parameter rather than a module-level mutable
 * binding so concurrent tests can't race each other's mocks.
 */
type RunTaskFn = (options: RunOptions) => Promise<RunResult>;
export interface FlakeAttempt {
    run_number: number;
    passed: boolean;
    score: number;
    exitCode: number;
    bundle_id: string;
    duration_ms: number;
}
export interface FlakeResult {
    /** Individual attempt results */
    attempts: FlakeAttempt[];
    /** Total number of attempts made */
    total_attempts: number;
    /** Number of attempts that passed */
    pass_count: number;
    /** Number of attempts that failed */
    fail_count: number;
    /** Pass rate as a fraction (0-1) */
    pass_rate: number;
    /** Whether the outcome is flaky (mixed pass/fail across attempts) */
    is_flaky: boolean;
    /**
     * Stable classification:
     * - "stable_pass": passed all attempts
     * - "stable_fail": failed all attempts
     * - "flaky_pass": passed overall but failed at least once
     * - "flaky_fail": failed overall but passed at least once
     */
    outcome: "stable_pass" | "stable_fail" | "flaky_pass" | "flaky_fail";
    /** The first-run result (always preserved) */
    first_run: {
        passed: boolean;
        score: number;
        exitCode: number;
        bundle_id: string;
    };
    /** The aggregate/canonical result */
    aggregate: {
        passed: boolean;
        score: number;
        /** Whether the aggregate result differs from first-run */
        differs_from_first: boolean;
    };
}
export interface FlakeRunOptions extends RunOptions {
    /** Number of attempts for flake detection. Default: 1 (no retry). Set to 3 for flake detection. */
    retry_count?: number | undefined;
    /**
     * Internal: override the runTask implementation used per attempt. Tests use
     * this; production callers should leave it undefined and the real runTask
     * is used.
     */
    _runTask?: RunTaskFn | undefined;
}
/**
 * Run a task with retry/flake detection.
 * Always preserves the first-run result. Retries are for statistical confidence.
 */
export declare function runTaskWithRetries(options: FlakeRunOptions): Promise<{
    result: RunResult;
    flake: FlakeResult;
}>;
export {};
//# sourceMappingURL=flake.d.ts.map