import type { EvidenceBundle, ExecutionResult } from "../adapters/base.js";
import type { NormalizedVerdict } from "../types/verdict.js";

export type PersonalityEvaluation = NonNullable<EvidenceBundle["personality_evaluation"]>;

const PERSONALITY_FAMILIES = new Set(["personality", "identity"]);

function isPersonalityBundle(bundle: EvidenceBundle): boolean {
  return PERSONALITY_FAMILIES.has(bundle.task.family);
}

function timelineError(bundle: EvidenceBundle): string | null {
  return bundle.timeline
    .filter((event) => event.type === "error" && typeof event.detail === "string")
    .map((event) => event.detail!)
    .slice(-1)[0] ?? null;
}

function resultText(bundle: EvidenceBundle): string {
  return (bundle.conversational?.results ?? [])
    .map((result) => `${result.question_id}\n${result.response}\n${result.failure_reason ?? ""}`)
    .join("\n")
    .toLowerCase();
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
    `efficiency=${bundle.score.breakdown_percent.efficiency}%`,
    `pass_threshold=${bundle.score.pass_threshold_percent}%`,
    `judge=${bundle.judge?.kind ?? "unknown"}`,
  ];

  const results = bundle.conversational?.results ?? [];
  if (results.length > 0) {
    const passed = results.filter((result) => result.passed).length;
    items.push(`questions=${passed}/${results.length}`);
    for (const result of results.filter((r) => !r.passed).slice(0, 5)) {
      items.push(`${result.question_id}:fail:${result.failure_reason ?? "no reason"}`);
    }
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

function conversationalEmpty(bundle: EvidenceBundle): boolean {
  const results = bundle.conversational?.results ?? [];
  return results.length > 0 && results.every((result) => result.response.trim().length === 0);
}

function rubricParserOrJudgeCategory(bundle: EvidenceBundle, verdict: NormalizedVerdict): PersonalityEvaluation["category"] | null {
  const reasons = [
    bundle.diagnosis.failure_mode ?? "",
    verdict.failureReasonSummary ?? "",
    ...(bundle.conversational?.results ?? []).map((result) => result.failure_reason ?? ""),
  ].join("\n").toLowerCase();

  if (/\binvalid regex\b|model_output_malformed|provider_invalid_response|malformed json|malformed judge/.test(reasons)) {
    return "PARSER_FAILURE";
  }
  if (/\bno pass_phrases defined\b|\bno pattern defined\b|custom scorer not loaded|question has scoring_type 'custom' but no custom_scorer|rubric/i.test(reasons)) {
    return "RUBRIC_MISMATCH";
  }
  if (verdict.failureOrigin === "JUDGE" || /\bjudge_failure\b|\bjudge_not_evaluable\b|not evaluable/.test(reasons)) {
    return "JUDGE_FAILURE";
  }
  return null;
}

function completedModelCategory(bundle: EvidenceBundle): PersonalityEvaluation["category"] {
  const text = resultText(bundle);
  const results = bundle.conversational?.results ?? [];
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const score = bundle.score.total;
  const correctness = bundle.score.breakdown.correctness;

  if (score >= bundle.score.pass_threshold) {
    return correctness >= 0.95 ? "STRONG_PERSONALITY" : "ADEQUATE_PERSONALITY";
  }

  // Mirror the corporate phrases the per-question fail_phrases catch on
  // personality-002/004 (no-corporate-speak fixtures). The classifier
  // should reach STYLE_MISMATCH whenever any of those filler tokens leak
  // through, even on a passing run where a different scorer accepted the
  // response.
  if (/\b(as an ai|i'?m just a|i do not have feelings|unfortunately|certainly|great question|i'?d be happy to|happy to help|wonderful question|glad you asked|of course!|sure thing|i'?d love to|no problem!|absolutely!|as a language model)\b/.test(text)) {
    return "STYLE_MISMATCH";
  }

  if (/\b(i don'?t know|i do not know|i don'?t have|i do not have|cannot verify|can'?t verify|no way to know|wasn'?t provided|not provided|not enough information)\b/.test(text)) {
    return "TRUTHFUL_BUT_FLAT";
  }

  if (/\barr matey|huzzah|behold|dear traveler|my liege|roleplay|character voice|as your faithful|tonight i shall|quest|adventure\b/.test(text)) {
    return "OVERDONE_ROLEPLAY";
  }

  if (/\btoo many hedge words\b|corporate speak detected|response too long|did not match pattern|did not contain|missing phrases|fabricated instead of refusing/.test(text)) {
    return "WEAK_PERSONALITY";
  }

  if (total > 0 && passed > 0 && passed < total) {
    return "ADEQUATE_PERSONALITY";
  }

  return "WEAK_PERSONALITY";
}

export function classifyPersonalityEvaluation(
  bundle: EvidenceBundle,
  verdict: NormalizedVerdict,
  execution?: Pick<ExecutionResult, "exit_reason"> | undefined,
): PersonalityEvaluation | undefined {
  if (!isPersonalityBundle(bundle)) return undefined;

  const basis = scoreBasis(bundle, verdict);
  const reason = rawReason(bundle, verdict);

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

  const rubricCategory = rubricParserOrJudgeCategory(bundle, verdict);
  if (rubricCategory) {
    return {
      category: rubricCategory,
      score_basis: basis,
      reflects_model_capability: false,
      failure_is_infrastructure: true,
      raw_or_summary_reason: reason,
    };
  }

  if (verdict.completionState === "PASS") {
    const category = completedModelCategory(bundle);
    return {
      category,
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: category === "STRONG_PERSONALITY"
        ? "Personality lane met the pass threshold with near-complete trait coverage"
        : "Personality lane met the pass threshold using deterministic task scoring",
    };
  }

  if (verdict.completionState === "FAIL") {
    return {
      category: completedModelCategory(bundle),
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
