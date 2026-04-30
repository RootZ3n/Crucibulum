import type { EvidenceBundle } from "../adapters/base.js";
import { verifyBundle } from "../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";
import { normalizeBundleVerdict } from "../core/verdict.js";
import { canonicalPercent } from "../types/scores.js";
import type { NormalizedVerdict } from "../types/verdict.js";

export interface CrucibleLink {
  profile_id: string | null;
  benchmark_score: number | null;
  benchmark_label: string | null;
}

export interface PassAtSummary {
  pass_at_1: boolean;
  pass_at_3: boolean | null;
  pass_at_5: boolean | null;
}

export interface ReliabilitySummary {
  repeated_runs: number;
  pass_rate: number;
  pass_at: PassAtSummary;
  outcome_stability: "single_run" | "consistent" | "mixed";
  review_disagreement_rate: number;
  qc_disagreement_rate: number;
  review_blocked_count: number;
  injection_flagged_runs: number;
  assessment: "stable" | "guarded" | "mixed";
  reasons: string[];
}

export interface RunSetSummary {
  run_count: number;
  passes: number;
  failures: number;
  not_complete: number;
  failed_provider: number;
  failed_runner: number;
  failed_judge: number;
  skipped_config: number;
  pass_rate: number;
  completion_rate: number;
  model_failure_rate: number;
  nc_rate: number;
  pass_at: PassAtSummary;
  avg_score: number;
  total_tokens: number;
  total_cost_usd: number;
  total_time_sec: number;
  disagreement_rate: number;
  qc_disagreement_rate: number;
  review_blocked_rate: number;
  injection_flagged_rate: number;
  reliability: ReliabilitySummary;
}

