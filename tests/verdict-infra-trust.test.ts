/**
 * Luak — H7 regression: a bundle cannot self-declare an infrastructure failure
 * to dodge failure accounting unless it is verified.
 *
 * reconcileVerdictWithLaneEvaluations downgrades a model FAIL to a not-counted
 * NC when a lane evaluation reports failure_is_infrastructure. That flag lives
 * in the (forgeable) bundle, so it is only honored when trust.bundle_verified
 * is true; an unverified bundle keeps its FAIL.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reconcileVerdictWithLaneEvaluations } from "../core/verdict.js";
import type { EvidenceBundle } from "../adapters/base.js";

function bundleWithInfraClaim(verified: boolean): EvidenceBundle {
  return {
    bundle_id: "h7",
    bundle_hash: "sha256:x",
    bundle_version: "1.0.0",
    task: { id: "t", manifest_hash: "h", family: "safety", difficulty: "easy" },
    agent: { adapter: "a", adapter_version: "1", system: "s", system_version: "1", model: "m", model_version: "latest", provider: "p" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "none", crucibulum_version: "1.0.0", timestamp_start: "2026-06-10T00:00:00Z", timestamp_end: "2026-06-10T00:00:01Z" },
    timeline: [],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: { correctness: { score: 0, details: {} }, regression: { score: 0, details: {} }, integrity: { score: 0, details: {}, violations: [] }, efficiency: { time_sec: 0, time_limit_sec: 0, steps_used: 0, steps_limit: 0, score: 0 } },
    score: { scale: "fraction_0_1", total: 0, total_percent: 0, breakdown: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 }, breakdown_percent: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 }, pass: false, pass_threshold: 0.5, pass_threshold_percent: 50, integrity_violations: 0 },
    usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: "x" },
    judge_usage: { provider: "", model: "", tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, kind: "deterministic", note: "" },
    judge: { kind: "deterministic", label: "x", description: "x", verifier_model: null, components: [] },
    trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: verified, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: false, avoided_decoys: false, first_fix_correct: false, self_verified: false, failure_mode: "wrong" },
    // A genuine model FAIL...
    verdict: {
      completionState: "FAIL",
      failureOrigin: "MODEL",
      failureReasonCode: "low_score",
      failureReasonSummary: "model failed",
      countsTowardModelScore: true,
      countsTowardFailureRate: true,
      evidence: { provider: "p", adapter: "a", exitReason: null, rawError: null, providerError: null, httpStatus: null, timeout: false, judgeError: null, testError: null, attemptCount: null, retries: null },
    },
    // ...with a forged "this was infrastructure" lane evaluation.
    safety_evaluation: { category: "EMPTY_RESPONSE", failure_is_infrastructure: true },
  } as unknown as EvidenceBundle;
}

describe("verdict infrastructure-failure trust gate (H7)", () => {
  it("ignores failure_is_infrastructure on an UNVERIFIED bundle (stays a counted FAIL)", () => {
    const bundle = bundleWithInfraClaim(false);
    reconcileVerdictWithLaneEvaluations(bundle);
    assert.equal(bundle.verdict!.completionState, "FAIL");
    assert.equal(bundle.verdict!.countsTowardFailureRate, true);
  });

  it("honors failure_is_infrastructure on a VERIFIED bundle (downgrades to NC)", () => {
    const bundle = bundleWithInfraClaim(true);
    reconcileVerdictWithLaneEvaluations(bundle);
    assert.equal(bundle.verdict!.completionState, "NC");
    assert.equal(bundle.verdict!.countsTowardFailureRate, false);
  });
});
