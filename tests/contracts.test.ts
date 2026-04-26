import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeBundle, countRepeatRuns, summarizeRunSet } from "../server/contracts.js";
import { writeCrucibleLink, readCrucibleLink } from "../server/validation-links.js";
import { signBundle } from "../core/bundle.js";
import type { EvidenceBundle } from "../adapters/base.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function makeBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const bundle: EvidenceBundle = {
    bundle_id: "run_test_contracts",
    bundle_hash: "",
    bundle_version: "1.0.0",
    task: { id: "poison-001", manifest_hash: "sha256:abc", family: "poison_localization", difficulty: "medium" },
    oracle_integrity: {
      oracle_hash_verified: true,
      oracle_hash_status: "valid",
      oracle_hash_expected: `sha256:${"a".repeat(64)}`,
      oracle_hash_actual: `sha256:${"a".repeat(64)}`,
    },
    agent: { adapter: "openrouter", adapter_version: "1.0.0", system: "openrouter-v1", system_version: "openrouter-v1", model: "openai/gpt-4.1-mini", model_version: "latest", provider: "openrouter" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: "2026-04-05T00:00:00Z", timestamp_end: "2026-04-05T00:02:00Z" },
    timeline: [{ t: 0, type: "task_start", detail: "start" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: 1, details: { oracle: "pass" } },
      regression: { score: 1, details: { public_tests: "pass" } },
      integrity: { score: 1, details: { integrity: "pass" }, violations: [] },
      efficiency: { time_sec: 120, time_limit_sec: 900, steps_used: 8, steps_limit: 40, score: 0.75 },
    },
    score: {
      scale: "fraction_0_1",
      total: 0.95,
      total_percent: 95,
      breakdown: { correctness: 1, regression: 1, integrity: 1, efficiency: 0.75 },
      breakdown_percent: { correctness: 100, regression: 100, integrity: 100, efficiency: 75 },
      pass: true,
      pass_threshold: 0.7,
      pass_threshold_percent: 70,
      integrity_violations: 0,
    },
    usage: { tokens_in: 123, tokens_out: 456, estimated_cost_usd: 0.1234, provider_cost_note: "via openrouter" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "oracle + hidden/public tests + integrity checks", verifier_model: null, components: ["oracle", "hidden tests", "public tests", "diff rules", "integrity checks"] },
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      bundle_verified: true,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: null },
    integrations: {
      veritor: { contract_version: "1.0.0", consumable: true },
      paedagogus: {
        contract_version: "1.0.0",
        consumable: true,
        routing_signals: { task_family: "poison_localization", difficulty: "medium", provider: "openrouter", adapter: "openrouter", score: 0.95, pass: true, failure_mode: null },
      },
      crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: 95, divergence_note: null },
    },
    ...overrides,
  };
  process.env["CRUCIBLE_HMAC_KEY"] = "contracts-test-secret";
  signBundle(bundle);
  return bundle;
}

