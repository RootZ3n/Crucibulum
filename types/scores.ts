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
  score: number;        // 0-100
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
export const FAMILY_WEIGHTS: Record<ScoreFamily, number> = {
  A: 0.20,  // Adversarial
  B: 0.25,  // Capability
  C: 0.25,  // Coordination
  D: 0.10,  // Self-Knowledge
  E: 0.05,  // Truthfulness
  F: 0.05,  // Proactive
  G: 0.05,  // Personality
  H: 0.05,  // SWE Benchmark (placeholder)
  I: 0.05,  // Cost/Efficiency (placeholder)
};
