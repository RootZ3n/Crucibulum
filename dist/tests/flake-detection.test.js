/**
 * Crucible — Flake Detection Tests
 *
 * Stats math for retry/flake aggregation. Originally written against vitest
 * with `vi.mock` to stub the runner; ported to node:test, using the
 * `_runTask` injection on `FlakeRunOptions` so the runner can be supplied
 * directly without module-level mocking. Logic the tests cover (stable_pass,
 * stable_fail, flaky_pass, flaky_fail, first-run preservation, attempt
 * numbering) is unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runTaskWithRetries } from "../core/flake.js";
function makeMockResult(passed, runNumber) {
    // The flake aggregator only reads `passed`, `score`, `exitCode`, and
    // `bundle.bundle_id` off the result, so a partial RunResult cast through
    // unknown is fine — building a full bundle here would be noise.
    const stub = {
        bundle: { bundle_id: `run_test_${runNumber}` },
        passed,
        score: passed ? 0.9 : 0.1,
        exitCode: passed ? 0 : 1,
    };
    return stub;
}
function mockRunner(results) {
    // Emit pre-supplied results in order, repeating the last entry if the
    // caller asked for more attempts than fixtures.
    let cursor = 0;
    return async () => {
        const next = results[Math.min(cursor, results.length - 1)];
        cursor += 1;
        return next;
    };
}
describe("runTaskWithRetries", () => {
    it("stable_pass: passes on first try, all attempts pass", async () => {
        const { flake } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            retry_count: 3,
            _runTask: mockRunner([makeMockResult(true, 1)]),
        });
        assert.equal(flake.outcome, "stable_pass");
        assert.equal(flake.is_flaky, false);
        assert.equal(flake.pass_count, 3);
        assert.equal(flake.fail_count, 0);
        assert.equal(flake.pass_rate, 1);
        assert.equal(flake.first_run.passed, true);
        assert.equal(flake.aggregate.passed, true);
        assert.equal(flake.aggregate.differs_from_first, false);
    });
    it("stable_fail: fails all attempts", async () => {
        const { flake } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            retry_count: 3,
            _runTask: mockRunner([makeMockResult(false, 1)]),
        });
        assert.equal(flake.outcome, "stable_fail");
        assert.equal(flake.is_flaky, false);
        assert.equal(flake.pass_count, 0);
        assert.equal(flake.fail_count, 3);
        assert.equal(flake.pass_rate, 0);
        assert.equal(flake.first_run.passed, false);
        assert.equal(flake.aggregate.passed, false);
    });
    it("flaky_pass: passes overall but has failures", async () => {
        const { flake } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            retry_count: 3,
            _runTask: mockRunner([
                makeMockResult(true, 1),
                makeMockResult(false, 2),
                makeMockResult(true, 3),
            ]),
        });
        assert.equal(flake.outcome, "flaky_pass");
        assert.equal(flake.is_flaky, true);
        assert.equal(flake.pass_count, 2);
        assert.equal(flake.fail_count, 1);
        assert.ok(Math.abs(flake.pass_rate - 0.67) < 0.05, `pass_rate ≈ 0.67, got ${flake.pass_rate}`);
        assert.equal(flake.first_run.passed, true);
        assert.equal(flake.aggregate.passed, true);
        assert.equal(flake.aggregate.differs_from_first, false);
    });
    it("flaky_fail: fails overall but has passes", async () => {
        const { flake } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            retry_count: 3,
            _runTask: mockRunner([
                makeMockResult(false, 1),
                makeMockResult(true, 2),
                makeMockResult(false, 3),
            ]),
        });
        assert.equal(flake.outcome, "flaky_fail");
        assert.equal(flake.is_flaky, true);
        assert.equal(flake.pass_count, 1);
        assert.equal(flake.fail_count, 2);
        assert.ok(Math.abs(flake.pass_rate - 0.33) < 0.05, `pass_rate ≈ 0.33, got ${flake.pass_rate}`);
        assert.equal(flake.first_run.passed, false);
        assert.equal(flake.aggregate.passed, false);
        assert.equal(flake.aggregate.differs_from_first, false);
    });
    it("single attempt (no retry) works correctly", async () => {
        const { flake } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            // retry_count omitted → defaults to 1
            _runTask: mockRunner([makeMockResult(true, 1)]),
        });
        assert.equal(flake.total_attempts, 1);
        assert.equal(flake.outcome, "stable_pass");
        assert.equal(flake.is_flaky, false);
        assert.equal(flake.pass_count, 1);
        assert.equal(flake.fail_count, 0);
    });
    it("preserves first-run result even when aggregate differs", async () => {
        const { flake, result } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            retry_count: 3,
            _runTask: mockRunner([
                makeMockResult(false, 1),
                makeMockResult(true, 2),
                makeMockResult(true, 3),
            ]),
        });
        assert.equal(flake.first_run.passed, false);
        assert.equal(flake.first_run.bundle_id, "run_test_1");
        assert.equal(flake.aggregate.passed, true);
        assert.equal(flake.aggregate.differs_from_first, true);
        assert.equal(result.passed, false);
        assert.equal(result.bundle.bundle_id, "run_test_1");
    });
    it("attempts are numbered correctly", async () => {
        const { flake } = await runTaskWithRetries({
            taskId: "test-001",
            adapter: {},
            model: "test:model",
            retry_count: 4,
            _runTask: mockRunner([makeMockResult(true, 1)]),
        });
        assert.deepEqual(flake.attempts.map((a) => a.run_number), [1, 2, 3, 4]);
    });
});
//# sourceMappingURL=flake-detection.test.js.map