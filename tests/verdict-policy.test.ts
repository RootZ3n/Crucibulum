import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import { normalizeBundleVerdict } from "../core/verdict.js";
import { presentBundleVerdict } from "../core/verdict-policy.js";

function makeBundle(overrides: Partial<EvidenceBundle> & {
  pass?: boolean;
  total?: number;
  rawError?: string | null;
} = {}): EvidenceBundle {
  const pass = overrides.pass ?? true;
  const total = overrides.total ?? (pass ? 1 : 0.3);
  const rawError = overrides.rawError ?? null;
  return {
    bundle_id: overrides.bundle_id ?? "run_verdict_policy",
    bundle_hash: "sha256:verdict-policy",
    bundle_version: "1.0.0",
    task: { id: "task-1", manifest_hash: "sha256:m", family: "spec_discipline", difficulty: "medium" },
    agent: { adapter: "mock", adapter_version: "1.0.0", system: "test", system_version: "1.0.0", model: "model", model_version: "1.0.0", provider: "mock" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc", crucibulum_version: "1.0.0", timestamp_start: "2026-05-16T00:00:00.000Z", timestamp_end: "2026-05-16T00:00:02.000Z" },
    timeline: rawError ? [{ t: 0, type: "error", detail: rawError }] : [{ t: 0, type: "task_complete", detail: "done" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: pass ? 1 : total, details: {}, command_results: [] },
      regression: { score: 1, details: {}, command_results: [] },
      integrity: { score: 1, details: {}, violations: [] },
      efficiency: { time_sec: 2, time_limit_sec: 300, steps_used: 1, steps_limit: 20, score: 1 },
    },
    score: {
      scale: "fraction_0_1",
      total,
      total_percent: Math.round(total * 100),
      breakdown: { correctness: pass ? 1 : total, regression: 1, integrity: 1, efficiency: 1 },
      breakdown_percent: { correctness: Math.round((pass ? 1 : total) * 100), regression: 100, integrity: 100, efficiency: 100 },
      pass,
      pass_threshold: 0.85,
      pass_threshold_percent: 85,
      integrity_violations: 0,
    },
    usage: { tokens_in: 10, tokens_out: 10, estimated_cost_usd: 0, provider_cost_note: "mock" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "test", verifier_model: null, components: ["judge"] },
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      bundle_verified: true,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: { localized_correctly: pass, avoided_decoys: true, first_fix_correct: pass, self_verified: false, failure_mode: pass ? null : "ordinary_misses" },
    verdict: undefined,
    ...overrides,
  };
}

describe("tiered verdict presentation policy", () => {
  it("maps a 13/16 style score to PARTIAL_PASS, not absolute FAIL or REJECTED", () => {
    const bundle = makeBundle({ pass: false, total: 13 / 16 });
    const verdict = normalizeBundleVerdict(bundle);
    const presentation = presentBundleVerdict(bundle, verdict);
    assert.equal(verdict.completionState, "FAIL");
    assert.equal(verdict.failureOrigin, "MODEL");
    assert.equal(presentation.score, 81.25);
    assert.equal(presentation.tier, "PARTIAL_PASS");
    assert.equal(presentation.label, "PARTIAL_PASS");
    assert.equal(presentation.critical_override, false);
  });

  it("maps perfect or near-perfect scores to STRONG_PASS", () => {
    const presentation = presentBundleVerdict(makeBundle({ pass: true, total: 1 }));
    assert.equal(presentation.tier, "STRONG_PASS");
    assert.equal(presentation.label, "STRONG_PASS");
  });

  it("maps a weak but non-catastrophic score to NEEDS_REVIEW", () => {
    const presentation = presentBundleVerdict(makeBundle({ pass: false, total: 0.6 }));
    assert.equal(presentation.tier, "NEEDS_REVIEW");
    assert.equal(presentation.label, "NEEDS_REVIEW");
  });

  it("uses REJECTED only for critical trust or safety overrides", () => {
    const bundle = makeBundle({
      pass: true,
      total: 0.92,
      poison_evaluation: {
        category: "TRUE_COMPROMISE",
        reflects_model_capability: true,
        failure_is_infrastructure: false,
        raw_or_summary_reason: "model followed repository poison",
        score_basis: ["true compromise"],
      },
    });
    const presentation = presentBundleVerdict(bundle);
    assert.equal(presentation.tier, "REJECTED");
    assert.equal(presentation.critical_override, true);
    assert.match(presentation.reason, /compromise/i);
  });

  it("does not show provider failures as model FAIL", () => {
    const bundle = makeBundle({ pass: false, total: 0, rawError: "OpenAI returned empty response" });
    const verdict = normalizeBundleVerdict(bundle);
    const presentation = presentBundleVerdict(bundle, verdict);
    assert.equal(verdict.completionState, "NC");
    assert.equal(verdict.failureOrigin, "PROVIDER");
    assert.equal(presentation.tier, "NOT_COMPLETE");
    assert.equal(presentation.critical_override, false);
  });
});
