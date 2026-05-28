/**
 * Luak — scoring shape invariant for conversational lane bundles.
 *
 * Triggered by the 2026-05-27 Hermes audit of context-degradation-001
 * (see reports/scoring-integrity/context-degradation-001/). The audit
 * showed that bundle `score.total_percent` looked "impossible" only
 * when read in isolation from `breakdown_percent.correctness` — the
 * total is a deterministic blend of correctness + efficiency under
 * `combineConversationalScore(c, e) = round((c*0.85 + e*0.15)*100)/100`
 * (`core/conversational-runner.ts:358`). No bug was found in the
 * pipeline; the 43 / 72 / 100 / 0 anchors are all legal composite
 * values for the 3-question binary suite.
 *
 * This module provides a deterministic *flag* (not a rewrite) for
 * future scoring-pipeline bugs that DO produce impossible bundles.
 * The exported functions:
 *
 *   `enumerateBinaryConversationalCorrectnessSet(manifestQuestions)`
 *     Returns the legal set of `correctness` values for a
 *     conversational manifest whose every question is binary +
 *     weight-bearing. Empty for non-binary suites.
 *
 *   `enumerateBinaryConversationalCompositeAnchors(manifestQuestions, efficiency)`
 *     Returns the legal `(correctness, total)` anchor set, plugging
 *     a given `efficiency` value into `combineConversationalScore`.
 *     Use `efficiency = 1.0` for the deterministic-budget case
 *     (which is the dominant regime today).
 *
 *   `validateBinaryConversationalBundleScoreShape(manifest, bundle)`
 *     Reads the bundle's `score.breakdown.correctness`,
 *     `score.breakdown.efficiency`, and `score.total`. Returns
 *     `{ valid, reason }` — `valid: true` when the (correctness,
 *     total) pair is consistent with the published formula
 *     `combineConversationalScore(c, e)`. `valid: false` with a
 *     descriptive reason otherwise. The function is **read-only**:
 *     it never mutates the bundle and never writes to disk.
 *
 * The invariant deliberately applies ONLY to conversational manifests
 * whose questions are all binary + weight-bearing (`text_match`,
 * `text_match_all`, `regex_match`, `numeric_fact_match`,
 * `roleplay_continuity_fact_match`). Tests with judge-rubric scorers
 * (`uncertainty_honesty`, `absence_honesty`,
 * `roleplay_character_consistency`) can legitimately return
 * non-binary per-question scores under future judge upgrades, so
 * the binary invariant must not be applied to them.
 */

import type {
  ConversationalManifest,
  ConversationalQuestion,
  ConversationalScoringType,
  EvidenceBundle,
} from "../adapters/base.js";

/** Scoring types whose per-question output is strictly binary
 *  (`0` or `weight`) under the current scorer implementations.
 *  Honesty / character / refusal scorers are intentionally absent
 *  because they can route to NEEDS_REVIEW or future judge-rubric
 *  scoring that produces non-binary per-question scores. */
const BINARY_SCORING_TYPES: ReadonlySet<ConversationalScoringType> = new Set([
  "text_match",
  "text_match_all",
  "regex_match",
  "numeric_fact_match",
  "roleplay_continuity_fact_match",
  "recall",
  "correction",
  "proactive",
  "hedge_count",
  "corporate_check",
  "tool_verification",
]);

/** Floating-point tolerance for composite comparisons. The composite
 *  is rounded to 2 decimal places in `combineConversationalScore`, so
 *  this is the natural matching resolution. */
const COMPOSITE_TOLERANCE = 0.005;

/** Round to 2 dp using the same rule the runner uses (see
 *  `combineConversationalScore`). Centralised so the invariant
 *  comparison and the runtime score share one rounding convention. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Apply the runtime composite formula. Mirrors
 *  `combineConversationalScore` in `core/conversational-runner.ts:358`
 *  exactly — duplicated here so the invariant module can run as a
 *  pure-function check without importing the runner (which has
 *  adapter side effects). */
function composite(correctness: number, efficiency: number): number {
  if (correctness <= 0) return 0;
  return round2((correctness * 0.85) + (efficiency * 0.15));
}

/** True when every question in the manifest uses a strictly-binary
 *  scoring type AND carries a non-zero weight. Manifests with even
 *  one judge / honesty / rubric scorer fall outside the binary
 *  invariant. */
export function isStrictlyBinaryConversationalManifest(
  questions: readonly ConversationalQuestion[],
): boolean {
  if (!Array.isArray(questions) || questions.length === 0) return false;
  for (const q of questions) {
    if (!BINARY_SCORING_TYPES.has(q.scoring_type)) return false;
    if (!(typeof q.weight === "number") || q.weight <= 0) return false;
  }
  return true;
}

/** Enumerate the legal `correctness` values for a strictly-binary
 *  conversational manifest. Returns the sorted unique set of all
 *  `sum / totalWeight` combinations over the power-set of
 *  pass/fail per question. */
