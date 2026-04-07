import { verifyBundle } from "../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";
function round4(value) {
    return Math.round(value * 10000) / 10000;
}
export function getRelatedBundles(bundles, bundle) {
    return bundles
        .filter((candidate) => candidate.task.id === bundle.task.id
        && candidate.agent.adapter === bundle.agent.adapter
        && candidate.agent.provider === bundle.agent.provider
        && candidate.agent.model === bundle.agent.model)
        .sort((a, b) => new Date(a.environment.timestamp_start).getTime() - new Date(b.environment.timestamp_start).getTime());
}
export function summarizeRunSet(bundles) {
    const sorted = [...bundles].sort((a, b) => new Date(a.environment.timestamp_start).getTime() - new Date(b.environment.timestamp_start).getTime());
    const runCount = sorted.length;
    const passes = sorted.filter((bundle) => bundle.score.pass).length;
    const failures = runCount - passes;
    const passRate = runCount > 0 ? round4(passes / runCount) : 0;
    const passAt = {
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
    const avgScore = runCount > 0 ? round4(sorted.reduce((sum, bundle) => sum + bundle.score.total, 0) / runCount) : 0;
    const disagreementCount = sorted.filter((bundle) => bundle.review?.secondOpinion?.disagreement || bundle.review?.qcReview?.disagreement).length;
    const qcDisagreementCount = sorted.filter((bundle) => bundle.review?.qcReview?.disagreement).length;
    const reviewBlockedCount = sorted.filter((bundle) => !!bundle.review?.security.review_blocked_reason).length;
    const injectionFlaggedRuns = sorted.filter((bundle) => (bundle.review?.security.injection_flags_count ?? 0) > 0).length;
    const outcomeStability = runCount <= 1 ? "single_run" : (passes === 0 || passes === runCount ? "consistent" : "mixed");
    const reasons = [];
    if (outcomeStability === "single_run")
        reasons.push("single_run_only");
    if (outcomeStability === "mixed")
        reasons.push("repeat_run_variance");
    if (disagreementCount > 0)
        reasons.push("review_disagreement_present");
    if (reviewBlockedCount > 0)
        reasons.push("review_blocked_on_security");
    if (injectionFlaggedRuns > 0)
        reasons.push("injection_flags_detected");
    const assessment = outcomeStability === "mixed"
        ? "mixed"
        : (reviewBlockedCount > 0 || injectionFlaggedRuns > 0 || disagreementCount > 0 || runCount <= 1)
            ? "guarded"
            : "stable";
    return {
        run_count: runCount,
        passes,
        failures,
        pass_rate: passRate,
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
export function summarizeBundle(bundle, repeatRunCount = 1, crucible, relatedBundles) {
    const validity = verifyBundle(bundle);
    const durationSec = Math.round((new Date(bundle.environment.timestamp_end).getTime() - new Date(bundle.environment.timestamp_start).getTime()) / 1000);
    const executionScore = Math.round(bundle.score.total * 100);
    const benchmarkScore = crucible?.benchmark_score ?? null;
    const runSet = summarizeRunSet(relatedBundles && relatedBundles.length > 0 ? relatedBundles : [bundle]);
    const divergence = benchmarkScore === null
        ? null
        : Math.abs(benchmarkScore - executionScore) >= 20
            ? `Benchmark ${benchmarkScore} vs execution ${executionScore}`
            : null;
    const baseIntegrations = bundle.integrations ?? {
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
    const integrations = {
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
export function countRepeatRuns(bundles, taskId, adapter, model, provider) {
    return bundles.filter((bundle) => bundle.task.id === taskId
        && bundle.agent.adapter === adapter
        && bundle.agent.model === model
        && (provider === undefined || bundle.agent.provider === provider)).length;
}
//# sourceMappingURL=contracts.js.map