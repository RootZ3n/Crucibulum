/**
 * Crucible — Judge Usage Aggregator
 *
 * The model-judge spend is recorded in two related places: the per-leg
 * `review.secondOpinion` and `review.qcReview` blocks (with their own
 * tokens_in / tokens_out), and the bundle-level `judge_usage` object that the
 * UI / CLI summarises. This helper rolls the legs up into `judge_usage` so
 * the reviewer cannot disagree with itself about what the judge cost.
 *
 * Cost accounting rules
 * ---------------------
 *  - Tokens: sum of every leg that actually ran (status === "completed" or
 *    "invalid_output"). A "skipped"/"blocked_injection"/"error" leg is *not*
 *    counted because the model never produced billable output.
 *  - Cost: providers do not currently surface per-call cost in the review
 *    response, so we estimate from the same `utils/cost` rate table used for
 *    the model-under-test. The note explicitly tags the figure as estimated,
 *    matching the pattern conversational-runner uses.
 */
import type { EvidenceBundle } from "../adapters/base.js";
export declare function applyReviewJudgeUsage(bundle: EvidenceBundle): void;
//# sourceMappingURL=judge-usage.d.ts.map