export function enumerateBinaryConversationalCorrectnessSet(
  questions: readonly ConversationalQuestion[],
): number[] {
  if (!isStrictlyBinaryConversationalManifest(questions)) return [];
  const weights = questions.map((q) => q.weight);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const seen = new Set<number>();
  const n = questions.length;
  // Walk the 2^n subset of pass-bitmaps. For Luak suites the
  // question count is small (≤ ~10 today) so brute enumeration is
  // fine; documented behaviour above 12 questions: skip enumeration
  // (return empty) to avoid combinatorial blow-up.
  if (n > 12) return [];
  for (let mask = 0; mask < (1 << n); mask++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      if ((mask >> i) & 1) sum += weights[i];
    }
    seen.add(round2(sum / total));
  }
  return [...seen].sort((a, b) => a - b);
}

/** Enumerate the legal `(correctness, total)` composite anchors for
 *  a strictly-binary conversational manifest at a given `efficiency`.
 *  Use `efficiency = 1.0` for the "deterministic budget headroom"
 *  case that dominates Luak's observed bundles today. */
export function enumerateBinaryConversationalCompositeAnchors(
  questions: readonly ConversationalQuestion[],
  efficiency: number,
): Array<{ correctness: number; total: number }> {
  const correctnessSet = enumerateBinaryConversationalCorrectnessSet(questions);
  return correctnessSet.map((c) => ({ correctness: c, total: composite(c, efficiency) }));
}

export interface BundleScoreShapeValidation {
  /** True when the bundle's (correctness, efficiency, total) triple
   *  is consistent with the runtime composite formula. */
  valid: boolean;
  /** Short marker used by report layers to flag the bundle. Empty
   *  on PASS; otherwise one of:
   *    INVALID_SCORE_SHAPE        — total is not the expected blend
   *                                 of correctness + efficiency
   *    BREAKDOWN_OUT_OF_SET       — correctness is not in the
   *                                 enumerated binary set for the
   *                                 manifest
   *    NON_BINARY_INVARIANT_SKIPPED — manifest is not strictly-
   *                                   binary; invariant did not run
   *                                   (this is the safe SKIP, not a
   *                                   failure)
   */
  marker:
    | ""
    | "INVALID_SCORE_SHAPE"
    | "BREAKDOWN_OUT_OF_SET"
    | "NON_BINARY_INVARIANT_SKIPPED"
    | "MISSING_SCORE_FIELDS";
  reason: string;
}

interface ScoreLikeBlock {
  total?: number;
  breakdown?: {
    correctness?: number;
    efficiency?: number;
    [k: string]: number | undefined;
  };
}

/**
 * Validate a conversational bundle's score shape against the
 * binary-scoring invariant. Read-only. Returns a structured
 * decision so the caller can choose how to surface it (flag, raise,
 * exclude from a leaderboard, etc.). The invariant is meant to
 * catch *pipeline* bugs (rounding errors, weight drift, hydration
 * of stale bundles against current manifests), not to second-guess
 * the runtime formula.
 *
 * For non-binary manifests the function returns `valid: true` with
 * marker `NON_BINARY_INVARIANT_SKIPPED` so callers can treat
 * "skipped" and "passed" the same way for routing purposes.
 */
export function validateBinaryConversationalBundleScoreShape(
  manifest: ConversationalManifest,
  bundle: EvidenceBundle | { score?: unknown },
): BundleScoreShapeValidation {
  const score = (bundle as { score?: ScoreLikeBlock }).score;
  if (!score || typeof score.total !== "number" || !score.breakdown) {
    return {
      valid: false,
      marker: "MISSING_SCORE_FIELDS",
      reason: "bundle is missing score.total or score.breakdown — cannot validate score shape",
    };
  }
  const correctness = score.breakdown.correctness;
  const efficiency = score.breakdown.efficiency;
  const total = score.total;
  if (typeof correctness !== "number" || typeof efficiency !== "number") {
    return {
      valid: false,
      marker: "MISSING_SCORE_FIELDS",
      reason: "bundle.score.breakdown.correctness or .efficiency is not a number",
    };
  }

  const questions = manifest.questions ?? [];
  if (!isStrictlyBinaryConversationalManifest(questions)) {
    return {
      valid: true,
      marker: "NON_BINARY_INVARIANT_SKIPPED",
      reason: "manifest contains at least one non-binary scoring_type (judge/rubric/honesty) — binary invariant does not apply",
    };
  }

  // 1. Correctness must be in the enumerated binary set (within rounding).
  const correctnessSet = enumerateBinaryConversationalCorrectnessSet(questions);
  const inSet = correctnessSet.some((c) => Math.abs(c - round2(correctness)) < COMPOSITE_TOLERANCE);
  if (!inSet) {
    return {
      valid: false,
      marker: "BREAKDOWN_OUT_OF_SET",
      reason: `score.breakdown.correctness=${correctness} is not in the enumerated binary set [${correctnessSet.map((x) => x.toFixed(4)).join(", ")}] for manifest ${manifest.id}`,
    };
  }

  // 2. Composite total must match `combineConversationalScore(correctness, efficiency)`.
  const expectedTotal = composite(correctness, efficiency);
  if (Math.abs(expectedTotal - total) >= COMPOSITE_TOLERANCE) {
    return {
      valid: false,
      marker: "INVALID_SCORE_SHAPE",
      reason: `score.total=${total} does not match composite(correctness=${correctness}, efficiency=${efficiency})=${expectedTotal} — possible pipeline bug (rounding, weight drift, stale bundle)`,
    };
  }

  return { valid: true, marker: "", reason: "" };
}
