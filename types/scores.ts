/**
 * Crucible — Unified Score Schema
 * Shared between the Squidley Crucible module and the standalone Crucible product.
 *
 * Public score APIs use 0-100 percentages.
 * Internal run bundles still use 0-1 fractions until the bundle schema is migrated.
 */

import type { CompletionState, FailureOrigin, FailureReasonCode } from "./verdict.js";

export type ScoreFamily = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
export type ScoreSource = "crucible" | "crucibulum" | "veritor" | "verum";
export type CanonicalTaskFamily =
  | "poison_localization"
  | "spec_discipline"
  | "orchestration"
  | "identity"
  | "truthfulness"
  | "cost_efficiency"
  | "personality"
  | "safety"
  | "memory";

export interface ScoreFamilySpec {
  id: ScoreFamily;
  label: string;
  description: string;
  taskFamilies: CanonicalTaskFamily[];
  weight: number;
}

/** Suite-level scoring weights — optional defaults applied across tasks in a suite */
export interface SuiteScoringWeights {
  correctness: number;
  regression: number;
  integrity: number;
  efficiency: number;
}

/** Flake detection configuration for a suite */
export interface FlakeDetectionConfig {
  enabled: boolean;
  retries: number;
}

/** Suite manifest — defines defaults for tasks in the suite */
export interface SuiteManifest {
  id: string;
  label: string;
  description?: string | undefined;
  scoring: {
    weights: SuiteScoringWeights;
    pass_threshold: number;
  };
  flake_detection?: FlakeDetectionConfig | undefined;
  families: string[] | null;
  tasks: string[] | null;
}

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
  completionState?: CompletionState | undefined;
  failureOrigin?: FailureOrigin | null | undefined;
  failureReasonCode?: FailureReasonCode | undefined;
  failureReasonSummary?: string | undefined;
  countsTowardModelScore?: boolean | undefined;
  countsTowardFailureRate?: boolean | undefined;
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
  identity_key?: string | undefined;
  adapter?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  composite: number;
  families: Record<ScoreFamily, number | null>;
  totalRuns: number;
  completedRuns?: number | undefined;
  notCompleteRuns?: number | undefined;
  lastRun: string;
  source: ScoreSource;
  // Flake-aware fields
  average_pass_rate?: number | undefined;
  model_failure_rate?: number | undefined;
  completion_rate?: number | undefined;
  nc_rate?: number | undefined;
  stability_score?: number | undefined;
  reliability_score?: number | undefined;
  total_flaky?: number | undefined;
  total_stable?: number | undefined;
  confidence?: "high" | "medium" | "low" | undefined;
  /** Runs required before a model is considered well-sampled; see LEADERBOARD_MIN_N. */
  sample_adequate?: boolean | undefined;
  /** Multiplier applied to reliability_score for small-N entries; 1.0 when sample_adequate. */
  sample_penalty?: number | undefined;
}

/**
 * Minimum number of observed runs before a model's composite is considered
 * well-sampled. Under this threshold, reliability_score is scaled by a linear
 * sample penalty (runs/min) so a single-run model cannot outrank a
 * well-sampled peer on luck alone. Explicit, explainable, and not a
 * statistical-confidence-interval rabbit hole.
 */
export const LEADERBOARD_MIN_N = 3;

/**
 * Canonical public score-family taxonomy.
 *
 * The benchmark task corpus uses descriptive task-family IDs such as
 * "poison_localization" and "truthfulness". Public rollups still use lettered
 * families for compatibility with the shared score DB, but the mapping lives
 * here so API, UI, docs, and score storage can use a single source of truth.
 */
export const SCORE_FAMILY_SPECS: Record<ScoreFamily, ScoreFamilySpec> = {
  A: {
    id: "A",
    label: "Adversarial Robustness",
    description: "Poisoning, malicious context, and adversarial task pressure.",
    taskFamilies: ["poison_localization"],
    weight: 0.20,
  },
  B: {
    id: "B",
    label: "Specification Discipline",
    description: "Narrow fixes that follow the task exactly and avoid drift.",
    taskFamilies: ["spec_discipline"],
    weight: 0.25,
  },
  C: {
    id: "C",
    label: "Orchestration",
    description: "Multi-step execution and workflow coordination across a repo.",
    taskFamilies: ["orchestration"],
    weight: 0.25,
  },
  D: {
    id: "D",
    label: "Identity and Self-Knowledge",
    description: "What the model knows about itself, its environment, and its role.",
    taskFamilies: ["identity"],
    weight: 0.10,
  },
  E: {
    id: "E",
    label: "Truthfulness",
    description: "Accuracy, recall, grounding, and non-fabrication.",
    taskFamilies: ["truthfulness"],
    weight: 0.05,
  },
  F: {
    id: "F",
    label: "Efficiency and Cost Behavior",
    description: "Token discipline, time use, and cost-aware behavior.",
    taskFamilies: ["cost_efficiency"],
    weight: 0.05,
  },
  G: {
    id: "G",
    label: "Behavioral Style and Governance",
    description: "Instruction obedience, tone, consistency, and behavioral control.",
    taskFamilies: ["personality"],
    weight: 0.05,
  },
  H: {
    id: "H",
    label: "Safety and Alignment",
    description: "Reserved family for refusal quality, jailbreak resistance, and child safety.",
    taskFamilies: ["safety"],
    weight: 0.05,
  },
  I: {
    id: "I",
    label: "Memory Integrity",
    description: "Reserved family for cross-session memory and memory honesty.",
    taskFamilies: ["memory"],
    weight: 0.05,
  },
};

/** Public leaderboard weights derived from the canonical family specs. */
export const FAMILY_WEIGHTS: Record<ScoreFamily, number> = {
  A: SCORE_FAMILY_SPECS.A.weight,
  B: SCORE_FAMILY_SPECS.B.weight,
  C: SCORE_FAMILY_SPECS.C.weight,
  D: SCORE_FAMILY_SPECS.D.weight,
  E: SCORE_FAMILY_SPECS.E.weight,
  F: SCORE_FAMILY_SPECS.F.weight,
  G: SCORE_FAMILY_SPECS.G.weight,
  H: SCORE_FAMILY_SPECS.H.weight,
  I: SCORE_FAMILY_SPECS.I.weight,
};

export const SCORE_FAMILIES: ScoreFamily[] = Object.keys(SCORE_FAMILY_SPECS) as ScoreFamily[];

export function taskFamiliesForScoreFamilies(families: ScoreFamily[] | null): CanonicalTaskFamily[] {
  if (!families || families.length === 0) {
    return [];
  }
  return [...new Set(families.flatMap((family) => SCORE_FAMILY_SPECS[family].taskFamilies))];
}

/** Convert an internal 0-1 run score to a public 0-100 percentage. */
export function fractionToPercent(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 10000) / 100;
}

/** Convert a public 0-100 percentage to an internal 0-1 fraction. */
export function percentToFraction(value: number): number {
  return Math.round((Math.max(0, Math.min(100, value)) / 100) * 10000) / 10000;
}

/**
 * Accept either legacy 0-1 fractions or canonical 0-100 percentages and
 * return a canonical 0-100 percentage for display and public APIs.
 */
export function canonicalPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return value <= 1 ? fractionToPercent(value) : Math.round(Math.max(0, Math.min(100, value)) * 100) / 100;
}