export interface EvaluationSummary {
  schema: "crucibulum.evaluation.summary.v1";
  bundle_id: string;
  bundle_hash: string;
  task_id: string;
  benchmark_provenance: EvidenceBundle["task"]["benchmark_provenance"] | null;
  oracle_integrity: NonNullable<EvidenceBundle["oracle_integrity"]> | null;
  suite_id: string;
  family: string;
  difficulty: string;
  target: {
    adapter: string;
    provider: string;
    model: string;
  };
  outcome: {
    pass: boolean;
    verdict: NormalizedVerdict;
    score: number;
    score_breakdown: EvidenceBundle["score"]["breakdown"];
    pass_threshold: number;
    integrity_violations: number;
    failure_taxonomy: {
      failure_mode: string | null;
      integrity_violations: string[];
    };
  };
  judge: EvidenceBundle["judge"];
  authority: {
    deterministic_judge_authoritative: true;
    review_layer_advisory: true;
  };
  trust: EvidenceBundle["trust"] & {
    bundle_hash_verified: boolean;
    bundle_authenticated: boolean;
    bundle_signature_status: ReturnType<typeof verifyBundle>["signature_status"];
  };
  usage: {
    tokens_in: number;
    tokens_out: number;
    estimated_cost_usd: number;
    provider_cost_note: string;
  };
  /**
   * Judge model spend, tracked separately from `usage` (which is the model
   * under test). Always present so consumers can render "Judge cost" without
   * branching on undefined; kind: "deterministic" with zero values means no
   * model judge ran.
   */
  judge_usage: {
    provider: string;
    model: string;
    tokens_in: number;
    tokens_out: number;
    estimated_cost_usd: number;
    kind: "deterministic" | "model" | "skipped";
    note: string;
  };
  /** Total = tested-model spend + judge-model spend. Convenience for the UI. */
  total: {
    tokens: number;
    cost_usd: number;
  };
  timing: {
    started_at: string;
    ended_at: string;
    duration_sec: number;
  };
  interpretation: EvidenceBundle["interpretation"] | null;
  repeat_run_count: number;
  pass_at: PassAtSummary;
  reliability: ReliabilitySummary;
  review: EvidenceBundle["review"] | null;
  review_security: EvidenceBundle["review"] extends infer R
    ? R extends { security: infer S }
      ? S | null
      : null
    : null;
  review_input_sanitized: boolean;
  injection_flags_count: number;
  flagged_sources: string[];
  review_blocked_reason: string | null;
  review_output_invalid: boolean;
  trust_boundary_violations: string[];
  integrations: NonNullable<EvidenceBundle["integrations"]>;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function getRelatedBundles(bundles: EvidenceBundle[], bundle: EvidenceBundle): EvidenceBundle[] {
  return bundles
    .filter((candidate) =>
      candidate.task.id === bundle.task.id
      && candidate.agent.adapter === bundle.agent.adapter
      && candidate.agent.provider === bundle.agent.provider
      && candidate.agent.model === bundle.agent.model)
    .sort((a, b) => new Date(a.environment.timestamp_start).getTime() - new Date(b.environment.timestamp_start).getTime());
}

export function summarizeRunSet(bundles: EvidenceBundle[]): RunSetSummary {
  const sorted = [...bundles].sort((a, b) => new Date(a.environment.timestamp_start).getTime() - new Date(b.environment.timestamp_start).getTime());
  const runCount = sorted.length;
  const verdicts = sorted.map((bundle) => normalizeBundleVerdict(bundle));
  const passes = verdicts.filter((verdict) => verdict.completionState === "PASS").length;
  const failures = verdicts.filter((verdict) => verdict.completionState === "FAIL" && verdict.failureOrigin === "MODEL").length;
  const notComplete = verdicts.filter((verdict) => verdict.completionState === "NC").length;
  const failedProvider = verdicts.filter((verdict) => verdict.completionState === "NC" && (verdict.failureOrigin === "PROVIDER" || verdict.failureOrigin === "NETWORK")).length;
  const failedRunner = verdicts.filter((verdict) => verdict.completionState === "NC" && (verdict.failureOrigin === "HARNESS" || verdict.failureOrigin === "UNKNOWN")).length;
  const failedJudge = verdicts.filter((verdict) => verdict.completionState === "NC" && (verdict.failureOrigin === "JUDGE" || verdict.failureOrigin === "TEST")).length;
  const passRate = runCount > 0 ? round4((passes / runCount) * 100) : 0;
  const passAt: PassAtSummary = {
    pass_at_1: sorted[0]?.score.pass ?? false,
    pass_at_3: runCount >= 3 ? sorted.slice(0, 3).some((bundle) => bundle.score.pass) : null,
    pass_at_5: runCount >= 5 ? sorted.slice(0, 5).some((bundle) => bundle.score.pass) : null,
  };
  const totalTokens = sorted.reduce((sum, bundle) => sum + bundle.usage.tokens_in + bundle.usage.tokens_out, 0);
  const totalCostUsd = round4(sorted.reduce((sum, bundle) => sum + bundle.usage.estimated_cost_usd, 0));
  const totalTimeSec = sorted.reduce((sum, bundle) => {
    const started = new Date(bundle.environment.timestamp_start).getTime();
    const ended = new Date(bundle.environment.timestamp_end).getTime();
    return sum + Math.max(0, Math.round((ended - started) / 1000));
  }, 0);
  const avgScore = runCount > 0
    ? round4(canonicalPercent(sorted.reduce((sum, bundle) => sum + bundle.score.total, 0) / runCount))
    : 0;
  const disagreementCount = sorted.filter((bundle) => bundle.review?.secondOpinion?.disagreement || bundle.review?.qcReview?.disagreement).length;
  const qcDisagreementCount = sorted.filter((bundle) => bundle.review?.qcReview?.disagreement).length;
  const reviewBlockedCount = sorted.filter((bundle) => !!bundle.review?.security.review_blocked_reason).length;
  const injectionFlaggedRuns = sorted.filter((bundle) => (bundle.review?.security.injection_flags_count ?? 0) > 0).length;
  const outcomeStability: ReliabilitySummary["outcome_stability"] =
    runCount <= 1 ? "single_run" : (passes === 0 || passes === runCount ? "consistent" : "mixed");

  const reasons: string[] = [];
  if (outcomeStability === "single_run") reasons.push("single_run_only");
  if (outcomeStability === "mixed") reasons.push("repeat_run_variance");
  if (disagreementCount > 0) reasons.push("review_disagreement_present");
  if (reviewBlockedCount > 0) reasons.push("review_blocked_on_security");
  if (injectionFlaggedRuns > 0) reasons.push("injection_flags_detected");

  const assessment: ReliabilitySummary["assessment"] =
    outcomeStability === "mixed"
      ? "mixed"
      : (reviewBlockedCount > 0 || injectionFlaggedRuns > 0 || disagreementCount > 0 || runCount <= 1)
        ? "guarded"
        : "stable";

  return {
    run_count: runCount,
    passes,
    failures,
    not_complete: notComplete,
    failed_provider: failedProvider,
    failed_runner: failedRunner,
    failed_judge: failedJudge,
    skipped_config: 0,
    pass_rate: passRate,
    completion_rate: runCount > 0 ? round4(((runCount - notComplete) / runCount) * 100) : 0,
    model_failure_rate: runCount > 0 ? round4((failures / runCount) * 100) : 0,
    nc_rate: runCount > 0 ? round4((notComplete / runCount) * 100) : 0,
    pass_at: passAt,
    avg_score: avgScore,
    total_tokens: totalTokens,
    total_cost_usd: totalCostUsd,
    total_time_sec: totalTimeSec,
    disagreement_rate: runCount > 0 ? round4(disagreementCount / runCount) : 0,
    qc_disagreement_rate: runCount > 0 ? round4(qcDisagreementCount / runCount) : 0,
    review_blocked_rate: runCount > 0 ? round4(reviewBlockedCount / runCount) : 0,
    injection_flagged_rate: runCount > 0 ? round4(injectionFlaggedRuns / runCount) : 0,
    reliability: {
      repeated_runs: runCount,
      pass_rate: passRate,
      pass_at: passAt,
      outcome_stability: outcomeStability,
      review_disagreement_rate: runCount > 0 ? round4(disagreementCount / runCount) : 0,
      qc_disagreement_rate: runCount > 0 ? round4(qcDisagreementCount / runCount) : 0,
      review_blocked_count: reviewBlockedCount,
      injection_flagged_runs: injectionFlaggedRuns,
      assessment,
      reasons,
    },
  };
}

export function summarizeBundle(
  bundle: EvidenceBundle,
  repeatRunCount = 1,
  crucible?: CrucibleLink | null,
  relatedBundles?: EvidenceBundle[],
): EvaluationSummary {
  const validity = verifyBundle(bundle);
  const verdict = normalizeBundleVerdict(bundle);
  const durationSec = Math.round((new Date(bundle.environment.timestamp_end).getTime() - new Date(bundle.environment.timestamp_start).getTime()) / 1000);
  const executionScore = Math.round(canonicalPercent(bundle.score.total));
  const benchmarkScore = crucible?.benchmark_score ?? null;
  const runSet = summarizeRunSet(relatedBundles && relatedBundles.length > 0 ? relatedBundles : [bundle]);
  const divergence = benchmarkScore === null
    ? null
    : Math.abs(benchmarkScore - executionScore) >= 20
      ? `Benchmark ${benchmarkScore} vs execution ${executionScore}`
      : null;

  const baseIntegrations: NonNullable<EvidenceBundle["integrations"]> = bundle.integrations ?? {
    veritor: {
      contract_version: "1.0.0",
      consumable: true,
    },
    paedagogus: {
      contract_version: "1.0.0",
      consumable: true,
      routing_signals: {
        task_family: bundle.task.family,
        difficulty: bundle.task.difficulty,
        provider: bundle.agent.provider,
        adapter: bundle.agent.adapter,
        score: canonicalPercent(bundle.score.total),
        pass: bundle.score.pass,
        failure_mode: bundle.diagnosis.failure_mode,
      },
    },
    crucible: {
      profile_id: null,
      benchmark_score: null,
      benchmark_label: null,
      execution_score: executionScore,
      divergence_note: null,
    },
  };
  const integrations: NonNullable<EvidenceBundle["integrations"]> = {
    ...baseIntegrations,
    crucible: {
      ...(baseIntegrations.crucible ?? {
        profile_id: null,
        benchmark_score: null,
        benchmark_label: null,
        execution_score: executionScore,
        divergence_note: null,
      }),
      profile_id: crucible?.profile_id ?? baseIntegrations.crucible?.profile_id ?? null,
      benchmark_score: benchmarkScore ?? baseIntegrations.crucible?.benchmark_score ?? null,
      benchmark_label: crucible?.benchmark_label ?? baseIntegrations.crucible?.benchmark_label ?? null,
      execution_score: executionScore,
      divergence_note: divergence,
    },
  };

  return {
    schema: "crucibulum.evaluation.summary.v1",
    bundle_id: bundle.bundle_id,
    bundle_hash: bundle.bundle_hash,
    task_id: bundle.task.id,
    benchmark_provenance: bundle.task.benchmark_provenance ?? null,
    oracle_integrity: bundle.oracle_integrity ?? null,
    suite_id: "v1",
    family: bundle.task.family,
    difficulty: bundle.task.difficulty,
    target: {
      adapter: bundle.agent.adapter,
      provider: bundle.agent.provider,
      model: bundle.agent.model,
    },
    outcome: {
      pass: bundle.score.pass,
      verdict,
      score: canonicalPercent(bundle.score.total),
      score_breakdown: {
        correctness: canonicalPercent(bundle.score.breakdown.correctness),
        regression: canonicalPercent(bundle.score.breakdown.regression),
        integrity: canonicalPercent(bundle.score.breakdown.integrity),
        efficiency: canonicalPercent(bundle.score.breakdown.efficiency),
      },
      pass_threshold: canonicalPercent(bundle.score.pass_threshold),
      integrity_violations: bundle.score.integrity_violations,
      failure_taxonomy: {
        failure_mode: verdict.failureReasonCode === "pass" ? null : `${verdict.completionState}:${verdict.failureOrigin ?? "NONE"}:${verdict.failureReasonCode}`,
        integrity_violations: bundle.verification_results.integrity.violations,
      },
    },
    judge: bundle.judge ?? DETERMINISTIC_JUDGE_METADATA,
    authority: {
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    trust: {
      ...(bundle.trust ?? {
        rubric_hidden: true,
        narration_ignored: true,
        state_based_scoring: true,
        bundle_verified: validity.valid,
        deterministic_judge_authoritative: true,
        review_layer_advisory: true,
      }),
      bundle_hash_verified: validity.hash_valid,
      bundle_authenticated: validity.valid,
      bundle_signature_status: validity.signature_status,
    },
    usage: {
      tokens_in: bundle.usage.tokens_in,
      tokens_out: bundle.usage.tokens_out,
      estimated_cost_usd: bundle.usage.estimated_cost_usd,
      provider_cost_note: bundle.usage.provider_cost_note,
    },
    judge_usage: bundle.judge_usage ?? {
      provider: "",
      model: "",
      tokens_in: 0,
      tokens_out: 0,
      estimated_cost_usd: 0,
      kind: "deterministic" as const,
      note: "deterministic judge — no model cost",
    },
    total: {
      tokens: bundle.usage.tokens_in + bundle.usage.tokens_out + (bundle.judge_usage?.tokens_in ?? 0) + (bundle.judge_usage?.tokens_out ?? 0),
      cost_usd: bundle.usage.estimated_cost_usd + (bundle.judge_usage?.estimated_cost_usd ?? 0),
    },
    timing: {
      started_at: bundle.environment.timestamp_start,
      ended_at: bundle.environment.timestamp_end,
      duration_sec: durationSec,
    },
    interpretation: bundle.interpretation ?? null,
    repeat_run_count: repeatRunCount,
    pass_at: runSet.pass_at,
    reliability: runSet.reliability,
    review: bundle.review ?? null,
    review_security: bundle.review?.security ?? null,
    review_input_sanitized: bundle.review?.security.review_input_sanitized ?? false,
    injection_flags_count: bundle.review?.security.injection_flags_count ?? 0,
    flagged_sources: bundle.review?.security.flagged_sources ?? [],
    review_blocked_reason: bundle.review?.security.review_blocked_reason ?? null,
    review_output_invalid: bundle.review?.security.review_output_invalid ?? false,
    trust_boundary_violations: bundle.review?.security.trust_boundary_violations ?? [],
    integrations,
  };
}

export function countRepeatRuns(
  bundles: EvidenceBundle[],
  taskId: string,
  adapter: string,
  model: string,
  provider?: string,
): number {
  return bundles.filter((bundle) =>
    bundle.task.id === taskId
    && bundle.agent.adapter === adapter
    && bundle.agent.model === model
    && (provider === undefined || bundle.agent.provider === provider)).length;
}
