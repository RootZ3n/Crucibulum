/**
 * Crucible — Skip classifiers
 *
 * "Skipped" is not the same as "Failed." A skip means the runner did
 * NOT exercise the model — usually because a precondition wasn't met
 * (no fixture, no capability, family is experimental and excluded
 * from the lane). Skipped results are:
 *
 *   - visible in the UI as a distinct chip
 *   - written to evidence bundles for audit
 *   - excluded from leaderboard composites
 *   - excluded from certification tier promotion
 *   - never counted as model failure, product failure, provider failure,
 *     or config failure (unless the precondition itself was a config bug)
 *
 * Add a new SKIPPED_* constant here and wire it through:
 *   - model-certify.mjs `classifyTier`
 *   - leaderboard composite aggregator
 *   - UI label map (MODEL_CERTIFICATION.tiers / chip rendering)
 *   - the runner's per-question result mapping
 */

export const SKIP_CLASSIFICATIONS = {
  /** Vision/multimodal test requires an image fixture that hasn't been committed yet. */
  SKIPPED_FIXTURE_MISSING: {
    code: "SKIPPED_FIXTURE_MISSING",
    label: "Skipped · fixture missing",
    reason: "Image fixture has not been committed yet (manifest sha256 starts with TBD or fixture file is absent).",
    countsAsFail: false,
    countsAsPromotion: false,
    affectsLeaderboard: false,
    affectsCertification: false,
  },
  /** Vision test run against a model that does not declare supportsVision/supportsImageInput. */
  SKIPPED_UNSUPPORTED_MULTIMODAL: {
    code: "SKIPPED_UNSUPPORTED_MULTIMODAL",
    label: "Skipped · model has no image input",
    reason: "Selected model does not declare supportsVision + supportsImageInput in MODEL_CERTIFICATION.",
    countsAsFail: false,
    countsAsPromotion: false,
    affectsLeaderboard: false,
    affectsCertification: false,
  },
  /** Roleplay test against a model that opted out via supportsRoleplay:false. */
  SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE: {
    code: "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE",
    label: "Skipped · model opted out of roleplay",
    reason: "Selected model declares supportsRoleplay:false (specialised single-shot, embeddings, or operator policy).",
    countsAsFail: false,
    countsAsPromotion: false,
    affectsLeaderboard: false,
    affectsCertification: false,
  },
  /** Any test from a family marked `experimental:true` in TAB_CONFIG. */
  SKIPPED_EXPERIMENTAL_FAMILY: {
    code: "SKIPPED_EXPERIMENTAL_FAMILY",
    label: "Skipped · experimental family",
    reason: "Family is experimental scaffold (e.g. roleplay, vision) and excluded from leaderboard composite by default.",
    countsAsFail: false,
    countsAsPromotion: false,
    affectsLeaderboard: false,
    affectsCertification: false,
  },
} as const;

export type SkipCode = keyof typeof SKIP_CLASSIFICATIONS;

export const SKIP_CODES: ReadonlySet<string> = new Set(
  Object.values(SKIP_CLASSIFICATIONS).map((c) => c.code),
);

/** True if a classification string belongs to the SKIPPED_* family. */
export function isSkipClassification(code: string | null | undefined): boolean {
  if (!code) return false;
  return SKIP_CODES.has(String(code).toUpperCase());
}

/** True if the given classification should be excluded from leaderboard composite. */
export function isExcludedFromLeaderboard(code: string | null | undefined): boolean {
  if (isSkipClassification(code)) return true;
  const upper = String(code || "").toUpperCase();
  return ["FAIL_PROVIDER", "FAIL_CONFIG", "BLOCKED_COST_CAP", "NEEDS_REVIEW"].includes(upper);
}

/** True if a classification should be excluded from tier promotion. */
export function isExcludedFromPromotion(code: string | null | undefined): boolean {
  // Same set as leaderboard exclusion today; kept as a separate API so
  // future promotion-only rules (e.g. needs-human-review) can diverge.
  return isExcludedFromLeaderboard(code);
}

