import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import { classifyPersonalityEvaluation } from "../core/personality-reporting.js";
import { normalizeVerdict } from "../core/verdict.js";
import { summarizeBundle } from "../server/contracts.js";

function personalityBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const pass = overrides.score?.pass ?? false;
  const total = overrides.score?.total ?? (pass ? 1 : 0);
  return {
    bundle_id: "run_personality_unit",
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: {
      id: "personality-unit",
      manifest_hash: "sha256:m",
      family: "personality",
      difficulty: "medium",
      benchmark_provenance: {
        source: "unit",
        public_status: "private",
        oracle_visibility: "public",
        gold_solution_visibility: "not_applicable",
        contamination_risk: "low",
        known_scoring_limitations: ["unit fixture"],
      },
    },
    agent: { adapter: "unit", adapter_version: "1.0.0", system: "unit", system_version: "1.0.0", model: "unit-model", model_version: "latest", provider: "unit-provider" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc", crucibulum_version: "1.0.0", timestamp_start: "2026-05-16T00:00:00.000Z", timestamp_end: "2026-05-16T00:00:01.000Z" },
    timeline: [{ t: 0, type: "task_complete", detail: "done" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: total, details: {}, command_results: [] },
      regression: { score: total > 0 ? 1 : 0, details: {}, command_results: [] },
      integrity: { score: 1, details: {}, violations: [] },
      efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 4, score: 1 },
    },
    score: {
      scale: "fraction_0_1",
      total,
      total_percent: Math.round(total * 100),
      breakdown: { correctness: total, regression: total > 0 ? 1 : 0, integrity: 1, efficiency: 1 },
      breakdown_percent: { correctness: Math.round(total * 100), regression: total > 0 ? 100 : 0, integrity: 100, efficiency: 100 },
      pass,
      pass_threshold: 0.7,
      pass_threshold_percent: 70,
      integrity_violations: 0,
    },
    usage: { tokens_in: 8, tokens_out: 8, estimated_cost_usd: 0, provider_cost_note: "unit" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "unit", verifier_model: null, components: ["unit"] },
    trust: { rubric_hidden: false, narration_ignored: false, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: pass, avoided_decoys: true, first_fix_correct: pass, self_verified: false, failure_mode: pass ? null : "conversational_failure" },
    conversational: {
      results: [
        { question_id: "P-Q", question: "Debug this without corporate filler.", response: "wrong", passed: false, score: 0, weight: 1, failure_reason: "Corporate speak detected: [certainly]", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
      ],
    },
    ...overrides,
  };
}

function classify(bundle: EvidenceBundle, exitReason = "complete") {
  const verdict = normalizeVerdict({ bundle, executionMode: "conversational", exitReason });
  return classifyPersonalityEvaluation(bundle, verdict, { exit_reason: exitReason as never })!;
}

