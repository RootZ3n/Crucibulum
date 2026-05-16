import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import { classifyBuildEvaluation } from "../core/build-reporting.js";
import type { JudgeCommandResult } from "../core/verdict.js";
import { normalizeVerdict } from "../core/verdict.js";
import { summarizeBundle } from "../server/contracts.js";

function command(overrides: Partial<JudgeCommandResult> = {}): JudgeCommandResult {
  return {
    id: "public",
    scope: "correctness",
    command: "node tests/oracle.test.js",
    status: "pass",
    summary: "command passed",
    exitCode: 0,
    ...overrides,
  };
}

function score(total: number, pass = total >= 0.8): EvidenceBundle["score"] {
  return {
    scale: "fraction_0_1",
    total,
    total_percent: Math.round(total * 100),
    breakdown: { correctness: total, regression: total > 0 ? 1 : 0, integrity: 1, efficiency: 1 },
    breakdown_percent: { correctness: Math.round(total * 100), regression: total > 0 ? 100 : 0, integrity: 100, efficiency: 100 },
    pass,
    pass_threshold: 0.8,
    pass_threshold_percent: 80,
    integrity_violations: 0,
  };
}

function buildBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const bundleScore = overrides.score ?? score(0);
  const correctnessCommands = overrides.verification_results?.correctness.command_results ?? [];
  const regressionCommands = overrides.verification_results?.regression.command_results ?? [];
  return {
    bundle_id: "run_build_unit",
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: {
      id: "coord-001",
      manifest_hash: "sha256:m",
      family: "orchestration",
      difficulty: "medium",
      benchmark_provenance: {
        source: "unit",
        public_status: "private",
        oracle_visibility: "hidden",
        gold_solution_visibility: "hidden",
        contamination_risk: "low",
        known_scoring_limitations: ["unit build fixture"],
      },
    },
    agent: { adapter: "unit", adapter_version: "1.0.0", system: "unit", system_version: "1.0.0", model: "unit-model", model_version: "latest", provider: "unit-provider" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc", crucibulum_version: "1.0.0", timestamp_start: "2026-05-16T00:00:00.000Z", timestamp_end: "2026-05-16T00:00:01.000Z" },
    timeline: [{ t: 0, type: "task_complete", detail: "done" }],
    diff: { files_changed: [{ path: "src/users/register.js", lines_added: 1, lines_removed: 1, patch: "+await validate(email)" }], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: bundleScore.breakdown.correctness, details: {}, command_results: correctnessCommands },
      regression: { score: bundleScore.breakdown.regression, details: {}, command_results: regressionCommands },
      integrity: { score: 1, details: {}, violations: [] },
      efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 8, score: 1 },
      ...overrides.verification_results,
    },
    score: bundleScore,
    usage: { tokens_in: 8, tokens_out: 8, estimated_cost_usd: 0, provider_cost_note: "unit" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "unit", verifier_model: null, components: ["public-tests", "hidden-oracle"] },
    trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: null },
    ...overrides,
  };
}

function classify(bundle: EvidenceBundle, exitReason = "complete", rawError?: string) {
  const verdict = normalizeVerdict({ bundle, executionMode: "repo", exitReason, rawError: rawError ?? null });
  return classifyBuildEvaluation(bundle, verdict, { exit_reason: exitReason as never })!;
}

