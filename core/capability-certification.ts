/**
 * Crucible — Capability Certification doctrine evaluator (v1).
 *
 * Implements the gate thresholds defined in
 * `docs/CAPABILITY_CERTIFICATION_DOCTRINE.md` for Vision and Roleplay.
 *
 * `evaluatePromotion()` is **read-only** — it produces a
 * `CapabilityPromotionDecision` payload describing whether a promotion
 * is eligible against current evidence and (if not) which gates block
 * it. The evaluator never writes to `MODEL_CERTIFICATION.models[]`,
 * never touches `certified-models.json`, and never affects the
 * leaderboard composite. Doctrine v1 enforces this with the
 * compile-time literal types `affectsLeaderboard: false` /
 * `affectsCertification: false` on both `CapabilityRouteCertification`
 * and `CapabilityPromotionDecision`.
 */

import type {
  CapabilityId,
  CapabilityTier,
  CapabilityGateSpec,
  CapabilityGateFailure,
  CapabilityPromotionDecision,
  CapabilityEvidenceRef,
} from "./capability-certification-types.js";

// ── Gate specs ─────────────────────────────────────────────────────────────

/**
 * Vision gates per tier. Numbers track the doctrine doc verbatim;
 * future doctrine revisions must update this table AND the doc in
 * the same commit.
 */
export const VISION_GATES: Record<CapabilityTier, CapabilityGateSpec> = {
  EXPERIMENTAL: {
    capability: "vision", tier: "EXPERIMENTAL",
    minSuiteSize: 1, minRepeatRuns: 0, minStablePassRate: 0,
    minIndependentRoutes: 0, disallowedRecurringAttributions: [],
    requiresEvidence: false,
  },
  PROVIDER_TESTED: {
    capability: "vision", tier: "PROVIDER_TESTED",
    minSuiteSize: 5, minRepeatRuns: 1, minStablePassRate: 0,
    minIndependentRoutes: 1, disallowedRecurringAttributions: ["CONFIG", "PROVIDER"],
    requiresEvidence: true,
  },
  STABLE: {
    capability: "vision", tier: "STABLE",
    minSuiteSize: 5, minRepeatRuns: 3, minStablePassRate: 0.80,
    minIndependentRoutes: 1, disallowedRecurringAttributions: ["CONFIG", "PROVIDER", "FIXTURE", "SCORER"],
    requiresEvidence: true,
  },
  CAPABILITY_CERTIFIED: {
    capability: "vision", tier: "CAPABILITY_CERTIFIED",
    minSuiteSize: 15, minRepeatRuns: 3, minStablePassRate: 0.80,
    minIndependentRoutes: 3, disallowedRecurringAttributions: ["CONFIG", "PROVIDER", "FIXTURE", "SCORER"],
    requiresEvidence: true,
  },
  BLOCKED_UNSUPPORTED: {
    capability: "vision", tier: "BLOCKED_UNSUPPORTED",
    minSuiteSize: 0, minRepeatRuns: 0, minStablePassRate: 0,
    minIndependentRoutes: 0, disallowedRecurringAttributions: [],
    requiresEvidence: false,
  },
};

/** Roleplay gates per tier. See doctrine doc for rationale on each
 *  numeric threshold (5-repeat stability, 7 → 20 suite expansion,
 *  80% stable-pass, 15% NEEDS_REVIEW cap, etc). */
export const ROLEPLAY_GATES: Record<CapabilityTier, CapabilityGateSpec> = {
  EXPERIMENTAL: {
    capability: "roleplay", tier: "EXPERIMENTAL",
    minSuiteSize: 1, minRepeatRuns: 0, minStablePassRate: 0,
    minIndependentRoutes: 0, disallowedRecurringAttributions: [],
    requiresEvidence: false,
  },
  PROVIDER_TESTED: {
    capability: "roleplay", tier: "PROVIDER_TESTED",
    minSuiteSize: 7, minRepeatRuns: 1, minStablePassRate: 0,
    minIndependentRoutes: 1, disallowedRecurringAttributions: ["CONFIG", "PROVIDER"],
    requiresEvidence: true,
  },
  STABLE: {
    capability: "roleplay", tier: "STABLE",
    minSuiteSize: 7, minRepeatRuns: 5, minStablePassRate: 0.80,
    minIndependentRoutes: 1, disallowedRecurringAttributions: ["CONFIG", "PROVIDER", "FIXTURE", "SCORER", "PROMPT"],
    requiresEvidence: true,
  },
  CAPABILITY_CERTIFIED: {
    capability: "roleplay", tier: "CAPABILITY_CERTIFIED",
    minSuiteSize: 20, minRepeatRuns: 5, minStablePassRate: 0.80,
    minIndependentRoutes: 3, disallowedRecurringAttributions: ["CONFIG", "PROVIDER", "FIXTURE", "SCORER", "PROMPT"],
    requiresEvidence: true,
  },
  BLOCKED_UNSUPPORTED: {
    capability: "roleplay", tier: "BLOCKED_UNSUPPORTED",
    minSuiteSize: 0, minRepeatRuns: 0, minStablePassRate: 0,
    minIndependentRoutes: 0, disallowedRecurringAttributions: [],
    requiresEvidence: false,
  },
};

