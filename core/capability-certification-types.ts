/**
 * Crucible — Capability Certification types (Doctrine v1).
 *
 * Type contracts for the capability-certification doctrine defined in
 * `docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`. These types are
 * deliberately type-only — they do not import any runtime registry or
 * mutate `MODEL_CERTIFICATION.models[].tier`.
 *
 * Compile-time guarantees:
 *   - `affectsLeaderboard` and `affectsCertification` on every
 *     capability-tier shape are typed as the literal `false`. The
 *     compiler will reject any code that tries to set them to `true`.
 *   - `CapabilityTier` is a closed union — adding a tier requires an
 *     intentional source edit, not config drift.
 *
 * See: docs/CAPABILITY_CERTIFICATION_DOCTRINE.md
 *      docs/CAPABILITY_CERTIFICATION_ROADMAP.md
 */

/** Capability lanes Crucible currently recognises. Open for future
 *  additions (e.g. tool-use, repo-editing) — but each new capability
 *  must define its own gate spec before the union is extended. */
export type CapabilityId = "vision" | "roleplay";

/** Promotion tiers, ordered low → high (plus the disqualification
 *  tier `BLOCKED_UNSUPPORTED`). Doctrine v1 freezes these five values;
 *  a future doctrine revision can extend the union behind a version
 *  bump. */
export type CapabilityTier =
  | "EXPERIMENTAL"
  | "PROVIDER_TESTED"
  | "STABLE"
  | "CAPABILITY_CERTIFIED"
  | "BLOCKED_UNSUPPORTED";

/** Pointer to evidence that supports a capability claim. Evidence is
 *  always a file path (smoke report, stability report, audit card,
 *  bundle, or schema doc); the evaluator never accepts free-form text
 *  in place of a verifiable artifact. */
export interface CapabilityEvidenceRef {
  kind: "smoke" | "stability" | "audit" | "phase" | "bundle" | "schema" | "baseline";
  path: string;
  commit?: string;
  generatedAt?: string;
}

/** Current tier for a single (capability, provider, model) route.
 *  Always non-affecting on leaderboard/certification — the literal
 *  `false` types enforce that compile-time. */
export interface CapabilityRouteCertification {
  capability: CapabilityId;
  providerId: string;
  modelId: string;
  /** Adapter id (e.g. "openrouter", "openai"). Vision additionally
   *  cares about the adapter image-transport path. */
  adapterPath: string;
  tier: CapabilityTier;
  evidence: CapabilityEvidenceRef[];
  affectsLeaderboard: false;
  affectsCertification: false;
  generatedAt: string;
  commit?: string;
  notes?: string;
}

/** A single blocking condition discovered by the promotion evaluator.
 *  Each failure cites the gate name + a human-readable reason + the
 *  evidence refs that were available when the gate was evaluated. */
export interface CapabilityGateFailure {
  /** Dotted gate id, e.g. `"vision.stable.repeat-runs"`. */
  gate: string;
  reason: string;
  evidenceRefs: CapabilityEvidenceRef[];
}

/** Read-only promotion-decision payload returned by
 *  `evaluatePromotion()`. The evaluator never mutates any registry;
 *  the decision is operator-facing data. */
export interface CapabilityPromotionDecision {
  eligible: boolean;
  capability: CapabilityId;
  providerId: string;
  modelId: string;
  currentTier: CapabilityTier;
  proposedTier: CapabilityTier;
  blockingReasons: CapabilityGateFailure[];
  evidenceRefs: CapabilityEvidenceRef[];
  generatedAt: string;
  /** Doctrine v1: capability tier never affects leaderboard composite. */
  affectsLeaderboard: false;
  /** Doctrine v1: capability tier never affects model-certification tier. */
  affectsCertification: false;
}

/** Threshold bundle for a (capability, tier) gate. Used by
 *  `evaluatePromotion()` to test whether the proposed promotion is
 *  eligible against current evidence counts. */
export interface CapabilityGateSpec {
  capability: CapabilityId;
  tier: CapabilityTier;
  /** Minimum number of POC tests required in the live profile. */
  minSuiteSize: number;
  /** Minimum repeat-run count required for stability evidence. */
  minRepeatRuns: number;
  /** Minimum stable-pass rate (0.0–1.0) across all (test × run) cells. */
  minStablePassRate: number;
  /** Minimum number of independent (provider × model-family) routes
   *  that must have run the suite during validation. */
  minIndependentRoutes: number;
  /** Attribution categories that, when recurring, immediately block
   *  promotion to this tier. */
  disallowedRecurringAttributions: string[];
  /** If true, the gate requires the evidenceRefs array to be non-empty
   *  (every promotion above EXPERIMENTAL must cite at least one report). */
  requiresEvidence: boolean;
}