describe("build result classification goldens", () => {
  it("classifies correct edits with passing verification as PASS", () => {
    const bundle = buildBundle({
      score: score(1, true),
      verification_results: {
        correctness: { score: 1, details: {}, command_results: [command()] },
        regression: { score: 1, details: {}, command_results: [command({ id: "hidden", scope: "regression" })] },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 8, score: 1 },
      },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: null },
    });
    const result = classify(bundle);
    assert.equal(result.category, "PASS");
    assert.equal(result.reflects_model_capability, true);
  });

  it("classifies no-edit model completions as NO_EDIT", () => {
    const result = classify(buildBundle({
      diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    }));
    assert.equal(result.category, "NO_EDIT");
  });

  it("classifies wrong edits without hiding the failure", () => {
    const result = classify(buildBundle({
      diagnosis: { localized_correctly: false, avoided_decoys: false, first_fix_correct: false, self_verified: false, failure_mode: "wrong_fix" },
    }));
    assert.equal(result.category, "WRONG_EDIT");
    assert.equal(result.failure_is_infrastructure, false);
  });

  it("classifies pre-agent build command failures as PREEXISTING_REPO_FAILURE", () => {
    const result = classify(buildBundle({
      verification_results: {
        correctness: { score: 0, details: {}, command_results: [command({ status: "fail", exitCode: 1, command: "npm run build", summary: "pre-agent baseline failed before model changes" })] },
        regression: { score: 0, details: {}, command_results: [] },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 8, score: 1 },
      },
    }));
    assert.equal(result.category, "PREEXISTING_REPO_FAILURE");
    assert.equal(result.failure_is_infrastructure, true);
  });

  it("classifies empty provider responses as EMPTY_RESPONSE, not model 0", () => {
    const result = classify(buildBundle({
      timeline: [{ t: 0, type: "error", detail: "Provider returned empty response" }],
    }), "error", "Provider returned empty response");
    assert.equal(result.category, "EMPTY_RESPONSE");
    assert.equal(result.reflects_model_capability, false);
  });

  it("classifies timeouts separately from model build failures", () => {
    const result = classify(buildBundle({
      timeline: [{ t: 0, type: "error", detail: "execution timed out" }],
    }), "timeout");
    assert.equal(result.category, "TIMEOUT");
    assert.equal(result.failure_is_infrastructure, true);
  });

  it("classifies sandbox and path execution errors distinctly", () => {
    const result = classify(buildBundle({
      verification_results: {
        correctness: { score: 0, details: {}, command_results: [command({ status: "error", exitCode: null, summary: "spawn_error: command could not start in workspace path", errorKind: "spawn_error" })] },
        regression: { score: 0, details: {}, command_results: [] },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 8, score: 1 },
      },
    }));
    assert.equal(result.category, "SANDBOX_FAILURE");
    assert.equal(result.failure_is_infrastructure, true);
  });

  it("classifies correct-looking edits with test failures as TEST_FAILED", () => {
    const result = classify(buildBundle({
      score: score(0.4, false),
      verification_results: {
        correctness: { score: 0.4, details: {}, command_results: [command({ status: "fail", exitCode: 1, summary: "hidden oracle assertion failed" })] },
        regression: { score: 1, details: {}, command_results: [] },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 8, score: 1 },
      },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: "hidden_test_failure" },
    }));
    assert.equal(result.category, "TEST_FAILED");
  });

  it("classifies build command failures as BUILD_FAILED", () => {
    const result = classify(buildBundle({
      verification_results: {
        correctness: { score: 0, details: {}, command_results: [command({ status: "fail", exitCode: 2, command: "npm run build", summary: "TypeScript compile failed after agent edit" })] },
        regression: { score: 0, details: {}, command_results: [] },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 8, score: 1 },
      },
    }));
    assert.equal(result.category, "BUILD_FAILED");
    assert.equal(result.score_basis.some((item) => item.includes("cmd=npm run build")), true);
  });

  it("surfaces build_evaluation through the API summary contract", () => {
    const bundle = buildBundle({ score: score(1, true) });
    const verdict = normalizeVerdict({ bundle, executionMode: "repo", exitReason: "complete" });
    bundle.verdict = verdict;
    bundle.build_evaluation = classifyBuildEvaluation(bundle, verdict);
    const summary = summarizeBundle(bundle);
    assert.equal(summary.outcome.build_evaluation?.category, "PASS");
    assert.equal(summary.target.provider, "unit-provider");
    assert.equal(summary.target.model, "unit-model");
  });
});
