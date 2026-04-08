/**
 * Crucibulum — Unified Score Schema
 * Shared between Crucible (Squidley) and Crucibulum (standalone).
 */
export type ScoreFamily = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
export type ScoreSource = "crucible" | "crucibulum" | "veritor";
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
export interface LeaderboardEntry {
    modelId: string;
    composite: number;
    families: Record<ScoreFamily, number | null>;
    totalRuns: number;
    lastRun: string;
    source: ScoreSource;
}
/** Design doc family weights */
export declare const FAMILY_WEIGHTS: Record<ScoreFamily, number>;
//# sourceMappingURL=scores.d.ts.map