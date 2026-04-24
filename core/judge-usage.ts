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
import type { ReviewResult } from "./review.js";
import { estimateCost } from "../utils/cost.js";

const COUNTABLE_STATUSES: ReadonlySet<ReviewResult["status"]> = new Set([
  "completed",
  "invalid_output",
]);

function legUsage(leg: ReviewResult): { tokensIn: number; tokensOut: number } {
  if (!leg.enabled || !COUNTABLE_STATUSES.has(leg.status)) {
    return { tokensIn: 0, tokensOut: 0 };
  }
  return { tokensIn: leg.tokens_in ?? 0, tokensOut: leg.tokens_out ?? 0 };
}

export function applyReviewJudgeUsage(bundle: EvidenceBundle): void {
  const review = bundle.review;
  if (!review) return;

  const second = legUsage(review.secondOpinion);
  const qc = legUsage(review.qcReview);
  const tokensIn = second.tokensIn + qc.tokensIn;
  const tokensOut = second.tokensOut + qc.tokensOut;

  // Pick the configured judge identity. If both legs ran on the same
  // provider/model (the common case — both default to the configured judge)
  // we surface it directly; otherwise we pick the secondOpinion leg first
  // and tag mixed configurations in the note.
  const seen = new Set<string>();
  for (const leg of [review.secondOpinion, review.qcReview]) {
    if (leg.enabled && leg.provider && leg.model) seen.add(`${leg.provider}:${leg.model}`);
  }
  const provider = review.secondOpinion.provider || review.qcReview.provider;
  const model = review.secondOpinion.model || review.qcReview.model;
  const cost = (provider && (tokensIn + tokensOut) > 0) ? estimateCost(provider, tokensIn, tokensOut) : 0;

  let kind: NonNullable<EvidenceBundle["judge_usage"]>["kind"] = "model";
  let note: string;
  if ((tokensIn + tokensOut) === 0 && !review.secondOpinion.enabled && !review.qcReview.enabled) {
    kind = "deterministic";
    note = "deterministic judge — no model judge ran";
  } else if ((tokensIn + tokensOut) === 0) {
    kind = "skipped";
    note = "model judge enabled but produced no usage (provider error or skipped)";
  } else if (seen.size > 1) {
    note = `mixed judge legs: ${Array.from(seen).join(", ")} (estimated)`;
  } else {
    note = `${provider || "?"}:${model || "?"} (estimated)`;
  }

  bundle.judge_usage = {
    provider: provider || "",
    model: model || "",
    tokens_in: tokensIn,
    tokens_out: tokensOut,
    estimated_cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    kind,
    note,
  };
}
