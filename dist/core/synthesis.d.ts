/**
 * Crucibulum — Synthesis Layer (Veritor Mode)
 *
 * Multi-model comparative analysis engine.
 * Extracts structured claims from evidence bundles, identifies consensus,
 * detects outliers, compares against deterministic truth.
 *
 * CRITICAL: This is advisory analysis only. It NEVER overrides deterministic judge results.
 * All model outputs are treated as untrusted input and sanitized before processing.
 */
import type { EvidenceBundle, SynthesisClaim, SynthesisModelEntry, ConsensusGroup, OutlierGroup, Disagreement, TruthAlignment, SynthesisRecommendation, SynthesisReport, SynthesisSecurityReport } from "../adapters/base.js";
declare function sanitizeText(text: string): {
    clean: string;
    flagged: boolean;
};
/**
 * Normalize a claim string for comparison.
 * Lowercase, strip punctuation, collapse whitespace.
 */
declare function normalizeClaim(text: string): string;
/**
 * Strip code blocks from text to focus on natural language claims.
 */
declare function stripCodeBlocks(text: string): string;
/**
 * Extract structured claims from a single evidence bundle.
 * Claims come from verification results, diagnosis, and timeline — not raw model output.
 * This keeps synthesis deterministic and avoids LLM dependency.
 */
declare function extractClaims(bundle: EvidenceBundle): SynthesisClaim[];
declare function buildConsensusGroups(models: SynthesisModelEntry[]): ConsensusGroup[];
declare function detectOutliers(models: SynthesisModelEntry[], consensus: ConsensusGroup[]): OutlierGroup[];
declare function detectDisagreements(models: SynthesisModelEntry[]): Disagreement[];
/**
 * Compare model consensus/outliers against deterministic truth.
 * Uses the first bundle's deterministic result as ground truth
 * (all bundles should be for the same task).
 */
declare function alignWithTruth(models: SynthesisModelEntry[], consensus: ConsensusGroup[], outliers: OutlierGroup[]): TruthAlignment;
declare function generateRecommendation(models: SynthesisModelEntry[], truthAlignment: TruthAlignment): SynthesisRecommendation | null;
declare function scanBundlesForInjection(bundles: EvidenceBundle[]): SynthesisSecurityReport;
/**
 * Run synthesis analysis across multiple completed evidence bundles.
 * All bundles must be for the same task.
 * Returns a structured, auditable synthesis report.
 *
 * This is pure analysis — no LLM calls, no scoring overrides.
 */
export declare function runSynthesis(bundles: EvidenceBundle[]): SynthesisReport;
export { extractClaims, normalizeClaim, stripCodeBlocks, buildConsensusGroups, detectOutliers, detectDisagreements, alignWithTruth, generateRecommendation, sanitizeText, scanBundlesForInjection, };
//# sourceMappingURL=synthesis.d.ts.map