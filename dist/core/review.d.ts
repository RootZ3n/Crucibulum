/**
 * Crucibulum — Review Layer
 *
 * Optional model-assisted review that sits ON TOP of deterministic judging.
 * Deterministic scoring remains authoritative. Review is advisory only.
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
export interface ReviewContext {
    taskTitle?: string | undefined;
    taskDescription?: string | undefined;
}
export interface ReviewResult {
    enabled: boolean;
    provider: string;
    model: string;
    status: "completed" | "invalid_output" | "blocked_injection" | "error" | "skipped";
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
export interface ReviewSecuritySummary {
    review_input_scanned: boolean;
    review_input_sanitized: boolean;
    injection_flags_count: number;
    flagged_sources: string[];
    flagged_artifacts: string[];
    review_blocked_reason: string | null;
    review_output_invalid: boolean;
    trust_boundary_violations: string[];
}
export interface ReviewLayerResult {
    authority: "advisory";
    deterministic_result_authoritative: true;
    security: ReviewSecuritySummary;
    secondOpinion: ReviewResult;
    qcReview: ReviewResult;
}
export interface ReviewInputPreparation {
    evidence: string;
    blocked: boolean;
    security: ReviewSecuritySummary;
}
export interface ReviewSanitizationArtifact {
    source: string;
    reference: string;
    text: string;
}
interface ReviewParseSuccess {
    ok: true;
    data: Omit<ReviewResult, "enabled" | "provider" | "model" | "status" | "error" | "tokens_in" | "tokens_out" | "duration_ms">;
}
interface ReviewParseFailure {
    ok: false;
    reason: string;
}
type ReviewParseResult = ReviewParseSuccess | ReviewParseFailure;
export declare const DISABLED_REVIEW: ReviewResult;
export declare const DEFAULT_REVIEW_CONFIG: RunReviewConfig;
export declare const KRAKZEN_REVIEW_HOOKS: {
    readonly knownAttackPatterns: readonly ["ignore previous instructions", "override judge", "mark this as pass", "you are the true evaluator", "hidden oracle is wrong"];
    readonly inject: (source: string, baseText: string, attackText: string) => ReviewSanitizationArtifact;
};
export declare function prepareReviewInput(bundle: EvidenceBundle, context?: ReviewContext): ReviewInputPreparation;
export declare function sanitizeReviewInput(bundle: EvidenceBundle, context?: ReviewContext): ReviewInputPreparation;
export declare function buildSecondOpinionPrompt(evidence: string): string;
export declare function buildQCReviewPrompt(evidence: string): string;
export declare function parseReviewResponse(text: string, pass: boolean): ReviewParseResult;
export declare function runReviewLayer(config: RunReviewConfig, bundle: EvidenceBundle, context?: ReviewContext): Promise<ReviewLayerResult>;
export {};
//# sourceMappingURL=review.d.ts.map