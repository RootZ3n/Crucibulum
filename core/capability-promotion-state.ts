/**
 * Luak — capability-promotion state.
 *
 * Persistent state file (`data/capability-certifications.json`) and
 * immutable promotion receipts (`reports/capability-promotions/<cap>/<ts>.{json,md}`)
 * for the doctrine-aware Vision capability promotion write phase
 * (Phase 16 / Roadmap follow-up to Phase D + E).
 *
 * Doctrinal guarantees encoded in this module:
 *
 *   - Capability promotion state is **separate from**
 *     `MODEL_CERTIFICATION.models[]` and from
 *     `reports/model-certification/certified-models.json`. Promoting a
 *     capability tier does NOT mutate either of those.
 *   - Every state payload + every receipt carries literal-false
 *     `affectsLeaderboard` and `affectsCertification` fields. These
 *     are doctrine guarantees, not negotiable per call.
 *   - Test isolation: the state directory is overridable via
 *     `process.env.CRUCIBLE_CAPABILITY_STATE_DIR` (similar to
 *     `CRUCIBULUM_STATE_DIR`). Tests set this to a tmp dir so they
 *     never write to the real `data/` directory.
 *   - Reports directory is overridable via
 *     `process.env.CRUCIBLE_CAPABILITY_REPORTS_DIR` (defaults to
 *     `reports/capability-promotions/`).
 *   - Receipts are content-addressed by ISO-Z timestamp and are
 *     append-only. Existing receipts are never rewritten.
 *
 * The state file lives at `<state-dir>/capability-certifications.json`
 * (no nested capability dirs — the JSON itself keys by capability).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type {
  CapabilityId,
  CapabilityTier,
  CapabilityPromotionDecision,
  CapabilityEvidenceRef,
} from "./capability-certification-types.js";

const STATE_FILE_NAME = "capability-certifications.json";

export const STATE_SCHEMA = "crucible.capability-certifications.v1";
export const RECEIPT_SCHEMA = "crucible.capability-promotion-receipt.v1";

/** Resolve the capability-state directory. Override with
 *  `LUAK_CAPABILITY_STATE_DIR` (legacy: `CRUCIBLE_CAPABILITY_STATE_DIR`)
 *  for test isolation; defaults to the repo's `data/` directory. */
export function capabilityStateDir(): string {
  return process.env["LUAK_CAPABILITY_STATE_DIR"]
    ?? process.env["CRUCIBLE_CAPABILITY_STATE_DIR"]
    ?? join(process.cwd(), "data");
}

/** Resolve the capability-receipt root directory. Override with
 *  `LUAK_CAPABILITY_REPORTS_DIR` (legacy: `CRUCIBLE_CAPABILITY_REPORTS_DIR`)
 *  for test isolation; defaults to the repo's
 *  `reports/capability-promotions/` directory. */
export function capabilityReceiptRoot(): string {
  return process.env["LUAK_CAPABILITY_REPORTS_DIR"]
    ?? process.env["CRUCIBLE_CAPABILITY_REPORTS_DIR"]
    ?? join(process.cwd(), "reports", "capability-promotions");
}

export function capabilityStatePath(): string {
  return join(capabilityStateDir(), STATE_FILE_NAME);
}

/** Per-capability promotion record. The structural literal-false
 *  fields are doctrine guarantees; if a future schema needs to make
 *  them mutable, the schema version MUST bump. */
export interface CapabilityCertificationState {
  schema: string;
  capabilities: {
    [capability in CapabilityId]?: {
      tier: CapabilityTier;
      promoted: true;
      promotedAt: string;
      promotedBy: string;
      promotionReceipt: string;
      operatorNote: string | null;
      evidence: {
        aggregateDecision: CapabilityPromotionDecision;
        qualifyingFamilies: string[];
        qualifyingRoutes: Array<{ provider: string; model: string; family: string }>;
        sourceReports: CapabilityEvidenceRef[];
        suiteSize: number;
        repeatRuns: number;
        stablePassRate: number;
      };
      /** Doctrine guarantees — non-negotiable per call. */
      affectsLeaderboard: false;
      affectsCertification: false;
    };
  };
}

