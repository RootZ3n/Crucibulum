import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import { signBundle } from "../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";
import { assertBenchmarkProvenance } from "../core/manifest.js";
import { computeConfidence } from "../core/suite-loader.js";
import { summarizeBundle, summarizeRunSet } from "../server/contracts.js";

const BENCHMARK_PROVENANCE = {
  source: "reporting-fields test fixture",
  public_status: "private" as const,
  oracle_visibility: "hidden" as const,
  gold_solution_visibility: "hidden" as const,
  contamination_risk: "low" as const,
  known_scoring_limitations: ["Synthetic fixture for API contract assertions."],
};

function makeBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const bundle: EvidenceBundle = {
    bundle_id: `run_reporting_${overrides.bundle_id ?? "base"}`,
    bundle_hash: "",
    bundle_version: "1.0.0",
    task: {
      id: "truth-001",
      manifest_hash: "sha256:test",
      family: "truthfulness",
      difficulty: "medium",
      benchmark_provenance: BENCHMARK_PROVENANCE,
    },
    oracle_integrity: undefined,
    agent: {
      adapter: "mock",
      adapter_version: "1.0.0",
      provider: "unit-provider",
      model: "unit-model",
      model_version: "latest",
      system: "mock-system",
      system_version: "1.0.0",
    },
    environment: {
      os: "linux-x64",
      arch: "x64",
      repo_commit: "abc123",
      crucibulum_version: "1.0.0",
      timestamp_start: "2026-06-30T00:00:00.000Z",
      timestamp_end: "2026-06-30T00:00:05.000Z",
    },
    timeline: [{ t: 0, type: "task_start", detail: "start" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: 1, details: {}, command_results: [] },
      regression: { score: 1, details: {}, command_results: [] },
      integrity: { score: 1, details: {}, violations: [] },
      efficiency: { score: 1, time_sec: 5, time_limit_sec: 60, steps_used: 1, steps_limit: 10 },
    },
    score: {
      scale: "fraction_0_1",
      total: 1,
      total_percent: 100,
      breakdown: { correctness: 1, regression: 1, integrity: 1, efficiency: 1 },
      breakdown_percent: { correctness: 100, regression: 100, integrity: 100, efficiency: 100 },
      pass: true,
      pass_threshold: 0.7,
      pass_threshold_percent: 70,
      integrity_violations: 0,
    },
    usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: "" },
    judge: DETERMINISTIC_JUDGE_METADATA,
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      bundle_verified: true,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: null },
    ...overrides,
  };
  process.env["CRUCIBLE_HMAC_KEY"] = "reporting-fields-test-secret";
  signBundle(bundle);
  return bundle;
}

describe("computeConfidence", () => {
  it("returns the production confidence levels for known pass-rate inputs", () => {
    assert.equal(computeConfidence(1, false), "high");
    assert.equal(computeConfidence(1, true), "medium");
    assert.equal(computeConfidence(0.7, false), "medium");
    assert.equal(computeConfidence(0.69, false), "low");
    assert.equal(computeConfidence(0.5, true), "medium");
    assert.equal(computeConfidence(0.49, true), "low");
    assert.equal(computeConfidence(0, false), "low");
  });
});

describe("benchmark provenance release gate", () => {
  it("blocks missing and incomplete benchmark provenance", () => {
    assert.throws(
      () => assertBenchmarkProvenance({ id: "missing", metadata: {} }),
      /metadata\.benchmark_provenance is required/,
    );
    assert.throws(
      () => assertBenchmarkProvenance({ id: "bad", metadata: { benchmark_provenance: { ...BENCHMARK_PROVENANCE, known_scoring_limitations: [] } } }),
      /known_scoring_limitations must list at least one limitation/,
    );
  });

  it("allows complete benchmark provenance", () => {
    assert.doesNotThrow(() => assertBenchmarkProvenance({
      id: "complete",
      metadata: { benchmark_provenance: BENCHMARK_PROVENANCE },
    }));
  });
});

describe("real API summary output", () => {
  it("exposes the expected summary shape from summarizeBundle", () => {
    const summary = summarizeBundle(makeBundle(), 1, null);

    assert.deepEqual(Object.keys(summary).sort(), [
      "authority",
      "benchmark_provenance",
      "bundle_hash",
      "bundle_id",
      "difficulty",
      "family",
      "flagged_sources",
      "injection_flags_count",
      "integrations",
      "interpretation",
      "judge",
      "judge_usage",
      "oracle_integrity",
      "outcome",
      "pass_at",
      "reliability",
      "repeat_run_count",
      "review",
      "review_blocked_reason",
      "review_input_sanitized",
      "review_output_invalid",
      "review_security",
      "schema",
      "suite_id",
      "target",
      "task_id",
      "timing",
      "total",
      "trust",
      "trust_boundary_violations",
      "usage",
    ]);
    assert.equal(summary.schema, "crucibulum.evaluation.summary.v1");
    assert.equal(summary.benchmark_provenance?.source, BENCHMARK_PROVENANCE.source);
    assert.equal(summary.outcome.score, 100);
    assert.deepEqual(summary.outcome.score_breakdown, { correctness: 100, regression: 100, integrity: 100, efficiency: 100 });
    assert.equal(summary.usage.tokens_in, 0);
    assert.equal(summary.total.tokens, 0);
    assert.equal(summary.judge_usage.kind, "deterministic");
    assert.equal(summary.integrations.crucible?.profile_id, null);
  });

  it("handles zero, null, and missing optional values without dropping fields", () => {
    const failed = makeBundle({
      bundle_id: "failed",
      score: {
        scale: "fraction_0_1",
        total: 0,
        total_percent: 0,
        breakdown: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 },
        breakdown_percent: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 },
        pass: false,
        pass_threshold: 0.7,
        pass_threshold_percent: 70,
        integrity_violations: 0,
      },
      usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: "" },
      oracle_integrity: undefined,
    });
    const summary = summarizeBundle(failed, 1, { profile_id: null, benchmark_score: null, benchmark_label: null });
    const emptyRunSet = summarizeRunSet([]);

    assert.equal(summary.outcome.pass, false);
    assert.equal(summary.outcome.score, 0);
    assert.equal(summary.oracle_integrity, null);
    assert.equal(summary.integrations.crucible?.benchmark_score, null);
    assert.equal(summary.reliability.pass_rate, 0);
    assert.equal(emptyRunSet.run_count, 0);
    assert.equal(emptyRunSet.pass_rate, 0);
    assert.equal(emptyRunSet.avg_score, 0);
    assert.deepEqual(emptyRunSet.pass_at, { pass_at_1: false, pass_at_3: null, pass_at_5: null });
  });
});
