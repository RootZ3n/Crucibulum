/**
 * Crucible — Leaderboard Aggregator
 * Aggregates evidence bundles into leaderboard entries.
 * Computes pass@k, failure taxonomy, performance metrics.
 */
import type { EvidenceBundle } from "../adapters/base.js";
export interface LeaderboardEntry {
    submission_id: string;
    submitted_at: string;
    bundle_hashes: string[];
    crucibulum_version: string;
    agent: {
        adapter: string;
        provider: string;
        model: string;
        system: string;
        system_version: string;
    };
    suite: string;
    tasks_attempted: number;
    tasks_passed: number;
    scores: {
        total: number;
        correctness: number;
        regression: number;
        integrity: number;
        efficiency: number;
    };
    pass_at: Record<string, boolean>;
    failure_taxonomy: Record<string, number>;
    review_signals: {
        disagreement_rate: number;
        qc_disagreement_rate: number;
        review_blocked_rate: number;
    };
    performance: {
        median_time_sec: number;
        p90_time_sec: number;
        median_steps: number;
        total_cost_usd: number;
    };
    verdict_metrics?: {
        model_failures: number;
        not_complete: number;
        completion_rate: number;
        model_failure_rate: number;
        nc_rate: number;
    };
    verified: boolean;
}
export declare function loadBundles(): EvidenceBundle[];
export declare function aggregateByModel(bundles: EvidenceBundle[]): Map<string, EvidenceBundle[]>;
export declare function buildLeaderboardEntry(modelKey: string, bundles: EvidenceBundle[]): LeaderboardEntry;
export declare function saveSubmission(entry: LeaderboardEntry): string;
export declare function loadSubmissions(): LeaderboardEntry[];
//# sourceMappingURL=aggregator.d.ts.map