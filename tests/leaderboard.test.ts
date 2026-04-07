/**
 * Crucibulum — Leaderboard Aggregator Tests
 * Covers: aggregateByModel, buildLeaderboardEntry, pass@k correctness.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { aggregateByModel, buildLeaderboardEntry } from "../leaderboard/aggregator.js";
import type { EvidenceBundle } from "../adapters/base.js";

function makeMockBundle(overrides: Partial<{
  adapter: string;
  provider: string;
  model: string;
  taskId: string;
  pass: boolean;
  total: number;
  correctness: number;
  regression: number;
  integrity: number;
  efficiency: number;
  failureMode: string | null;
  timestampStart: string;
  timestampEnd: string;
}>): EvidenceBundle {
  const o = {
    adapter: "mock",
    provider: "local",
    model: "mock-model",
    taskId: "task-001",
    pass: true,
    total: 0.85,
    correctness: 1,
    regression: 1,
    integrity: 1,
    efficiency: 0.7,
    failureMode: null,
    timestampStart: "2026-01-01T00:00:00Z",
    timestampEnd: "2026-01-01T00:01:00Z",
    ...overrides,
  };

  return {
    bundle_id: `run_${o.taskId}_${Date.now()}`,
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: { id: o.taskId, manifest_hash: "sha256:abc", family: "poison_localization", difficulty: "medium" },
    agent: { adapter: o.adapter, adapter_version: "1.0.0", system: "test", system_version: "1.0.0", model: o.model, model_version: "1.0.0", provider: o.provider },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: o.timestampStart, timestamp_end: o.timestampEnd },
    timeline: [
      { t: 0, type: "task_start", detail: "init" },
      { t: 30, type: "file_write", path: "src/main.js" },
      { t: 55, type: "task_complete", detail: "done" },
    ],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: o.correctness, details: {} },
      regression: { score: o.regression, details: {} },
      integrity: { score: o.integrity, details: {}, violations: [] },
      efficiency: { time_sec: 60, time_limit_sec: 300, steps_used: 5, steps_limit: 20, score: o.efficiency },
    },
    score: {
      total: o.total,
      breakdown: { correctness: o.correctness, regression: o.regression, integrity: o.integrity, efficiency: o.efficiency },
      pass: o.pass,
      pass_threshold: 0.7,
      integrity_violations: 0,
    },
    usage: { tokens_in: 1000, tokens_out: 500, estimated_cost_usd: 0, provider_cost_note: "local" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "oracle + hidden/public tests + integrity checks", verifier_model: null, components: ["oracle", "hidden tests", "public tests", "diff rules", "integrity checks"] },
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      bundle_verified: true,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: o.pass, self_verified: true, failure_mode: o.failureMode },
    integrations: {
      veritor: { contract_version: "1.0.0", consumable: true },
      paedagogus: {
        contract_version: "1.0.0",
        consumable: true,
        routing_signals: {
          task_family: "poison_localization",
          difficulty: "medium",
          provider: o.provider,
          adapter: o.adapter,
          score: o.total,
          pass: o.pass,
          failure_mode: o.failureMode,
        },
      },
      crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: Math.round(o.total * 100), divergence_note: null },
    },
  };
}

// ── aggregateByModel ────────────────────────────────────────────────────────

describe("aggregateByModel", () => {
  it("groups bundles by adapter:provider:model key", () => {
    const bundles = [
      makeMockBundle({ adapter: "ollama", provider: "ollama", model: "gemma3:27b" }),
      makeMockBundle({ adapter: "ollama", provider: "ollama", model: "gemma3:27b" }),
      makeMockBundle({ adapter: "ollama", provider: "openrouter", model: "gemma3:27b" }),
    ];

    const groups = aggregateByModel(bundles);
    assert.equal(groups.size, 2);
    assert.equal(groups.get("ollama:ollama:gemma3:27b")!.length, 2);
    assert.equal(groups.get("ollama:openrouter:gemma3:27b")!.length, 1);
  });

  it("returns empty map for empty input", () => {
    const groups = aggregateByModel([]);
    assert.equal(groups.size, 0);
  });
});

// ── buildLeaderboardEntry ───────────────────────────────────────────────────

describe("buildLeaderboardEntry", () => {
  it("produces entry with all required fields", () => {
    const bundles = [
      makeMockBundle({ pass: true, total: 0.9 }),
      makeMockBundle({ pass: false, total: 0.3, failureMode: "wrong_fix" }),
    ];

    const entry = buildLeaderboardEntry("mock:local:mock-model", bundles);

    assert.equal(typeof entry.submission_id, "string");
    assert.equal(typeof entry.submitted_at, "string");
    assert.ok(Array.isArray(entry.bundle_hashes));
    assert.equal(entry.bundle_hashes.length, 2);
    assert.equal(entry.crucibulum_version, "1.0.0");
    assert.equal(entry.agent.adapter, "mock");
    assert.equal(entry.agent.provider, "local");
    assert.equal(entry.agent.model, "mock-model");
    assert.equal(typeof entry.tasks_attempted, "number");
    assert.equal(typeof entry.tasks_passed, "number");
    assert.equal(typeof entry.scores.total, "number");
    assert.equal(typeof entry.scores.correctness, "number");
    assert.equal(typeof entry.scores.regression, "number");
    assert.equal(typeof entry.scores.integrity, "number");
    assert.equal(typeof entry.scores.efficiency, "number");
    assert.equal(typeof entry.performance.median_time_sec, "number");
    assert.equal(typeof entry.performance.p90_time_sec, "number");
    assert.equal(typeof entry.performance.median_steps, "number");
    assert.equal(typeof entry.performance.total_cost_usd, "number");
    assert.equal(typeof entry.review_signals.disagreement_rate, "number");
    assert.equal(typeof entry.verified, "boolean");
  });

  it("computes failure taxonomy from failed runs", () => {
    const bundles = [
      makeMockBundle({ pass: false, total: 0.2, failureMode: "wrong_fix" }),
      makeMockBundle({ pass: false, total: 0.1, failureMode: "wrong_fix" }),
      makeMockBundle({ pass: false, total: 0.3, failureMode: "localization_failure" }),
    ];

    const entry = buildLeaderboardEntry("mock:local:mock-model", bundles);
    assert.equal(entry.failure_taxonomy["wrong_fix"], 2);
    assert.equal(entry.failure_taxonomy["localization_failure"], 1);
  });
});

// ── pass@k correctness ──────────────────────────────────────────────────────

describe("pass@k", () => {
  it("pass@1 = false when first run fails, pass@3 = true when any passes", () => {
    const bundles = [
      makeMockBundle({ taskId: "task-pk", pass: false, total: 0.2, failureMode: "wrong_fix" }),
      makeMockBundle({ taskId: "task-pk", pass: true, total: 0.9 }),
      makeMockBundle({ taskId: "task-pk", pass: false, total: 0.3, failureMode: "wrong_fix" }),
    ];

    const entry = buildLeaderboardEntry("mock:local:mock-model", bundles);

    // pass@1 checks the first run only
    assert.equal(entry.pass_at["task-pk_pass@1"], false);
    // pass@3 checks if any of the 3 runs passed
    assert.equal(entry.pass_at["task-pk_pass@3"], true);
    assert.equal(entry.pass_at["overall_pass@3"], true);
  });

  it("pass@1 = true when first run passes", () => {
    const bundles = [
      makeMockBundle({ taskId: "task-pk2", pass: true, total: 0.9 }),
      makeMockBundle({ taskId: "task-pk2", pass: false, total: 0.2, failureMode: "wrong_fix" }),
    ];

    const entry = buildLeaderboardEntry("mock:local:mock-model", bundles);
    assert.equal(entry.pass_at["task-pk2_pass@1"], true);
    assert.equal(entry.pass_at["task-pk2_pass@2"], true);
  });

  it("computes pass@5 and review rates when enough runs exist", () => {
    const flaggedBundle: EvidenceBundle = {
      ...makeMockBundle({ taskId: "task-pk5", pass: true, total: 0.9, timestampStart: "2026-01-01T00:04:00Z" }),
      review: {
        authority: "advisory",
        deterministic_result_authoritative: true,
        security: {
          review_input_scanned: true,
          review_input_sanitized: true,
          injection_flags_count: 0,
          flagged_sources: [],
          flagged_artifacts: [],
          review_blocked_reason: "review_input_injection_detected",
          review_output_invalid: false,
          trust_boundary_violations: [],
        },
        secondOpinion: {
          enabled: true,
          provider: "openai",
          model: "gpt-4.1-mini",
          status: "blocked_injection",
          summary: "",
          flags: [],
          confidence: "low",
          recommendation: null,
          disagreement: false,
        },
        qcReview: {
          enabled: true,
          provider: "openai",
          model: "gpt-4.1-mini",
          status: "completed",
          summary: "",
          flags: [],
          confidence: "medium",
          recommendation: null,
          disagreement: true,
        },
      },
    };
    const bundles = [
      makeMockBundle({ taskId: "task-pk5", pass: false, total: 0.2, failureMode: "wrong_fix", timestampStart: "2026-01-01T00:00:00Z" }),
      makeMockBundle({ taskId: "task-pk5", pass: false, total: 0.2, failureMode: "wrong_fix", timestampStart: "2026-01-01T00:01:00Z" }),
      makeMockBundle({ taskId: "task-pk5", pass: false, total: 0.2, failureMode: "wrong_fix", timestampStart: "2026-01-01T00:02:00Z" }),
      makeMockBundle({ taskId: "task-pk5", pass: false, total: 0.2, failureMode: "wrong_fix", timestampStart: "2026-01-01T00:03:00Z" }),
      flaggedBundle,
    ];

    const entry = buildLeaderboardEntry("mock:local:mock-model", bundles);
    assert.equal(entry.pass_at["task-pk5_pass@5"], true);
    assert.equal(entry.review_signals.qc_disagreement_rate, 0.2);
    assert.equal(entry.review_signals.review_blocked_rate, 0.2);
  });
});
