import type { EvidenceBundle, ExecutionResult } from "../adapters/base.js";
import type { NormalizedVerdict } from "../types/verdict.js";

export type MemoryEvaluation = NonNullable<EvidenceBundle["memory_evaluation"]>;

function isMemoryBundle(bundle: EvidenceBundle): boolean {
  return bundle.task.family === "memory";
}

function timelineError(bundle: EvidenceBundle): string | null {
  return bundle.timeline
    .filter((event) => event.type === "error" && typeof event.detail === "string")
    .map((event) => event.detail!)
    .slice(-1)[0] ?? null;
}

function resultText(bundle: EvidenceBundle): string {
  return (bundle.conversational?.results ?? [])
    .map((result) => `${result.question_id}\n${result.question}\n${result.response}\n${result.failure_reason ?? ""}`)
    .join("\n")
    .toLowerCase();
}

function memoryOperation(bundle: EvidenceBundle): "recall" | "update" | "forget" | "scope" | "unknown" {
  // Task-id check FIRST so memory-003 failures whose scorer text happens
  // to mention "did not recall expected phrase" don't get misclassified
  // as recall when the fixture is an update operation. The earlier
  // regex-first ordering caused memory_operation=recall on every memory-003
  // failure even though the category (separately computed) was UPDATE_FAILURE.
  const taskId = bundle.task.id;
  if (taskId === "memory-001") return "recall";
  if (taskId === "memory-002") return "forget";
  if (taskId === "memory-003") return "update";

  const text = resultText(bundle);
  if (/\bember owl\b|\bcobalt 9\b|did not recall expected phrase/.test(text)) return "recall";
  if (/\bfabricated instead of refusing\b|wasn'?t told|don'?t know|never mentioned/.test(text)) return "forget";
  if (/\bcontradiction\b|\bcorrect(?:ion)?\b|\batlas\b|\bbeacon\b/.test(text)) return "update";
  return "unknown";
}

function scoreBasis(bundle: EvidenceBundle, verdict: NormalizedVerdict): string[] {
  const items = [
    `family=${bundle.task.family}`,
    `task=${bundle.task.id}`,
    `memory_operation=${memoryOperation(bundle)}`,
    `session=${sessionIdFromTimeline(bundle) ?? "unknown"}`,
    `provider=${bundle.agent.provider}`,
    `model=${bundle.agent.model}`,
    `verdict=${verdict.completionState}:${verdict.failureOrigin ?? "NONE"}:${verdict.failureReasonCode}`,
    `composite_score=${bundle.score.total_percent}%`,
    `correctness=${bundle.score.breakdown_percent.correctness}%`,
    `efficiency=${bundle.score.breakdown_percent.efficiency}%`,
    `pass_threshold=${bundle.score.pass_threshold_percent}%`,
    `judge=${bundle.judge?.kind ?? "unknown"}`,
  ];

  const results = bundle.conversational?.results ?? [];
  if (results.length > 0) {
    const passed = results.filter((result) => result.passed).length;
    items.push(`questions=${passed}/${results.length}`);
    for (const result of results.filter((r) => !r.passed).slice(0, 6)) {
      items.push(`${result.question_id}:fail:${result.failure_reason ?? "no reason"}`);
    }
  }
  if (bundle.diagnosis.failure_mode) items.push(`diagnosis=${bundle.diagnosis.failure_mode}`);
  return items;
}

function sessionIdFromTimeline(bundle: EvidenceBundle): string | null {
  for (const event of bundle.timeline) {
    const detail = typeof event.detail === "string" ? event.detail : "";
    const directMatch = detail.match(/memory_session:([^:]+):/);
    if (directMatch?.[1]) return directMatch[1];
    const match = detail.match(/session_resume:([^:]+):/);
    if (match?.[1]) return match[1];
  }
  return null;
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

function rubricOrParserCategory(bundle: EvidenceBundle, verdict: NormalizedVerdict): MemoryEvaluation["category"] | null {
  const reasons = [
    bundle.diagnosis.failure_mode ?? "",
    verdict.failureReasonSummary ?? "",
    ...(bundle.conversational?.results ?? []).map((result) => result.failure_reason ?? ""),
  ].join("\n").toLowerCase();

  if (/\binvalid regex\b|model_output_malformed|provider_invalid_response|malformed json|parser/.test(reasons)) return "PARSER_FAILURE";
  // Require a phrase that names a rubric *bug*. Bare /rubric/ was firing
  // on innocuous mentions like "rubric-based judging" and hiding real
  // model failures as infrastructure (same regression as build / safety
  // earlier).
  if (/\bno pass_phrases defined\b|\bno pattern defined\b|custom scorer not loaded|question has scoring_type 'custom' but no custom_scorer|\brubric mismatch\b|\brubric not evaluable\b/i.test(reasons)) {
    return "RUBRIC_MISMATCH";
  }
  return null;
}

function completedMemoryCategory(bundle: EvidenceBundle): MemoryEvaluation["category"] {
  const text = resultText(bundle);
  const results = bundle.conversational?.results ?? [];
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const op = memoryOperation(bundle);

  if (bundle.score.total >= bundle.score.pass_threshold || bundle.score.pass) return "PASS";
  if (passed > 0 && passed < total) return "PARTIAL";

  if (/\bscope leak\b|wrong session|other user|different user|cross[- ]session/.test(text)) return "SCOPE_LEAK";
  if (/\bstale memory\b|contamination|contaminated|previous run|old transcript/.test(text)) return "STALE_MEMORY_CONTAMINATION";
  if (/\bcontext[- ]only\b|not memory\b|same prompt\b|same context window/.test(text)) return "CONTEXT_ONLY_NOT_MEMORY";
  if (op === "update" || /\bcontradiction\b|old value|retained old|beacon all along/.test(text)) return "UPDATE_FAILURE";
  if (op === "forget" || /\bfabricated instead of refusing\b|guessed|made up|hallucinated/.test(text)) return "FORGET_FAILURE";
  if (op === "recall" || /\bdid not recall expected phrase\b|missing phrases|did not contain/.test(text)) return "RECALL_FAILURE";
  return "UNKNOWN";
}

export function classifyMemoryEvaluation(
  bundle: EvidenceBundle,
  verdict: NormalizedVerdict,
  execution?: Pick<ExecutionResult, "exit_reason"> | undefined,
): MemoryEvaluation | undefined {
  if (!isMemoryBundle(bundle)) return undefined;

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

  const rubricCategory = rubricOrParserCategory(bundle, verdict);
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
    return {
      category: "PASS",
      score_basis: basis,
      reflects_model_capability: true,
      failure_is_infrastructure: false,
      raw_or_summary_reason: `Memory lane passed ${memoryOperation(bundle)} checks using deterministic scoring`,
    };
  }

  if (verdict.completionState === "FAIL") {
    return {
      category: completedMemoryCategory(bundle),
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
