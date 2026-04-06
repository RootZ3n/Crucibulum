import type { EvidenceBundle } from "../adapters/base.js";
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
    review: EvidenceBundle["review"] | null;
    integrations: NonNullable<EvidenceBundle["integrations"]>;
}
export declare function summarizeBundle(bundle: EvidenceBundle, repeatRunCount?: number, crucible?: CrucibleLink | null): EvaluationSummary;
export declare function countRepeatRuns(bundles: EvidenceBundle[], taskId: string, adapter: string, model: string): number;
//# sourceMappingURL=contracts.d.ts.map