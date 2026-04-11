/**
 * Crucibulum — Unified Score Schema
 * Shared between Crucible (Squidley) and Crucibulum (standalone).
 *
 * Public score APIs use 0-100 percentages.
 * Internal run bundles still use 0-1 fractions until the bundle schema is migrated.
 */
export type ScoreFamily = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
export type ScoreSource = "crucible" | "crucibulum" | "veritor" | "verum";
export type CanonicalTaskFamily = "poison_localization" | "spec_discipline" | "orchestration" | "identity" | "truthfulness" | "cost_efficiency" | "personality" | "safety" | "memory";
export interface ScoreFamilySpec {
    id: ScoreFamily;
    label: string;
    description: string;
    taskFamilies: CanonicalTaskFamily[];
    weight: number;
}
export interface ModelScore {
    modelId: string;
    taskId: string;
    family: ScoreFamily;
    category: string;
    passed: boolean;
    score: number;
    rawScore: number;
    duration_ms: number;
    tokensUsed?: number | undefined;
    costEstimate?: number | undefined;
    anomalyFlags?: string[] | undefined;
    timestamp: string;
    metadata?: Record<string, unknown> | undefined;
}
export interface ScoreSyncRequest {
    scores: ModelScore[];
    source: ScoreSource;
    runId?: string;
}
export interface ScoreSyncResponse {
    ok: boolean;
    stored: number;
    errors: string[];
}
export interface VerumAttackResult {
    caseId: string;
    category: string;
    family?: ScoreFamily | undefined;
    attackClass: string;
    passed: boolean;
    score: number;
    rawScore?: number | undefined;
    duration_ms: number;
    tokensUsed?: number | undefined;
    costEstimate?: number | undefined;
    anomalyFlags?: string[] | undefined;
    timestamp: string;
    transcriptHash?: string | undefined;
    rubricVersion?: string | undefined;
    notes?: string | undefined;
}
export interface VerumIngestRequest {
    modelId: string;
    provider: string;
    adapter: string;
    runId?: string | undefined;
    results: VerumAttackResult[];
}
export interface VerumIngestResponse extends ScoreSyncResponse {
    source: "verum";
}
export interface LeaderboardEntry {
    modelId: string;
    composite: number;
    families: Record<ScoreFamily, number | null>;
    totalRuns: number;
    lastRun: string;
    source: ScoreSource;
}
/**
 * Canonical public score-family taxonomy.
 *
 * The benchmark task corpus uses descriptive task-family IDs such as
 * "poison_localization" and "truthfulness". Public rollups still use lettered
 * families for compatibility with the shared score DB, but the mapping lives
 * here so API, UI, docs, and score storage can use a single source of truth.
 */
export declare const SCORE_FAMILY_SPECS: Record<ScoreFamily, ScoreFamilySpec>;
/** Public leaderboard weights derived from the canonical family specs. */
export declare const FAMILY_WEIGHTS: Record<ScoreFamily, number>;
export declare const SCORE_FAMILIES: ScoreFamily[];
export declare function taskFamiliesForScoreFamilies(families: ScoreFamily[] | null): CanonicalTaskFamily[];
/** Convert an internal 0-1 run score to a public 0-100 percentage. */
export declare function fractionToPercent(value: number): number;
/** Convert a public 0-100 percentage to an internal 0-1 fraction. */
export declare function percentToFraction(value: number): number;
/**
 * Accept either legacy 0-1 fractions or canonical 0-100 percentages and
 * return a canonical 0-100 percentage for display and public APIs.
 */
export declare function canonicalPercent(value: number): number;
//# sourceMappingURL=scores.d.ts.map