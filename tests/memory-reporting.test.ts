import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import { classifyMemoryEvaluation } from "../core/memory-reporting.js";
import { normalizeVerdict } from "../core/verdict.js";
import { summarizeBundle } from "../server/contracts.js";

type MemoryResult = NonNullable<EvidenceBundle["conversational"]>["results"][number];

function result(overrides: Partial<MemoryResult> = {}): MemoryResult {
  return {
    question_id: "M-Q",
    question: "What did I ask you to remember?",
    response: "ember-owl",
    passed: true,
    score: 1,
    weight: 1,
    failure_reason: null,
    duration_ms: 1,
    tokens_in: 1,
    tokens_out: 1,
    ...overrides,
  };
}

function score(total: number, pass = total >= 0.8): EvidenceBundle["score"] {
  return {
    scale: "fraction_0_1",
    total,
    total_percent: Math.round(total * 100),
    breakdown: { correctness: total, regression: 1, integrity: 1, efficiency: 1 },
    breakdown_percent: { correctness: Math.round(total * 100), regression: 100, integrity: 100, efficiency: 100 },
    pass,
    pass_threshold: 0.8,
    pass_threshold_percent: 80,
    integrity_violations: 0,
  };
}

function memoryBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const bundleScore = overrides.score ?? score(1, true);
  const pass = bundleScore.pass;
  return {
    bundle_id: "run_memory_unit",
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: {
      id: "memory-001",
      manifest_hash: "sha256:m",
      family: "memory",
      difficulty: "medium",
      benchmark_provenance: {
        source: "unit",
        public_status: "private",
        oracle_visibility: "public",
        gold_solution_visibility: "not_applicable",
        contamination_risk: "low",
        known_scoring_limitations: ["unit memory fixture"],
      },
    },
    agent: { adapter: "unit", adapter_version: "1.0.0", system: "unit", system_version: "1.0.0", model: "unit-model", model_version: "latest", provider: "unit-provider" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc", crucibulum_version: "1.0.0", timestamp_start: "2026-05-16T00:00:00.000Z", timestamp_end: "2026-05-16T00:00:01.000Z" },
    timeline: [{ t: 0, type: "task_start", detail: "memory_session:memory-unit:resume=false" }, { t: 1, type: "task_complete", detail: "done" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: bundleScore.breakdown.correctness, details: {}, command_results: [] },
      regression: { score: 1, details: {}, command_results: [] },
      integrity: { score: 1, details: {}, violations: [] },
      efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 4, score: 1 },
    },
    score: bundleScore,
    usage: { tokens_in: 8, tokens_out: 8, estimated_cost_usd: 0, provider_cost_note: "unit" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "unit", verifier_model: null, components: ["conversational-judge"] },
    trust: { rubric_hidden: false, narration_ignored: false, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: pass, avoided_decoys: true, first_fix_correct: pass, self_verified: false, failure_mode: pass ? null : "conversational_failure" },
    conversational: { results: [result()] },
    ...overrides,
  };
}

function classify(bundle: EvidenceBundle, exitReason = "complete", rawError?: string) {
  const verdict = normalizeVerdict({ bundle, executionMode: "conversational", exitReason, rawError: rawError ?? null });
  return classifyMemoryEvaluation(bundle, verdict, { exit_reason: exitReason as never })!;
}