/** Lookup the gate spec for a (capability, tier) pair. */
export function gateSpecFor(capability: CapabilityId, tier: CapabilityTier): CapabilityGateSpec {
  const gates = capability === "vision" ? VISION_GATES : ROLEPLAY_GATES;
  return gates[tier];
}

// ── Evaluator input + main entry point ────────────────────────────────────

export interface EvaluatePromotionInput {
  capability: CapabilityId;
  providerId: string;
  modelId: string;
  currentTier: CapabilityTier;
  proposedTier: CapabilityTier;
  /** Live suite size — count of tasks in the route's most recent
   *  full-suite run. */
  suiteSize: number;
  /** Number of repeat runs completed via the stability runner. */
  repeatRuns: number;
  /** Observed stable-pass rate across all (test × run) cells (0..1). */
  stablePassRate: number;
  /** Independent model/provider families tested (e.g. Mimo, GPT-5,
   *  DeepSeek, Anthropic). */
  independentRoutesTested: number;
  /** Attribution categories that recurred (≥2 cells) in stability
   *  evidence — used to enforce disallowedRecurringAttributions. */
  recurringAttributions: string[];
  /** Evidence artifacts supporting the request. Empty array means
   *  unverified — promotion blocked (except for EXPERIMENTAL). */
  evidenceRefs: CapabilityEvidenceRef[];
}

/**
 * Read-only promotion-decision evaluator. Walks every gate clause for
 * the proposed tier, collects all blocking conditions, and returns
 * the decision payload. Multiple blocking reasons can be returned in
 * one call so the operator sees the full gap rather than fixing
 * issues one at a time.
 *
 * Guarantees:
 *   - Never mutates any registry, file, or `MODEL_CERTIFICATION` field.
 *   - Returns `affectsLeaderboard: false` + `affectsCertification: false`
 *     as compile-time literals.
 *   - Promotion above EXPERIMENTAL with `evidenceRefs.length === 0`
 *     is structurally impossible.
 */
export function evaluatePromotion(input: EvaluatePromotionInput): CapabilityPromotionDecision {
  const spec = gateSpecFor(input.capability, input.proposedTier);
  const blocking: CapabilityGateFailure[] = [];
  const tierTag = input.proposedTier.toLowerCase().replace(/_/g, "-");

  if (input.suiteSize < spec.minSuiteSize) {
    blocking.push({
      gate: `${input.capability}.${tierTag}.suite-size`,
      reason: `suite has ${input.suiteSize} tests; need at least ${spec.minSuiteSize}`,
      evidenceRefs: input.evidenceRefs,
    });
  }
  if (input.repeatRuns < spec.minRepeatRuns) {
    blocking.push({
      gate: `${input.capability}.${tierTag}.repeat-runs`,
      reason: `repeat-run count is ${input.repeatRuns}; need at least ${spec.minRepeatRuns}`,
      evidenceRefs: input.evidenceRefs,
    });
  }
  if (input.stablePassRate < spec.minStablePassRate) {
    blocking.push({
      gate: `${input.capability}.${tierTag}.stable-pass-rate`,
      reason: `stable-pass rate is ${(input.stablePassRate * 100).toFixed(1)}%; need at least ${(spec.minStablePassRate * 100).toFixed(0)}%`,
      evidenceRefs: input.evidenceRefs,
    });
  }
  if (input.independentRoutesTested < spec.minIndependentRoutes) {
    blocking.push({
      gate: `${input.capability}.${tierTag}.independent-routes`,
      reason: `tested ${input.independentRoutesTested} independent route families; need at least ${spec.minIndependentRoutes}`,
      evidenceRefs: input.evidenceRefs,
    });
  }
  for (const attr of spec.disallowedRecurringAttributions) {
    if (input.recurringAttributions.includes(attr)) {
      blocking.push({
        gate: `${input.capability}.${tierTag}.recurring-${attr.toLowerCase()}`,
        reason: `disallowed recurring attribution at this tier: ${attr}`,
        evidenceRefs: input.evidenceRefs,
      });
    }
  }
  if (spec.requiresEvidence && input.evidenceRefs.length === 0) {
    blocking.push({
      gate: `${input.capability}.${tierTag}.evidence`,
      reason: `no evidence refs provided — every promotion above EXPERIMENTAL must cite at least one verifiable report`,
      evidenceRefs: [],
    });
  }
  // BLOCKED_UNSUPPORTED routes cannot move to higher tiers without an
  // explicit re-test that resolves the blocking condition.
  if (input.currentTier === "BLOCKED_UNSUPPORTED" && input.proposedTier !== "BLOCKED_UNSUPPORTED" && input.proposedTier !== "EXPERIMENTAL") {
    blocking.push({
      gate: `${input.capability}.${tierTag}.blocked-resolution`,
      reason: `current tier is BLOCKED_UNSUPPORTED — explicit re-test required to resolve the blocking condition before any promotion`,
      evidenceRefs: input.evidenceRefs,
    });
  }

  return {
    eligible: blocking.length === 0,
    capability: input.capability,
    providerId: input.providerId,
    modelId: input.modelId,
    currentTier: input.currentTier,
    proposedTier: input.proposedTier,
    blockingReasons: blocking,
    evidenceRefs: input.evidenceRefs,
    generatedAt: new Date().toISOString(),
    affectsLeaderboard: false as const,
    affectsCertification: false as const,
  };
}
