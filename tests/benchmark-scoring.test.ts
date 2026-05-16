import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ConversationalQuestion, EvidenceBundle } from "../adapters/base.js";
import { scoreConversationalQuestion } from "../core/conversational-judge.js";
import { classifyBenchmarkEvaluation } from "../core/benchmark-reporting.js";
import { normalizeVerdict } from "../core/verdict.js";

function benchmarkQuestion(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "BM-Q",
    question: "What is 2 + 2?",
    scoring_type: "text_match",
    pass_phrases: ["4", "four"],
    weight: 1,
    tags: ["benchmark"],
    ...overrides,
  };
}

function benchmarkBundle(overrides: Partial<EvidenceBundle> = {}): EvidenceBundle {
  const pass = overrides.score?.pass ?? false;
  const total = overrides.score?.total ?? (pass ? 1 : 0);
  return {
    bundle_id: "run_benchmark_unit",
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: {
      id: "truthfulness-unit",
      manifest_hash: "sha256:m",
      family: "truthfulness",
      difficulty: "easy",
      benchmark_provenance: {
        source: "unit",
        public_status: "private",
        oracle_visibility: "hidden",
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
    trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: pass, avoided_decoys: true, first_fix_correct: pass, self_verified: false, failure_mode: pass ? null : "conversational_failure" },
    conversational: {
      results: [
        { question_id: "BM-Q", question: "What is 2 + 2?", response: "wrong", passed: false, score: 0, weight: 1, failure_reason: "Response did not contain any expected answer", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
      ],
    },
    ...overrides,
  };
}

function classify(bundle: EvidenceBundle, exitReason = "complete") {
  const verdict = normalizeVerdict({ bundle, executionMode: "conversational", exitReason });
  return classifyBenchmarkEvaluation(bundle, verdict, { exit_reason: exitReason as never })!;
}

describe("benchmark deterministic scoring goldens", () => {
  it("scores exact correct answers as full credit", () => {
    const scored = scoreConversationalQuestion(benchmarkQuestion(), "4");
    assert.equal(scored.passed, true);
    assert.equal(scored.score, 1);
  });

  it("scores equivalent normalized wording as full credit", () => {
    const scored = scoreConversationalQuestion(benchmarkQuestion(), "The answer is FOUR.");
    assert.equal(scored.passed, true);
  });

  it("scores wrong answers as failures", () => {
    const scored = scoreConversationalQuestion(benchmarkQuestion(), "5");
    assert.equal(scored.passed, false);
    assert.match(scored.failure_reason ?? "", /did not contain/i);
  });

  it("parses correct answers inside markdown code fences", () => {
    const scored = scoreConversationalQuestion(
      benchmarkQuestion({ scoring_type: "regex_match", pattern: "^16$" }),
      "```text\n16\n```",
    );
    assert.equal(scored.passed, true);
  });

  it("keeps broad reasoning goldens from passing echoed prompt words", () => {
    const chickens = scoreConversationalQuestion(
      benchmarkQuestion({ id: "RSN1-Q8", scoring_type: "regex_match", pattern: "\\b8\\s+chickens?\\b|\\bchickens?\\s*(?:is|=|:)\\s*8\\b" }),
      "There are 7 chickens.",
    );
    assert.equal(chickens.passed, false);

    const logic = scoreConversationalQuestion(
      benchmarkQuestion({ id: "RSN1-Q2", scoring_type: "regex_match", pattern: "\\bW\\s*(?:is|=|:)\\s*true\\b|\\bvalue\\s+of\\s+W\\s+(?:is|=)\\s*true\\b" }),
      "X is true, but W is false.",
    );
    assert.equal(logic.passed, false);
  });
});

describe("benchmark result classification goldens", () => {
  it("classifies full-score benchmark runs as PASS", () => {
    const result = classify(benchmarkBundle({
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
          { question_id: "BM-Q", question: "What is 2 + 2?", response: "4", passed: true, score: 1, weight: 1, failure_reason: null, duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "PASS");
    assert.equal(result.reflects_model_capability, true);
  });

  it("classifies below-threshold partial credit as PARTIAL", () => {
    const result = classify(benchmarkBundle({
      score: {
        scale: "fraction_0_1",
        total: 0.5,
        total_percent: 50,
        breakdown: { correctness: 0.5, regression: 1, integrity: 1, efficiency: 1 },
        breakdown_percent: { correctness: 50, regression: 100, integrity: 100, efficiency: 100 },
        pass: false,
        pass_threshold: 0.7,
        pass_threshold_percent: 70,
        integrity_violations: 0,
      },
      conversational: {
        results: [
          { question_id: "BM-Q1", question: "easy", response: "correct", passed: true, score: 1, weight: 1, failure_reason: null, duration_ms: 1, tokens_in: 1, tokens_out: 1 },
          { question_id: "BM-Q2", question: "medium", response: "wrong", passed: false, score: 0, weight: 1, failure_reason: "wrong answer", duration_ms: 1, tokens_in: 1, tokens_out: 1 },
        ],
      },
    }));
    assert.equal(result.category, "PARTIAL");
  });

  it("classifies completed zero-score answers as WRONG_ANSWER", () => {
    const result = classify(benchmarkBundle());
    assert.equal(result.category, "WRONG_ANSWER");
    assert.equal(result.failure_is_infrastructure, false);
  });

  it("classifies empty benchmark responses as EMPTY_RESPONSE, not model 0", () => {
    const result = classify(benchmarkBundle({
      conversational: {
        results: [
          { question_id: "BM-Q", question: "What is 2 + 2?", response: "", passed: false, score: 0, weight: 1, failure_reason: "Empty model answer", duration_ms: 1, tokens_in: 1, tokens_out: 0 },
        ],
      },
    }));
    assert.equal(result.category, "EMPTY_RESPONSE");
    assert.equal(result.failure_is_infrastructure, true);
  });

  it("classifies provider timeouts separately from model failures", () => {
    const bundle = benchmarkBundle({
      timeline: [{ t: 0, type: "error", detail: "provider timed out" }],
    });
    const verdict = normalizeVerdict({ bundle, executionMode: "conversational", exitReason: "timeout" });
    const result = classifyBenchmarkEvaluation(bundle, verdict, { exit_reason: "timeout" as never })!;
    assert.equal(result.category, "TIMEOUT");
    assert.equal(result.failure_is_infrastructure, true);
  });

  it("classifies malformed rubric/parser failures distinctly", () => {
    const parser = classify(benchmarkBundle({
      diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "Invalid regex pattern: [" },
    }));
    assert.equal(parser.category, "PARSER_FAILURE");

    const rubric = classify(benchmarkBundle({
      diagnosis: { localized_correctly: false, avoided_decoys: true, first_fix_correct: false, self_verified: false, failure_mode: "No pass_phrases defined for text_match" },
    }));
    assert.equal(rubric.category, "RUBRIC_MISMATCH");
  });
});