describe("personality result classification goldens", () => {
  it("classifies strong but useful personality as STRONG_PERSONALITY", () => {
    const result = classify(personalityBundle({
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
      conversational: {
        results: [
          { question_id: "P-Q", question: "Pick Fastify or Express.", response: "Use Fastify. It is the cleaner default for a new API.", passed: true, score: 1, weight: 1, failure_reason: null, duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "STRONG_PERSONALITY");
    assert.equal(result.reflects_model_capability, true);
  });

  it("classifies concise but on-brand passing output as ADEQUATE_PERSONALITY, not a style failure", () => {
    const result = classify(personalityBundle({
      score: {
        scale: "fraction_0_1",
        total: 0.75,
        total_percent: 75,
        breakdown: { correctness: 0.75, regression: 1, integrity: 1, efficiency: 1 },
        breakdown_percent: { correctness: 75, regression: 100, integrity: 100, efficiency: 100 },
        pass: true,
        pass_threshold: 0.7,
        pass_threshold_percent: 70,
        integrity_violations: 0,
      },
      conversational: {
        results: [
          { question_id: "P-Q1", question: "yes/no", response: "Yes.", passed: true, score: 1, weight: 1, failure_reason: null, duration_ms: 1, tokens_in: 1, tokens_out: 1 },
          { question_id: "P-Q2", question: "style", response: "Use Fastify.", passed: false, score: 0, weight: 1, failure_reason: "Too many hedge words (4): [maybe]", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "ADEQUATE_PERSONALITY");
  });

  it("classifies bland generic assistant output as STYLE_MISMATCH", () => {
    const result = classify(personalityBundle({
      conversational: {
        results: [
          { question_id: "P-Q", question: "debug", response: "Certainly, great question. I'd be happy to help you debug this.", passed: false, score: 0, weight: 1, failure_reason: "Corporate speak detected: [certainly, great question]", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "STYLE_MISMATCH");
  });

  it("classifies truthful but flat refusals separately from bad personality", () => {
    const result = classify(personalityBundle({
      score: {
        scale: "fraction_0_1",
        total: 0.3,
        total_percent: 30,
        breakdown: { correctness: 0.3, regression: 1, integrity: 1, efficiency: 1 },
        breakdown_percent: { correctness: 30, regression: 100, integrity: 100, efficiency: 100 },
        pass: false,
        pass_threshold: 0.7,
        pass_threshold_percent: 70,
        integrity_violations: 0,
      },
      conversational: {
        results: [
          { question_id: "P-Q", question: "What was in receipt X?", response: "I don't know. I cannot verify that receipt.", passed: false, score: 0, weight: 1, failure_reason: "Did not preserve useful personality", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "TRUTHFUL_BUT_FLAT");
  });

  it("classifies overdone roleplay that ignores task as OVERDONE_ROLEPLAY", () => {
    const result = classify(personalityBundle({
      conversational: {
        results: [
          { question_id: "P-Q", question: "debug", response: "Behold, dear traveler, tonight I shall embark upon a quest instead of debugging.", passed: false, score: 0, weight: 1, failure_reason: "Response did not answer the task", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "OVERDONE_ROLEPLAY");
  });

  it("does not give full personality credit to funny but wrong output", () => {
    const result = classify(personalityBundle({
      conversational: {
        results: [
          { question_id: "P-Q", question: "What port?", response: "18792. Nailed it.", passed: false, score: 0, weight: 1, failure_reason: "Response did not contain any of: [18791]", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.notEqual(result.category, "STRONG_PERSONALITY");
    assert.equal(result.reflects_model_capability, true);
  });

  it("classifies empty responses as EMPTY_RESPONSE, not personality 0", () => {
    const result = classify(personalityBundle({
      conversational: {
        results: [
          { question_id: "P-Q", question: "debug", response: "", passed: false, score: 0, weight: 1, failure_reason: "Empty model answer", duration_ms: 1, tokens_in: 1, tokens_out: 0 },
        ],
      },
    }));
    assert.equal(result.category, "EMPTY_RESPONSE");
    assert.equal(result.failure_is_infrastructure, true);
  });

  it("classifies provider failure and timeout separately from personality failure", () => {
    const provider = personalityBundle({ timeline: [{ t: 0, type: "error", detail: "Provider returned HTTP 500" }] });
    const providerVerdict = normalizeVerdict({ bundle: provider, executionMode: "conversational", exitReason: "error", rawError: "Provider returned HTTP 500" });
    assert.equal(classifyPersonalityEvaluation(provider, providerVerdict, { exit_reason: "error" })!.category, "PROVIDER_FAILURE");

    const timedOut = personalityBundle({ timeline: [{ t: 0, type: "error", detail: "provider timed out" }] });
    const timeoutVerdict = normalizeVerdict({ bundle: timedOut, executionMode: "conversational", exitReason: "timeout" });
    assert.equal(classifyPersonalityEvaluation(timedOut, timeoutVerdict, { exit_reason: "timeout" })!.category, "TIMEOUT");
  });

  it("classifies parser, rubric, and judge failures distinctly", () => {
    assert.equal(classify(personalityBundle({
      diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "Invalid regex pattern: [" },
    })).category, "PARSER_FAILURE");

    assert.equal(classify(personalityBundle({
      diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "No pattern defined for regex_match" },
    })).category, "RUBRIC_MISMATCH");

    const judgeBundle = personalityBundle({
      verification_results: {
        correctness: { score: 0, details: {}, not_evaluable: true, command_results: [] },
        regression: { score: 0, details: {}, command_results: [] },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 120, steps_used: 1, steps_limit: 4, score: 1 },
      },
    });
    assert.equal(classify(judgeBundle).category, "JUDGE_FAILURE");
  });

  it("surfaces personality_evaluation through the API summary contract", () => {
    const bundle = personalityBundle({
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
    });
    const verdict = normalizeVerdict({ bundle, executionMode: "conversational", exitReason: "complete" });
    bundle.verdict = verdict;
    bundle.personality_evaluation = classifyPersonalityEvaluation(bundle, verdict);
    const summary = summarizeBundle(bundle);
    assert.equal(summary.outcome.personality_evaluation?.category, "STRONG_PERSONALITY");
    assert.equal(summary.target.provider, "unit-provider");
    assert.equal(summary.target.model, "unit-model");
  });
});
