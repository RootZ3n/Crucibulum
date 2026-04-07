import type { EvidenceBundle } from "../adapters/base.js";
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
    pass_rate: number;
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
    trust: EvidenceBundle["trust"] & {
        bundle_hash_verified: boolean;
    };
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
    pass_at: PassAtSummary;
    reliability: ReliabilitySummary;
    review: EvidenceBundle["review"] | null;
    review_security: EvidenceBundle["review"] extends infer R ? R extends {
        security: infer S;
    } ? S | null : null : null;
    review_input_sanitized: boolean;
    injection_flags_count: number;
    flagged_sources: string[];
    review_blocked_reason: string | null;
    review_output_invalid: boolean;
    trust_boundary_violations: string[];
    integrations: NonNullable<EvidenceBundle["integrations"]>;
}
export declare function getRelatedBundles(bundles: EvidenceBundle[], bundle: EvidenceBundle): EvidenceBundle[];
export declare function summarizeRunSet(bundles: EvidenceBundle[]): RunSetSummary;
export declare function summarizeBundle(bundle: EvidenceBundle, repeatRunCount?: number, crucible?: CrucibleLink | null, relatedBundles?: EvidenceBundle[]): EvaluationSummary;
export declare function countRepeatRuns(bundles: EvidenceBundle[], taskId: string, adapter: string, model: string, provider?: string): number;
//# sourceMappingURL=contracts.d.ts.map