/**
 * Decide whether a vision manifest's fixture is missing.
 * The convention (locked by tests/ui-roleplay-vision-scaffold.test.ts
 * "Guard A") is sha256 starting with the string "TBD".
 */
export function visionFixtureMissing(manifestImageFixture: { sha256?: string; path?: string } | null | undefined): boolean {
  if (!manifestImageFixture) return true;
  const s = String(manifestImageFixture.sha256 || "");
  if (!s || s.startsWith("TBD")) return true;
  return false;
}

/**
 * Decide whether the given model can attempt a vision task.
 * Caller passes the capability snapshot from MODEL_CERTIFICATION.
 */
export function modelCanRunVision(caps: {
  supportsVision?: boolean;
  supportsImageInput?: boolean;
} | null | undefined): boolean {
  if (!caps) return false;
  return caps.supportsVision === true && caps.supportsImageInput === true;
}

/**
 * Decide whether the given model can attempt a roleplay task.
 * Caller passes the capability snapshot from MODEL_CERTIFICATION.
 */
export function modelCanRunRoleplay(caps: {
  supportsRoleplay?: boolean;
} | null | undefined): boolean {
  if (!caps) return true;  // default-on; only explicit opt-out skips
  return caps.supportsRoleplay !== false;
}

/** Manifest shape consumed by preflightSkipCheck. Loose typing — we
 *  intentionally do not pull the full ConversationalManifest type so
 *  this module stays runner-agnostic. */
export interface PreflightManifest {
  family?: string;
  experimental?: boolean;
  requires_capability?: readonly string[];
  image_fixture?: { sha256?: string; path?: string } | null;
}

export interface PreflightCapabilities {
  supportsVision?: boolean;
  supportsImageInput?: boolean;
  supportsRoleplay?: boolean;
}

export interface PreflightSkipResult {
  classification: SkipCode;
  reason: string;
  family: string;
  fixturePath?: string | undefined;
}

/**
 * Inspect manifest + caller-provided model capabilities and decide
 * whether to skip BEFORE making any provider call. Returns null if
 * the runner should proceed; returns a PreflightSkipResult if the
 * runner must record a skip and emit an evidence bundle without
 * spending tokens.
 *
 * Precedence (so the first applicable reason wins):
 *   1. Vision family + missing fixture     → SKIPPED_FIXTURE_MISSING
 *   2. Vision family + no image capability → SKIPPED_UNSUPPORTED_MULTIMODAL
 *   3. Roleplay family + opt-out flag     → SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE
 *
 * Note: SKIPPED_EXPERIMENTAL_FAMILY is NOT applied here — the runner
 * itself still has to execute experimental families when the operator
 * explicitly picks the tab. The leaderboard/cert aggregator is what
 * silently excludes experimental results.
 */
export function preflightSkipCheck(
  manifest: PreflightManifest,
  capabilities: PreflightCapabilities | null | undefined,
): PreflightSkipResult | null {
  const family = String(manifest.family || "");
  if (family === "vision") {
    if (visionFixtureMissing(manifest.image_fixture)) {
      return {
        classification: "SKIPPED_FIXTURE_MISSING",
        reason: SKIP_CLASSIFICATIONS.SKIPPED_FIXTURE_MISSING.reason,
        family,
        fixturePath: manifest.image_fixture?.path,
      };
    }
    if (!modelCanRunVision(capabilities)) {
      return {
        classification: "SKIPPED_UNSUPPORTED_MULTIMODAL",
        reason: SKIP_CLASSIFICATIONS.SKIPPED_UNSUPPORTED_MULTIMODAL.reason,
        family,
        fixturePath: manifest.image_fixture?.path,
      };
    }
  }
  if (family === "roleplay" && !modelCanRunRoleplay(capabilities)) {
    return {
      classification: "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE",
      reason: SKIP_CLASSIFICATIONS.SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE.reason,
      family,
    };
  }
  return null;
}
