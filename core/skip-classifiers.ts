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
  /** Vision fixture file exists but its sha256 doesn't match the manifest pin.
   * Distinct from FAIL_PRODUCT because no model was exercised — this is a
   * fixture-integrity problem (someone edited the PNG or the manifest hash
   * is stale). Operator should regenerate via scripts/generate-vision-fixtures.py. */
  SKIPPED_FIXTURE_HASH_MISMATCH: {
    code: "SKIPPED_FIXTURE_HASH_MISMATCH",
    label: "Skipped · fixture hash mismatch",
    reason: "Image fixture exists but its sha256 does not match the manifest pin. Regenerate fixtures or update the manifest after intentional change.",
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
  /** Model claims vision but no adapter knows how to encode the image for this provider yet.
   * Distinct from SKIPPED_UNSUPPORTED_MULTIMODAL (which is a model-side gap)
   * because the model COULD answer if the wire format existed. */
  SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED: {
    code: "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED",
    label: "Skipped · adapter cannot ship image",
    reason: "Adapter has no image transport implementation for this provider yet, even though the model declares vision capability.",
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

/** Result of a fixture-disk verification call. */
export type FixtureCheck =
  | { state: "OK"; sha256: string; bytes: number }
  | { state: "MISSING_FILE"; path: string }
  | { state: "HASH_MISMATCH"; path: string; expected: string; actual: string; bytes: number }
  | { state: "READ_ERROR"; path: string; error: string };

/**
 * Verify a vision fixture on disk: file exists, sha256 matches manifest.
 * Returns a structured FixtureCheck the runner translates into either
 * SKIPPED_FIXTURE_MISSING (no file) or SKIPPED_FIXTURE_HASH_MISMATCH
 * (file exists but content drifted from manifest pin).
 *
 * The runtime fs API is injected so callers can stub for unit tests
 * without touching disk.
 */
export interface FixtureFsHandle {
  exists(path: string): boolean;
  read(path: string): Uint8Array;
  sha256Hex(bytes: Uint8Array): string;
}

export function verifyFixtureOnDisk(
  fs: FixtureFsHandle,
  manifestImageFixture: { sha256?: string; path?: string } | null | undefined,
): FixtureCheck {
  if (!manifestImageFixture || !manifestImageFixture.path) {
    return { state: "MISSING_FILE", path: manifestImageFixture?.path || "(unset)" };
  }
  const path = manifestImageFixture.path;
  if (!fs.exists(path)) {
    return { state: "MISSING_FILE", path };
  }
  let bytes: Uint8Array;
  try {
    bytes = fs.read(path);
  } catch (err) {
    return { state: "READ_ERROR", path, error: String((err as Error).message ?? err) };
  }
  const actual = fs.sha256Hex(bytes);
  const expected = String(manifestImageFixture.sha256 || "");
  if (!expected || expected.startsWith("TBD")) {
    // No expected hash to compare against — treat as missing so the
    // runner explicitly waits for the manifest to be pinned. This
    // preserves the "fixture missing" contract even when the file
    // exists but the manifest hasn't been updated.
    return { state: "MISSING_FILE", path };
  }
  if (actual !== expected) {
    return { state: "HASH_MISMATCH", path, expected, actual, bytes: bytes.length };
  }
  return { state: "OK", sha256: actual, bytes: bytes.length };
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
  /** Has the adapter implemented an image transport for this provider/model?
   * If false (or undefined) on a vision task, we skip before provider call. */
  imageTransportImplemented?: boolean;
}

export interface PreflightSkipResult {
  classification: SkipCode;
  reason: string;
  family: string;
  fixturePath?: string | undefined;
  /** Populated for SKIPPED_FIXTURE_HASH_MISMATCH — operator needs both. */
  expectedSha256?: string | undefined;
  actualSha256?: string | undefined;
}

export interface PreflightOptions {
  /** Optional FS handle for fixture verification. If omitted, fixture
   *  presence/integrity isn't checked on disk — the runner only sees
   *  the manifest-sha256-startsWith-TBD case (same as Phase 2 behavior). */
  fs?: FixtureFsHandle;
}

/**
 * Inspect manifest + caller-provided model capabilities and decide
 * whether to skip BEFORE making any provider call. Returns null if
 * the runner should proceed; returns a PreflightSkipResult if the
 * runner must record a skip and emit an evidence bundle without
 * spending tokens.
 *
 * Precedence (so the first applicable reason wins):
 *   1. Vision family + missing fixture (manifest TBD or fs check fail) → SKIPPED_FIXTURE_MISSING
 *   2. Vision family + fixture hash mismatch on disk → SKIPPED_FIXTURE_HASH_MISMATCH
 *   3. Vision family + no image capability on model  → SKIPPED_UNSUPPORTED_MULTIMODAL
 *   4. Vision family + capability OK but no adapter transport → SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED
 *   5. Roleplay family + opt-out flag → SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE
 *
 * Note: SKIPPED_EXPERIMENTAL_FAMILY is NOT applied here — the runner
 * itself still has to execute experimental families when the operator
 * explicitly picks the tab. The leaderboard/cert aggregator is what
 * silently excludes experimental results.
 */
export function preflightSkipCheck(
  manifest: PreflightManifest,
  capabilities: PreflightCapabilities | null | undefined,
  options: PreflightOptions = {},
): PreflightSkipResult | null {
  const family = String(manifest.family || "");
  if (family === "vision") {
    // Step 1: manifest-level TBD detection (no fs lookup needed).
    if (visionFixtureMissing(manifest.image_fixture)) {
      return {
        classification: "SKIPPED_FIXTURE_MISSING",
        reason: SKIP_CLASSIFICATIONS.SKIPPED_FIXTURE_MISSING.reason,
        family,
        fixturePath: manifest.image_fixture?.path,
      };
    }
    // Step 2: optional disk verification — distinguishes "fixture file
    // missing" from "fixture file exists but bytes don't match pin".
    if (options.fs) {
      const check = verifyFixtureOnDisk(options.fs, manifest.image_fixture ?? null);
      if (check.state === "MISSING_FILE") {
        return {
          classification: "SKIPPED_FIXTURE_MISSING",
          reason: SKIP_CLASSIFICATIONS.SKIPPED_FIXTURE_MISSING.reason,
          family,
          fixturePath: check.path,
        };
      }
      if (check.state === "HASH_MISMATCH") {
        return {
          classification: "SKIPPED_FIXTURE_HASH_MISMATCH",
          reason: SKIP_CLASSIFICATIONS.SKIPPED_FIXTURE_HASH_MISMATCH.reason,
          family,
          fixturePath: check.path,
          expectedSha256: check.expected,
          actualSha256: check.actual,
        };
      }
      if (check.state === "READ_ERROR") {
        return {
          classification: "SKIPPED_FIXTURE_MISSING",
          reason: `${SKIP_CLASSIFICATIONS.SKIPPED_FIXTURE_MISSING.reason} (read error: ${check.error})`,
          family,
          fixturePath: check.path,
        };
      }
    }
    // Step 3: model capability gate.
    if (!modelCanRunVision(capabilities)) {
      return {
        classification: "SKIPPED_UNSUPPORTED_MULTIMODAL",
        reason: SKIP_CLASSIFICATIONS.SKIPPED_UNSUPPORTED_MULTIMODAL.reason,
        family,
        fixturePath: manifest.image_fixture?.path,
      };
    }
    // Step 4: adapter transport gate. Default false unless caller
    // explicitly says the adapter implements image transport — keeps
    // us from accidentally calling .chat() with image bytes the adapter
    // has no idea how to forward.
    if (capabilities && capabilities.imageTransportImplemented !== true) {
      return {
        classification: "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED",
        reason: SKIP_CLASSIFICATIONS.SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED.reason,
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