describe("evaluation contracts", () => {
  it("builds structured summary consumable by veritor and paedagogus", () => {
    const bundle = makeBundle({
      review: {
        authority: "advisory",
        deterministic_result_authoritative: true,
        security: {
          review_input_scanned: true,
          review_input_sanitized: true,
          injection_flags_count: 2,
          flagged_sources: ["diff", "timeline"],
          flagged_artifacts: ["diff:src/a.ts => injection"],
          review_blocked_reason: "review_input_injection_detected",
          review_output_invalid: false,
          trust_boundary_violations: ["untrusted_review_input_blocked"],
        },
        secondOpinion: {
          enabled: true,
          provider: "openai",
          model: "gpt-4.1-mini",
          status: "blocked_injection",
          summary: "blocked",
          flags: ["flag"],
          confidence: "low",
          recommendation: null,
          disagreement: false,
        },
        qcReview: {
          enabled: false,
          provider: "",
          model: "",
          status: "skipped",
          summary: "",
          flags: [],
          confidence: "high",
          recommendation: null,
          disagreement: false,
        },
      },
    });
    const repeatPeer = makeBundle({
      bundle_id: "run_test_contracts_repeat",
      environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: "2026-04-05T00:05:00Z", timestamp_end: "2026-04-05T00:06:00Z" },
    });
    const summary = summarizeBundle(
      bundle,
      3,
      { profile_id: "crucible:model-1", benchmark_score: 71, benchmark_label: "Crucible April" },
      [bundle, repeatPeer],
    );
    assert.equal(summary.schema, "crucibulum.evaluation.summary.v1");
    assert.equal(summary.target.adapter, "openrouter");
    assert.equal(summary.target.provider, "openrouter");
    assert.equal(summary.oracle_integrity?.oracle_hash_verified, true);
    assert.equal(summary.oracle_integrity?.oracle_hash_status, "valid");
    assert.equal(summary.judge.kind, "deterministic");
    assert.equal(summary.authority.deterministic_judge_authoritative, true);
    assert.equal(summary.authority.review_layer_advisory, true);
    assert.equal(summary.trust.bundle_hash_verified, true);
    assert.equal(summary.trust.bundle_authenticated, true);
    assert.equal(summary.trust.bundle_signature_status, "valid");
    assert.equal(summary.review_input_sanitized, true);
    assert.equal(summary.injection_flags_count, 2);
    assert.deepEqual(summary.flagged_sources, ["diff", "timeline"]);
    assert.deepEqual(summary.trust_boundary_violations, ["untrusted_review_input_blocked"]);
    assert.equal(summary.repeat_run_count, 3);
    assert.equal(summary.pass_at.pass_at_1, true);
    assert.equal(summary.pass_at.pass_at_3, null);
    assert.equal(summary.reliability.repeated_runs, 2);
    assert.equal(summary.reliability.assessment, "guarded");
    assert.ok(summary.reliability.reasons.includes("single_run_only") || summary.reliability.reasons.length >= 1);
    assert.equal(summary.integrations.veritor?.consumable, true);
    assert.equal(summary.integrations.paedagogus?.routing_signals.provider, "openrouter");
    assert.equal(summary.integrations.crucible?.profile_id, "crucible:model-1");
    assert.match(summary.integrations.crucible?.divergence_note || "", /Benchmark 71 vs execution 95/);
  });

  it("counts repeat runs by task and target", () => {
    const bundles = [
      makeBundle(),
      makeBundle({ bundle_id: "run_test_contracts_2" }),
      makeBundle({ bundle_id: "run_other", task: { id: "spec-001", manifest_hash: "sha256:def", family: "spec_discipline", difficulty: "easy" } }),
    ];
    assert.equal(countRepeatRuns(bundles, "poison-001", "openrouter", "openai/gpt-4.1-mini"), 2);
    assert.equal(countRepeatRuns(bundles, "poison-001", "openrouter", "openai/gpt-4.1-mini", "openrouter"), 2);
  });

  it("derives repeat-run reliability and pass@k from stored evidence", () => {
    const runSet = summarizeRunSet([
      makeBundle({
        bundle_id: "run_a",
        score: {
          scale: "fraction_0_1",
          total: 0.2,
          total_percent: 20,
          breakdown: { correctness: 0, regression: 0.5, integrity: 1, efficiency: 0.5 },
          breakdown_percent: { correctness: 0, regression: 50, integrity: 100, efficiency: 50 },
          pass: false,
          pass_threshold: 0.7,
          pass_threshold_percent: 70,
          integrity_violations: 0,
        },
        diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "wrong_fix" },
        environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: "2026-04-05T00:00:00Z", timestamp_end: "2026-04-05T00:01:00Z" },
      }),
      makeBundle({
        bundle_id: "run_b",
        review: {
          authority: "advisory",
          deterministic_result_authoritative: true,
          security: {
            review_input_scanned: true,
            review_input_sanitized: true,
            injection_flags_count: 1,
            flagged_sources: ["diff"],
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
        environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: "2026-04-05T00:02:00Z", timestamp_end: "2026-04-05T00:03:00Z" },
      }),
      makeBundle({
        bundle_id: "run_c",
        environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: "2026-04-05T00:04:00Z", timestamp_end: "2026-04-05T00:05:00Z" },
      }),
    ]);

    assert.equal(runSet.run_count, 3);
    assert.equal(runSet.passes, 2);
    assert.equal(runSet.failures, 1);
    assert.equal(runSet.pass_at.pass_at_1, false);
    assert.equal(runSet.pass_at.pass_at_3, true);
    assert.equal(runSet.pass_at.pass_at_5, null);
    assert.equal(runSet.reliability.outcome_stability, "mixed");
    assert.equal(runSet.reliability.qc_disagreement_rate, 0.3333);
    assert.equal(runSet.reliability.review_blocked_count, 1);
    assert.equal(runSet.reliability.injection_flagged_runs, 1);
    assert.equal(runSet.reliability.assessment, "mixed");
  });

  it("stores and reloads crucible validation links", () => {
    const dir = mkdtempSync(join(tmpdir(), "crucibulum-links-"));
    process.env["CRUCIBULUM_LINKS_DIR"] = dir;
    writeCrucibleLink("run_test_contracts", {
      profile_id: "crucible:model-1",
      benchmark_score: 88,
      benchmark_label: "Crucible local benchmark",
    });
    assert.deepEqual(readCrucibleLink("run_test_contracts"), {
      profile_id: "crucible:model-1",
      benchmark_score: 88,
      benchmark_label: "Crucible local benchmark",
    });
    delete process.env["CRUCIBULUM_LINKS_DIR"];
  });
});
