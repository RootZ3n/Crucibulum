/**
 * Crucibulum — Flake Detection / Retry Support
 * Wraps runTask with configurable retry logic for benchmark reliability.
 */
import { runTask } from "./runner.js";
import { log } from "../utils/logger.js";
/**
 * Run a task with retry/flake detection.
 * Always preserves the first-run result. Retries are for statistical confidence.
 */
export async function runTaskWithRetries(options) {
    const maxAttempts = Math.max(1, options.retry_count ?? 1);
    const attempts = [];
    let firstResult = null;
    for (let i = 0; i < maxAttempts; i++) {
        log("info", "runner:flake", `Attempt ${i + 1}/${maxAttempts} for ${options.taskId}`);
        const result = await runTask({
            ...options,
            keepWorkspace: i < maxAttempts - 1 ? false : options.keepWorkspace,
        });
        const attemptRecord = {
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
    const first = firstResult;
    const passCount = attempts.filter(a => a.passed).length;
    const failCount = attempts.filter(a => !a.passed).length;
    const passRate = passCount / attempts.length;
    const isFlaky = passCount > 0 && failCount > 0;
    let outcome;
    if (passCount === attempts.length)
        outcome = "stable_pass";
    else if (failCount === attempts.length)
        outcome = "stable_fail";
    else if (passCount > failCount)
        outcome = "flaky_pass";
    else
        outcome = "flaky_fail";
    const aggregatePassed = passRate >= 0.5;
    const avgScore = attempts.reduce((sum, a) => sum + a.score, 0) / attempts.length;
    const flake = {
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
//# sourceMappingURL=flake.js.map