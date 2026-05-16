import type { EvidenceBundle, ExecutionResult } from "../adapters/base.js";
import type { NormalizedVerdict } from "../types/verdict.js";

export type BenchmarkEvaluation = NonNullable<EvidenceBundle["benchmark_evaluation"]>;

const BENCHMARK_FAMILIES = new Set(["spec_discipline", "truthfulness", "cost_efficiency"]);

function isBenchmarkBundle(bundle: EvidenceBundle): boolean {
  return BENCHMARK_FAMILIES.has(bundle.task.family);
}

function timelineError(bundle: EvidenceBundle): string | null {
  return bundle.timeline
    .filter((event) => event.type === "error" && typeof event.detail === "string")
    .map((event) => event.detail!)
    .slice(-1)[0] ?? null;
}

function scoreBasis(bundle: EvidenceBundle, verdict: NormalizedVerdict): string[] {
  const items = [
    `family=${bundle.task.family}`,
    `task=${bundle.task.id}`,
    `provider=${bundle.agent.provider}`,
    `model=${bundle.agent.model}`,
    `verdict=${verdict.completionState}:${verdict.failureOrigin ?? "NONE"}:${verdict.failureReasonCode}`,
    `score=${bundle.score.total_percent}%`,
    `correctness=${bundle.score.breakdown_percent.correctness}%`,
    `regression=${bundle.score.breakdown_percent.regression}%`,
    `integrity=${bundle.score.breakdown_percent.integrity}%`,
    `efficiency=${bundle.score.breakdown_percent.efficiency}%`,
    `pass_threshold=${bundle.score.pass_threshold_percent}%`,
    `judge=${bundle.judge?.kind ?? "unknown"}`,
  ];

  const results = bundle.conversational?.results ?? [];
  if (results.length > 0) {
    const passed = results.filter((result) => result.passed).length;
    items.push(`questions=${passed}/${results.length}`);
    for (const result of results.filter((r) => !r.passed).slice(0, 4)) {
      items.push(`${result.question_id}:fail:${result.failure_reason ?? "no reason"}`);
    }
  }

  for (const result of bundle.verification_results.correctness.command_results?.filter((r) => r.status !== "pass").slice(0, 4) ?? []) {
    items.push(`correctness:${result.id}:${result.status}:${result.summary}`);
  }
  for (const result of bundle.verification_results.regression.command_results?.filter((r) => r.status !== "pass").slice(0, 4) ?? []) {
    items.push(`regression:${result.id}:${result.status}:${result.summary}`);
  }
  for (const violation of bundle.verification_results.integrity.violations.slice(0, 4)) {
    items.push(`integrity_violation=${violation}`);
  }
  if (bundle.diagnosis.failure_mode) items.push(`diagnosis=${bundle.diagnosis.failure_mode}`);
  return items;
}

function rawReason(bundle: EvidenceBundle, verdict: NormalizedVerdict): string {
  return verdict.evidence.rawError
    ?? verdict.evidence.judgeError
    ?? verdict.evidence.testError
    ?? timelineError(bundle)
    ?? verdict.failureReasonSummary
    ?? "No additional reason recorded";
}

function rubricOrParserCategory(bundle: EvidenceBundle): BenchmarkEvaluation["category"] | null {
  const reasons = [
    bundle.diagnosis.failure_mode ?? "",
    ...(bundle.conversational?.results ?? []).map((result) => result.failure_reason ?? ""),
    ...(bundle.verification_results.correctness.command_results ?? []).map((result) => result.summary),
    ...(bundle.verification_results.regression.command_results ?? []).map((result) => result.summary),
  ].join("\n").toLowerCase();

  // PARSER_FAILURE is also reachable through the explicit
  // `verdict.failureReasonCode` checks for `model_output_malformed` and
  // `provider_invalid_response` further down. Keep this regex limited to
  // free-form judge messages (e.g. "Invalid regex pattern: [") that don't
  // surface a structured failure code.
  if (/\binvalid regex\b/.test(reasons)) return "PARSER_FAILURE";
  if (/\bno pass_phrases defined\b|\bno pattern defined\b|custom scorer not loaded|custom scorer threw|not evaluable|oracle.*missing|rubric/i.test(reasons)) {
    return "RUBRIC_MISMATCH";
  }
  if (/\bambiguous fixture\b/.test(reasons)) return "AMBIGUOUS_FIXTURE";
  return null;
}

function conversationalEmpty(bundle: EvidenceBundle): boolean {
  const results = bundle.conversational?.results ?? [];
  return results.length > 0 && results.every((result) => result.response.trim().length === 0);
}

export function classifyBenchmarkEvaluation(
  bundle: EvidenceBundle,
  verdict: NormalizedVerdict,
  execution?: Pick<ExecutionResult, "exit_reason"> | undefined,
): BenchmarkEvaluation | undefined {
  if (!isBenchmarkBundle(bundle)) return undefined;

  const basis = scoreBasis(bundle, verdict);
  const reason = rawReason(bundle, verdict);

  if (verdict.completionState === "PASS") {
    return {
      category: "PASS",
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: "Benchmark met pass threshold using the recorded deterministic scoring basis",
    };
  }

  if (verdict.failureReasonCode === "provider_empty_response" || conversationalEmpty(bundle)) {
    return {
      category: "EMPTY_RESPONSE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureReasonCode === "provider_timeout" || verdict.failureReasonCode === "execution_timeout" || execution?.exit_reason === "timeout") {
    return {
      category: "TIMEOUT",
      score_basis: basis,
      reflects_model_capability: verdict.failureOrigin === "MODEL",
      failure_is_infrastructure: verdict.failureOrigin !== "MODEL",
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureOrigin === "PROVIDER" || verdict.failureOrigin === "NETWORK") {
    return {
      category: "PROVIDER_FAILURE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  const rubricCategory = rubricOrParserCategory(bundle);
  if (rubricCategory) {
    return {
      category: rubricCategory,
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureOrigin === "JUDGE" || bundle.verification_results.correctness.not_evaluable) {
    return {
      category: "RUBRIC_MISMATCH",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.failureReasonCode === "provider_invalid_response" || verdict.failureReasonCode === "model_output_malformed") {
    return {
      category: "PARSER_FAILURE",
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (bundle.score.total > 0 && bundle.score.total < bundle.score.pass_threshold) {
    return {
      category: "PARTIAL",
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: reason,
    };
  }

  // Family-gated to spec_discipline because the no-diff signal is only
  // meaningful in repo-mode tasks. Conversational benchmarks (truthfulness,
  // cost_efficiency) always have an empty diff regardless of whether the
  // model engaged with the question, so the same heuristic would
  // mis-classify any zero-score conversational run.
  if (bundle.score.total === 0 && verdict.completionState === "FAIL" && bundle.task.family === "spec_discipline" && bundle.diff.files_changed.length === 0) {
    return {
      category: "SAFE_BUT_UNHELPFUL",
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: "Repo-mode benchmark completed without infrastructure failure but produced no useful patch",
    };
  }

  if (verdict.completionState === "FAIL") {
    return {
      category: "WRONG_ANSWER",
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: reason,
    };
  }

  return {
    category: "UNKNOWN",
    score_basis: basis,
    reflects_model_capability: verdict.countsTowardModelScore,
    failure_is_infrastructure: verdict.completionState === "NC",
    raw_or_summary_reason: reason,
  };
}
