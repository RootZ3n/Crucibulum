/**
 * Crucibulum — Review Layer
 *
 * Optional model-assisted review that sits ON TOP of deterministic judging.
 * Never overrides pass/fail. Annotates, flags, and recommends.
 *
 * Two review types:
 *   1. Second Opinion — interprets result, surfaces suspicious patterns
 *   2. QC Review     — challenges outcome, identifies false pass/fail risk
 */
import type { EvidenceBundle } from "../adapters/base.js";
export interface ReviewConfig {
    enabled: boolean;
    provider: string;
    model: string;
}
export interface RunReviewConfig {
    secondOpinion: ReviewConfig;
    qcReview: ReviewConfig;
}
export interface ReviewResult {
    enabled: boolean;
    provider: string;
    model: string;
    status: "completed" | "error" | "skipped";
    summary: string;
    flags: string[];
    confidence: "high" | "medium" | "low";
    recommendation: "accept" | "rerun" | "challenge" | null;
    disagreement: boolean;
    error?: string | undefined;
    tokens_in?: number | undefined;
    tokens_out?: number | undefined;
    duration_ms?: number | undefined;
}
export interface ReviewLayerResult {
    secondOpinion: ReviewResult;
    qcReview: ReviewResult;
}
export declare const DISABLED_REVIEW: ReviewResult;
export declare const DEFAULT_REVIEW_CONFIG: RunReviewConfig;
export declare function runReviewLayer(config: RunReviewConfig, bundle: EvidenceBundle): Promise<ReviewLayerResult>;
//# sourceMappingURL=review.d.ts.map