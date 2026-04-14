/**
 * Crucibulum — Flake Detection Tests
 * Tests for retry/flake detection logic.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runTaskWithRetries, type FlakeResult } from "../core/flake.js";
import type { RunResult } from "../core/runner.js";

// Mock the runner module
vi.mock("../core/runner.js", () => ({
  runTask: vi.fn(),
}));

import { runTask } from "../core/runner.js";
const mockRunTask = vi.mocked(runTask);

function makeMockResult(passed: boolean, runNumber: number): RunResult {
  return {
    bundle: {
      bundle_id: `run_test_${runNumber}`,
      bundle_hash: "sha256:abc",
      bundle_version: "1.0.0",
      task: { id: "test-001", manifest_hash: "abc", family: "poison_localization", difficulty: "easy" },
      agent: { adapter: "test", adapter_version: "1.0", system: "test", system_version: "1.0", model: "test:model", model_version: "latest" },
      environment: { crucibulum_version: "1.0.0", node_version: "20", platform: "linux", arch: "x64", started_at: "", completed_at: "" },
      execution: { exit_reason: "complete", duration_ms: 1000, steps_used: 3, files_read: [], files_written: [], timeline: [], adapter_metadata: { adapter_id: "test", adapter_version: "1.0", system_version: "1.0", model: "test:model", provider: "test" } },
      diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
      security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
      verification: {
        correctness: { score: passed ? 1 : 0, details: { "test-check": passed ? "pass" : "fail" } },
        regression: { score: 1, details: {} },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 300, steps_used: 3, steps_limit: 10, score: 0.9 },
      },
      score: {
        scale: "fraction_0_1",
        total: passed ? 0.9 : 0.1,
        total_percent: passed ? 90 : 10,
        breakdown: { correctness: passed ? 1 : 0, regression: 1, integrity: 1, efficiency: 0.9 },
        breakdown_percent: { correctness: passed ? 100 : 0, regression: 100, integrity: 100, efficiency: 90 },
        pass: passed,
        pass_threshold: 0.6,
        pass_threshold_percent: 60,
        integrity_violations: 0,
      },
      usage: { tokens_in: 100, tokens_out: 50, estimated_cost_usd: 0.001, provider_cost_note: "" },
      judge: { kind: "deterministic", label: "test", description: "test", verifier_model: null, components: [] },
      trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: null },
      integrations: { veritor: { contract_version: "1.0.0", consumable: true }, paedagogus: { contract_version: "1.0.0", consumable: true, routing_signals: { task_family: "poison_localization", difficulty: "easy", provider: "test", adapter: "test", score: 0, pass: false, failure_mode: null } }, crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: 0, divergence_note: null } },
      review: { authority: "advisory", deterministic_result_authoritative: true, security: { review_input_scanned: false, review_input_sanitized: false, injection_flags_count: 0, flagged_sources: [], flagged_artifacts: [], review_blocked_reason: null, review_output_invalid: false, trust_boundary_violations: [] }, secondOpinion: { enabled: false, status: "skipped", summary: "", flags: [], confidence: "low", recommendation: null, disagreement: false }, qcReview: { enabled: false, status: "skipped", summary: "", flags: [], confidence: "low", recommendation: null, disagreement: false } },
    },
    passed,
    score: passed ? 0.9 : 0.1,
    exitCode: passed ? 0 : 1,
  };
}

describe("runTaskWithRetries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stable_pass: passes on first try, all attempts pass", async () => {
    mockRunTask.mockResolvedValue(makeMockResult(true, 1));

    const { flake } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      retry_count: 3,
    });

    expect(flake.outcome).toBe("stable_pass");
    expect(flake.is_flaky).toBe(false);
    expect(flake.pass_count).toBe(3);
    expect(flake.fail_count).toBe(0);
    expect(flake.pass_rate).toBe(1);
    expect(flake.first_run.passed).toBe(true);
    expect(flake.aggregate.passed).toBe(true);
    expect(flake.aggregate.differs_from_first).toBe(false);
  });

  it("stable_fail: fails all attempts", async () => {
    mockRunTask.mockResolvedValue(makeMockResult(false, 1));

    const { flake } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      retry_count: 3,
    });

    expect(flake.outcome).toBe("stable_fail");
    expect(flake.is_flaky).toBe(false);
    expect(flake.pass_count).toBe(0);
    expect(flake.fail_count).toBe(3);
    expect(flake.pass_rate).toBe(0);
    expect(flake.first_run.passed).toBe(false);
    expect(flake.aggregate.passed).toBe(false);
  });

  it("flaky_pass: passes overall but has failures", async () => {
    // Pass, Fail, Pass
    mockRunTask
      .mockResolvedValueOnce(makeMockResult(true, 1))
      .mockResolvedValueOnce(makeMockResult(false, 2))
      .mockResolvedValueOnce(makeMockResult(true, 3));

    const { flake } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      retry_count: 3,
    });

    expect(flake.outcome).toBe("flaky_pass");
    expect(flake.is_flaky).toBe(true);
    expect(flake.pass_count).toBe(2);
    expect(flake.fail_count).toBe(1);
    expect(flake.pass_rate).toBeCloseTo(0.67, 1);
    expect(flake.first_run.passed).toBe(true);
    expect(flake.aggregate.passed).toBe(true); // Majority pass
    expect(flake.aggregate.differs_from_first).toBe(false);
  });

  it("flaky_fail: fails overall but has passes", async () => {
    // Fail, Pass, Fail
    mockRunTask
      .mockResolvedValueOnce(makeMockResult(false, 1))
      .mockResolvedValueOnce(makeMockResult(true, 2))
      .mockResolvedValueOnce(makeMockResult(false, 3));

    const { flake } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      retry_count: 3,
    });

    expect(flake.outcome).toBe("flaky_fail");
    expect(flake.is_flaky).toBe(true);
    expect(flake.pass_count).toBe(1);
    expect(flake.fail_count).toBe(2);
    expect(flake.pass_rate).toBeCloseTo(0.33, 1);
    expect(flake.first_run.passed).toBe(false);
    expect(flake.aggregate.passed).toBe(false); // Minority pass
    expect(flake.aggregate.differs_from_first).toBe(false);
  });

  it("single attempt (no retry) works correctly", async () => {
    mockRunTask.mockResolvedValue(makeMockResult(true, 1));

    const { flake } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      // No retry_count specified — defaults to 1
    });

    expect(flake.total_attempts).toBe(1);
    expect(flake.outcome).toBe("stable_pass");
    expect(flake.is_flaky).toBe(false);
    expect(flake.pass_count).toBe(1);
    expect(flake.fail_count).toBe(0);
  });

  it("preserves first-run result even when aggregate differs", async () => {
    // First fails, then passes (2/3)
    mockRunTask
      .mockResolvedValueOnce(makeMockResult(false, 1))
      .mockResolvedValueOnce(makeMockResult(true, 2))
      .mockResolvedValueOnce(makeMockResult(true, 3));

    const { flake, result } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      retry_count: 3,
    });

    // First run was a fail
    expect(flake.first_run.passed).toBe(false);
    expect(flake.first_run.bundle_id).toBe("run_test_1");
    // But aggregate is a pass (majority)
    expect(flake.aggregate.passed).toBe(true);
    expect(flake.aggregate.differs_from_first).toBe(true);
    // The returned RunResult is the first run
    expect(result.passed).toBe(false);
    expect(result.bundle.bundle_id).toBe("run_test_1");
  });

  it("attempts are numbered correctly", async () => {
    mockRunTask.mockResolvedValue(makeMockResult(true, 1));

    const { flake } = await runTaskWithRetries({
      taskId: "test-001",
      adapter: {} as any,
      model: "test:model",
      retry_count: 4,
    });

    expect(flake.attempts.map(a => a.run_number)).toEqual([1, 2, 3, 4]);
  });
});