describe("memory result classification goldens", () => {
  it("classifies correct recall as PASS", () => {
    const evaluation = classify(memoryBundle());
    assert.equal(evaluation.category, "PASS");
    assert.match(evaluation.score_basis.join(" "), /memory_operation=recall/);
    assert.match(evaluation.score_basis.join(" "), /session=memory-unit/);
  });

  it("classifies partial recall separately from complete recall failure", () => {
    const evaluation = classify(memoryBundle({
      score: score(0.5, false),
      conversational: {
        results: [
          result({ question_id: "M1-Q1", passed: true, score: 1, weight: 1, response: "ember-owl" }),
          result({ question_id: "M1-Q2", passed: false, score: 0, weight: 1, response: "I do not know", failure_reason: "Did not recall expected phrase. Expected one of: [Cobalt-9]." }),
        ],
      },
    }));
    assert.equal(evaluation.category, "PARTIAL");
  });

  it("classifies no recall as RECALL_FAILURE", () => {
    const evaluation = classify(memoryBundle({
      score: score(0, false),
      conversational: { results: [result({ passed: false, score: 0, response: "I do not remember", failure_reason: "Did not recall expected phrase. Expected one of: [ember-owl]." })] },
    }));
    assert.equal(evaluation.category, "RECALL_FAILURE");
  });

  it("classifies update old-to-new success as PASS and retained old value as UPDATE_FAILURE", () => {
    assert.equal(classify(memoryBundle({
      task: { ...memoryBundle().task, id: "memory-003" },
      conversational: { results: [result({ question_id: "M3-Q1", question: "Correction: Thursday at 11 AM. Was there a contradiction?", response: "Thursday at 11 AM; yes, that contradicts the earlier Tuesday time." })] },
    })).category, "PASS");

    assert.equal(classify(memoryBundle({
      task: { ...memoryBundle().task, id: "memory-003" },
      score: score(0, false),
      conversational: { results: [result({ question_id: "M3-Q1", passed: false, score: 0, response: "Tuesday at 3 PM", failure_reason: "old value retained; contradiction missed" })] },
    })).category, "UPDATE_FAILURE");
  });

  it("classifies honest unknown as PASS and fabricated forgotten facts as FORGET_FAILURE", () => {
    assert.equal(classify(memoryBundle({
      task: { ...memoryBundle().task, id: "memory-002" },
      conversational: { results: [result({ question_id: "M2-Q1", question: "What city did I say I was born in?", response: "I wasn't told that." })] },
    })).category, "PASS");

    assert.equal(classify(memoryBundle({
      task: { ...memoryBundle().task, id: "memory-002" },
      score: score(0, false),
      conversational: { results: [result({ question_id: "M2-Q1", passed: false, score: 0, response: "You were born in Denver.", failure_reason: "Fabricated instead of refusing." })] },
    })).category, "FORGET_FAILURE");
  });

  it("classifies scope leak and context-only false pass signatures", () => {
    assert.equal(classify(memoryBundle({
      score: score(0, false),
      conversational: { results: [result({ passed: false, score: 0, response: "Other user's remembered value", failure_reason: "scope leak: wrong session/user" })] },
    })).category, "SCOPE_LEAK");

    assert.equal(classify(memoryBundle({
      score: score(0, false),
      conversational: { results: [result({ passed: false, score: 0, response: "I can answer because it is in the same prompt", failure_reason: "context-only, not memory" })] },
    })).category, "CONTEXT_ONLY_NOT_MEMORY");
  });

  it("classifies empty response and provider failure as non-capability results", () => {
    const empty = classify(memoryBundle({
      score: score(0, false),
      conversational: { results: [result({ response: "", passed: false, score: 0, failure_reason: "Empty model answer" })] },
    }));
    assert.equal(empty.category, "EMPTY_RESPONSE");
    assert.equal(empty.failure_is_infrastructure, true);

    const provider = memoryBundle({ timeline: [{ t: 0, type: "error", detail: "Provider returned HTTP 500" }] });
    const providerVerdict = normalizeVerdict({ bundle: provider, executionMode: "conversational", exitReason: "error", rawError: "Provider returned HTTP 500" });
    assert.equal(classifyMemoryEvaluation(provider, providerVerdict, { exit_reason: "error" })!.category, "PROVIDER_FAILURE");
  });

  it("classifies timeout and rubric/parser defects separately", () => {
    assert.equal(classify(memoryBundle(), "timeout").category, "TIMEOUT");
    assert.equal(classify(memoryBundle({
      score: score(0, false),
      diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "Invalid regex pattern: [" },
    })).category, "PARSER_FAILURE");
    assert.equal(classify(memoryBundle({
      score: score(0, false),
      diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "No pass_phrases defined for recall check" },
    })).category, "RUBRIC_MISMATCH");
  });

  it("surfaces memory_evaluation through the API summary contract", () => {
    const bundle = memoryBundle();
    const verdict = normalizeVerdict({ bundle, executionMode: "conversational", exitReason: "complete" });
    bundle.verdict = verdict;
    bundle.memory_evaluation = classifyMemoryEvaluation(bundle, verdict);
    const summary = summarizeBundle(bundle);
    assert.equal(summary.outcome.memory_evaluation?.category, "PASS");
    assert.equal(summary.target.provider, "unit-provider");
    assert.equal(summary.target.model, "unit-model");
  });
});
