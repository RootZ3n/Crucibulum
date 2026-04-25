import type { EvidenceBundle } from "../adapters/base.js";
import type { NormalizedVerdict } from "../types/verdict.js";
import { normalizeBundleVerdict } from "./verdict.js";

export type ResultInterpretation = NonNullable<EvidenceBundle["interpretation"]>;

function durationMs(bundle: EvidenceBundle): number {
  return Math.max(0, new Date(bundle.environment.timestamp_end).getTime() - new Date(bundle.environment.timestamp_start).getTime());
}

function evidenceSummary(bundle: EvidenceBundle, verdict: NormalizedVerdict): string {
  if (verdict.evidence.providerError) {
    const err = verdict.evidence.providerError;
    return `${err.origin}:${err.kind}${err.statusCode ? `:${err.statusCode}` : ""}`;
  }
  const failedChecks = Object.entries(bundle.verification_results.correctness.details ?? {})
    .filter(([, status]) => status === "fail")
    .map(([id]) => id);
  if (failedChecks.length > 0) return `Failed checks: ${failedChecks.slice(0, 3).join(", ")}${failedChecks.length > 3 ? ", ..." : ""}`;
  if (bundle.diagnosis.failure_mode) return bundle.diagnosis.failure_mode;
  return `Score ${bundle.score.total_percent}% / threshold ${bundle.score.pass_threshold_percent}%`;
}

export function interpretBundleResult(bundle: EvidenceBundle): ResultInterpretation {
  const verdict = normalizeBundleVerdict(bundle);
  const attempts = bundle.provider_attempts ?? [];
  const hadRetry = attempts.some((attempt) => attempt.retry_decision === "retry");
  const providerAffected = hadRetry || verdict.failureOrigin === "PROVIDER" || verdict.failureOrigin === "NETWORK";
  const cost = (bundle.usage.estimated_cost_usd ?? 0) + (bundle.judge_usage?.estimated_cost_usd ?? 0);
  const ms = durationMs(bundle);

  if (verdict.completionState === "PASS") {
    return {
      verdict: "pass",
      reason: hadRetry ? "Run passed after at least one provider retry." : "Run completed and passed the evaluation.",
      evidence_summary: evidenceSummary(bundle, verdict),
      reflects_model_capability: true,
      provider_or_retry_affected_confidence: hadRetry,
      cost_usd: cost,
      duration_ms: ms,
      recommended_interpretation: hadRetry
        ? "Treat this as a pass with partial provider confidence because retry recovered a transient failure."
        : "Treat this as evidence for this task only, not a broad safety or capability guarantee.",
    };
  }

  if (verdict.completionState === "FAIL" && verdict.failureOrigin === "MODEL") {
    return {
      verdict: "fail",
      reason: verdict.failureReasonSummary,
      evidence_summary: evidenceSummary(bundle, verdict),
      reflects_model_capability: true,
      provider_or_retry_affected_confidence: hadRetry,
      cost_usd: cost,
      duration_ms: ms,
      recommended_interpretation: hadRetry
        ? "Treat this as a model failure with reduced confidence because provider retries occurred."
        : "Treat this as a model failure on the measured task, not as a claim about every use case.",
    };
  }

  if (verdict.failureOrigin === "PROVIDER" || verdict.failureOrigin === "NETWORK") {
    return {
      verdict: "provider-failed",
      reason: verdict.failureReasonSummary,
      evidence_summary: evidenceSummary(bundle, verdict),
      reflects_model_capability: false,
      provider_or_retry_affected_confidence: true,
      cost_usd: cost,
      duration_ms: ms,
      recommended_interpretation: "Do not treat this as model quality; rerun after the provider or network issue is resolved.",
    };
  }

  if (verdict.failureOrigin === "JUDGE" || verdict.failureOrigin === "TEST") {
    return {
      verdict: "judge-failed",
      reason: verdict.failureReasonSummary,
      evidence_summary: evidenceSummary(bundle, verdict),
      reflects_model_capability: false,
      provider_or_retry_affected_confidence: providerAffected,
      cost_usd: cost,
      duration_ms: ms,
      recommended_interpretation: "Do not score the model from this run; fix the evaluator or test harness first.",
    };
  }

  return {
    verdict: verdict.failureOrigin === "HARNESS" ? "runner-failed" : "skipped",
    reason: verdict.failureReasonSummary,
    evidence_summary: evidenceSummary(bundle, verdict),
    reflects_model_capability: false,
    provider_or_retry_affected_confidence: providerAffected,
    cost_usd: cost,
    duration_ms: ms,
    recommended_interpretation: "Do not treat this as model quality; inspect runner diagnostics and rerun when the harness is healthy.",
  };
}
