/**
 * Crucible — Flake Detection / Retry Support
 * Wraps runTask with configurable retry logic for benchmark reliability.
 */

import { runTask as defaultRunTask, type RunOptions, type RunResult } from "./runner.js";
import { log } from "../utils/logger.js";

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
export async function runTaskWithRetries(options: FlakeRunOptions): Promise<{ result: RunResult; flake: FlakeResult }> {
  const maxAttempts = Math.max(1, options.retry_count ?? 1);
  const runTask: RunTaskFn = options._runTask ?? defaultRunTask;
  const attempts: FlakeAttempt[] = [];
  let firstResult: RunResult | null = null;

  for (let i = 0; i < maxAttempts; i++) {
    log("info", "runner:flake", `Attempt ${i + 1}/${maxAttempts} for ${options.taskId}`);

    const result = await runTask({
      ...options,
      keepWorkspace: i < maxAttempts - 1 ? false : options.keepWorkspace,
    });

    const attemptRecord: FlakeAttempt = {
      run_number: i + 1,
      passed: result.passed,
      score: result.score,
      exitCode: result.exitCode,
      bundle_id: result.bundle.bundle_id,
      duration_ms: 0, // duration not directly available in EvidenceBundle
    };
    attempts.push(attemptRecord);

    if (i === 0) {
      firstResult = result;
    }

    if (i < maxAttempts - 1) {
      log("info", "runner:flake", `Attempt ${i + 1} complete: ${result.passed ? "PASS" : "FAIL"} — next attempt`);
    }
  }

  const first = firstResult!;
  const passCount = attempts.filter(a => a.passed).length;
  const failCount = attempts.filter(a => !a.passed).length;
  const passRate = passCount / attempts.length;
  const isFlaky = passCount > 0 && failCount > 0;

  let outcome: FlakeResult["outcome"];
  if (passCount === attempts.length) outcome = "stable_pass";
  else if (failCount === attempts.length) outcome = "stable_fail";
  else if (passCount > failCount) outcome = "flaky_pass";
  else outcome = "flaky_fail";

  const aggregatePassed = passRate >= 0.5;
  const avgScore = attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length;

  const flake: FlakeResult = {
    attempts,
    total_attempts: attempts.length,
    pass_count: passCount,
    fail_count: failCount,
    pass_rate: Math.round(passRate * 100) / 100,
    is_flaky: isFlaky,
    outcome,
    first_run: {
      passed: first.passed,
      score: first.score,
      exitCode: first.exitCode,
      bundle_id: first.bundle.bundle_id,
    },
    aggregate: {
      passed: aggregatePassed,
      score: Math.round(avgScore * 10000) / 10000,
      differs_from_first: aggregatePassed !== first.passed,
    },
  };

  log("info", "runner:flake", `Flake result: ${outcome} (${passCount}/${attempts.length} passed, rate=${flake.pass_rate})`);

  return { result: first, flake };
}
