import type { EvidenceBundle } from "../adapters/base.js";
import { verifyBundle } from "../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";

export interface CrucibleLink {
  profile_id: string | null;
  benchmark_score: number | null;
  benchmark_label: string | null;
}

export interface EvaluationSummary {
  schema: "crucibulum.evaluation.summary.v1";
  bundle_id: string;
  bundle_hash: string;
  task_id: string;
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
  trust: EvidenceBundle["trust"] & { bundle_hash_verified: boolean };
  usage: {
    tokens_in: number;
    tokens_out: number;
    estimated_cost_usd: number;
    provider_cost_note: string;
  };
  timing: {
    started_at: string;
    ended_at: string;
    duration_sec: number;
  };
  repeat_run_count: number;
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

export function summarizeBundle(bundle: EvidenceBundle, repeatRunCount = 1, crucible?: CrucibleLink | null): EvaluationSummary {
  const validity = verifyBundle(bundle);
  const durationSec = Math.round((new Date(bundle.environment.timestamp_end).getTime() - new Date(bundle.environment.timestamp_start).getTime()) / 1000);
  const executionScore = Math.round(bundle.score.total * 100);
  const benchmarkScore = crucible?.benchmark_score ?? null;
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
        score: bundle.score.total,
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
      score: bundle.score.total,
      score_breakdown: bundle.score.breakdown,
      pass_threshold: bundle.score.pass_threshold,
      integrity_violations: bundle.score.integrity_violations,
      failure_taxonomy: {
        failure_mode: bundle.diagnosis.failure_mode,
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
      bundle_hash_verified: validity.valid,
    },
    usage: {
      tokens_in: bundle.usage.tokens_in,
      tokens_out: bundle.usage.tokens_out,
      estimated_cost_usd: bundle.usage.estimated_cost_usd,
      provider_cost_note: bundle.usage.provider_cost_note,
    },
    timing: {
      started_at: bundle.environment.timestamp_start,
      ended_at: bundle.environment.timestamp_end,
      duration_sec: durationSec,
    },
    repeat_run_count: repeatRunCount,
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

export function countRepeatRuns(bundles: EvidenceBundle[], taskId: string, adapter: string, model: string): number {
  return bundles.filter((bundle) => bundle.task.id === taskId && bundle.agent.adapter === adapter && bundle.agent.model === model).length;
}