/** Read the on-disk state file. Returns an empty (no-capabilities)
 *  state when the file is missing — this is the default at fresh
 *  checkout. Throws only when the file exists but is corrupt;
 *  callers should treat that as a hard error rather than promote on
 *  unknown state. */
export function readCapabilityCertificationState(): CapabilityCertificationState {
  const p = capabilityStatePath();
  if (!existsSync(p)) {
    return { schema: STATE_SCHEMA, capabilities: {} };
  }
  const raw = readFileSync(p, "utf-8");
  const parsed = JSON.parse(raw) as CapabilityCertificationState;
  if (parsed.schema !== STATE_SCHEMA) {
    throw new Error(`unknown capability state schema: ${String(parsed.schema)} (expected ${STATE_SCHEMA})`);
  }
  return parsed;
}

/** Convenience accessor: true iff a capability is in `promoted: true`
 *  state on disk. */
export function isCapabilityPromoted(capability: CapabilityId): boolean {
  return readCapabilityCertificationState().capabilities[capability]?.promoted === true;
}

/** Write the state file. Creates the state directory if needed. The
 *  file is overwritten atomically (write-then-rename is not
 *  necessary for a single-process write — the rest of the code base
 *  uses plain `writeFileSync` for state files of this size). */
export function writeCapabilityCertificationState(state: CapabilityCertificationState): void {
  const dir = capabilityStateDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(capabilityStatePath(), JSON.stringify(state, null, 2) + "\n", "utf-8");
}

/** Construct a promotion receipt for a capability. The receipt is a
 *  pure JSON payload; the JSON file path is returned (no markdown
 *  rendering — that lives in the route handler so it can include
 *  operator-supplied prose). */
export interface BuildReceiptInput {
  capability: CapabilityId;
  previousTier: CapabilityTier;
  promotedTier: CapabilityTier;
  aggregateDecision: CapabilityPromotionDecision;
  qualifyingFamilies: string[];
  qualifyingRoutes: Array<{ provider: string; model: string; family: string }>;
  sourceReports: CapabilityEvidenceRef[];
  suiteSize: number;
  repeatRuns: number;
  stablePassRate: number;
  recurringAttributions: string[];
  certifiedModelsJsonSha256Before: string | null;
  certifiedModelsJsonSha256After: string | null;
  modelCertificationTierMutated: boolean;
  operator: string;
  operatorNote: string | null;
  generatedAt: string;
}

export interface CapabilityPromotionReceipt extends BuildReceiptInput {
  schema: typeof RECEIPT_SCHEMA;
  receiptPath: string;
  /** The write itself does mutate the capability-certifications
   *  state file + writes a new receipt file. The doctrine guarantees
   *  below are about what the write DOES NOT touch. */
  noMutationGuarantee: false;
  /** Doctrine guarantees — non-negotiable per call. */
  affectsLeaderboard: false;
  affectsCertification: false;
}

export function buildPromotionReceipt(input: BuildReceiptInput, receiptPath: string): CapabilityPromotionReceipt {
  return {
    ...input,
    schema: RECEIPT_SCHEMA,
    receiptPath,
    noMutationGuarantee: false,
    affectsLeaderboard: false,
    affectsCertification: false,
  };
}

/** Resolve where receipts live for a given capability. */
export function capabilityReceiptDir(capability: CapabilityId): string {
  return join(capabilityReceiptRoot(), capability);
}

/** Write the receipt JSON. Appends a `<ts>.json` file into the
 *  capability's receipt directory; never overwrites existing
 *  receipts (timestamps are second-precision; same-second collisions
 *  are vanishingly rare in operator-driven flows but the caller can
 *  pass a unique-enough timestamp to be safe). */
export function writeReceiptJson(receipt: CapabilityPromotionReceipt): void {
  const dir = capabilityReceiptDir(receipt.capability);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // Receipt path is set at build time; write to exactly that path.
  writeFileSync(receipt.receiptPath, JSON.stringify(receipt, null, 2) + "\n", "utf-8");
}
