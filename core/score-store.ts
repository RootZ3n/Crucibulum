/**
 * Crucible — Score Store
 * SQLite-backed score storage with query and leaderboard support.
 */

import Database from "better-sqlite3";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import {
  type ModelScore,
  type ScoreSource,
  type ScoreFamily,
  type LeaderboardEntry,
  FAMILY_WEIGHTS,
  SCORE_FAMILIES,
  LEADERBOARD_MIN_N,
} from "../types/scores.js";
import type { CompletionState, FailureOrigin, FailureReasonCode } from "../types/verdict.js";
import { log } from "../utils/logger.js";
import { crucibleStateRoot } from "../utils/env.js";

const STATE_DIR = crucibleStateRoot();
const DB_PATH = join(STATE_DIR, "scores.db");

let db: InstanceType<typeof Database> | null = null;

function addColumnIfMissing(database: InstanceType<typeof Database>, ddl: string): void {
  try {
    database.exec(ddl);
  } catch (err) {
    if (!String(err).toLowerCase().includes("duplicate column")) {
      throw err;
    }
  }
}

function getDb(): InstanceType<typeof Database> {
  if (db) return db;
  mkdirSync(STATE_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modelId TEXT NOT NULL,
      taskId TEXT NOT NULL,
      family TEXT NOT NULL,
      category TEXT NOT NULL,
      passed INTEGER NOT NULL,
      score REAL NOT NULL,
      rawScore REAL NOT NULL,
      duration_ms INTEGER NOT NULL,
      tokensUsed INTEGER,
      costEstimate REAL,
      anomalyFlags TEXT,
      timestamp TEXT NOT NULL,
      metadata TEXT,
      completionState TEXT,
      failureOrigin TEXT,
      failureReasonCode TEXT,
      failureReasonSummary TEXT,
      countsTowardModelScore INTEGER,
      countsTowardFailureRate INTEGER,
      source TEXT NOT NULL DEFAULT 'crucibulum',
      runId TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scores_model ON scores(modelId);
    CREATE INDEX IF NOT EXISTS idx_scores_family ON scores(family);
    CREATE INDEX IF NOT EXISTS idx_scores_task ON scores(taskId);
    CREATE INDEX IF NOT EXISTS idx_scores_timestamp ON scores(timestamp DESC);
  `);
  addColumnIfMissing(db, "ALTER TABLE scores ADD COLUMN completionState TEXT");
  addColumnIfMissing(db, "ALTER TABLE scores ADD COLUMN failureOrigin TEXT");
  addColumnIfMissing(db, "ALTER TABLE scores ADD COLUMN failureReasonCode TEXT");
  addColumnIfMissing(db, "ALTER TABLE scores ADD COLUMN failureReasonSummary TEXT");
  addColumnIfMissing(db, "ALTER TABLE scores ADD COLUMN countsTowardModelScore INTEGER");
  addColumnIfMissing(db, "ALTER TABLE scores ADD COLUMN countsTowardFailureRate INTEGER");

  log("info", "score-store", `Score store initialized at ${DB_PATH}`);
  return db;
}

export function storeScores(
  scores: ModelScore[],
  source: ScoreSource,
  runId?: string,
): { stored: number; errors: string[] } {
  const database = getDb();
  const errors: string[] = [];
  let stored = 0;

  const insert = database.prepare(`
    INSERT INTO scores (modelId, taskId, family, category, passed, score, rawScore,
      duration_ms, tokensUsed, costEstimate, anomalyFlags, timestamp, metadata,
      completionState, failureOrigin, failureReasonCode, failureReasonSummary,
      countsTowardModelScore, countsTowardFailureRate, source, runId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = database.transaction((items: ModelScore[]) => {
    for (const s of items) {
      try {
        insert.run(
          s.modelId,
          s.taskId,
          s.family,
          s.category,
          s.passed ? 1 : 0,
          s.score,
          s.rawScore,
          s.duration_ms,
          s.tokensUsed ?? null,
          s.costEstimate ?? null,
          s.anomalyFlags ? JSON.stringify(s.anomalyFlags) : null,
          s.timestamp,
          s.metadata ? JSON.stringify(s.metadata) : null,
          s.completionState ?? null,
          s.failureOrigin ?? null,
          s.failureReasonCode ?? null,
          s.failureReasonSummary ?? null,
          s.countsTowardModelScore == null ? null : (s.countsTowardModelScore ? 1 : 0),
          s.countsTowardFailureRate == null ? null : (s.countsTowardFailureRate ? 1 : 0),
          source,
          runId ?? null,
        );
        stored++;
      } catch (err) {
        errors.push(`${s.taskId}: ${String(err)}`);
      }
    }
  });

  insertMany(scores);
  log("info", "score-store", `Stored ${stored} scores from ${source}${errors.length ? `, ${errors.length} errors` : ""}`);
  return { stored, errors };
}

export interface ScoreQuery {
  modelId?: string | undefined;
  family?: string | undefined;
  taskId?: string | undefined;
  source?: string | undefined;
  limit?: number | undefined;
}

interface LeaderboardRow {
  modelId: string;
  family: string;
  avg_score: number;
  total_runs: number;
  passed_runs: number;
  completed_runs: number;
  model_fail_runs: number;
  nc_runs: number;
  last_run: string;
  source: string;
}

interface ScoreRow {
  modelId: string;
  taskId: string;
  family: string;
  category: string;
  passed: number;
  score: number;
  rawScore: number;
  duration_ms: number;
  tokensUsed: number | null;
  costEstimate: number | null;
  anomalyFlags: string | null;
  timestamp: string;
  metadata: string | null;
  completionState: string | null;
  failureOrigin: string | null;
  failureReasonCode: string | null;
  failureReasonSummary: string | null;
  countsTowardModelScore: number | null;
  countsTowardFailureRate: number | null;
}

export function queryScores(query: ScoreQuery): ModelScore[] {
  const database = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.modelId) { conditions.push("modelId = ?"); params.push(query.modelId); }
  if (query.family) { conditions.push("family = ?"); params.push(query.family); }
  if (query.taskId) { conditions.push("taskId = ?"); params.push(query.taskId); }
  if (query.source) { conditions.push("source = ?"); params.push(query.source); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(query.limit ?? 100, 1000);

  const rows = database.prepare(
    `SELECT modelId, taskId, family, category, passed, score, rawScore, duration_ms, tokensUsed, costEstimate, anomalyFlags, timestamp, metadata,
      completionState, failureOrigin, failureReasonCode, failureReasonSummary, countsTowardModelScore, countsTowardFailureRate
      FROM scores ${where} ORDER BY timestamp DESC LIMIT ?`
  ).all(...params, limit) as ScoreRow[];

  return rows.map((r): ModelScore => ({
    modelId: r.modelId,
    taskId: r.taskId,
    family: r.family as ScoreFamily,
    category: r.category,
    passed: !!r.passed,
    score: r.score,
    rawScore: r.rawScore,
    duration_ms: r.duration_ms,
    tokensUsed: r.tokensUsed ?? undefined,
    costEstimate: r.costEstimate ?? undefined,
    anomalyFlags: r.anomalyFlags ? JSON.parse(r.anomalyFlags) as string[] : undefined,
    timestamp: r.timestamp,
    metadata: r.metadata ? JSON.parse(r.metadata) as Record<string, unknown> : undefined,
    completionState: (r.completionState ?? undefined) as CompletionState | undefined,
    failureOrigin: (r.failureOrigin ?? undefined) as FailureOrigin | undefined,
    failureReasonCode: (r.failureReasonCode ?? undefined) as FailureReasonCode | undefined,
    failureReasonSummary: r.failureReasonSummary ?? undefined,
    countsTowardModelScore: r.countsTowardModelScore == null ? undefined : !!r.countsTowardModelScore,
    countsTowardFailureRate: r.countsTowardFailureRate == null ? undefined : !!r.countsTowardFailureRate,
  }));
}

export function getLeaderboard(families?: ScoreFamily[]): LeaderboardEntry[] {
  const database = getDb();
  const filteredFamilies = Array.isArray(families) && families.length > 0
    ? [...new Set(families)]
    : null;

  const placeholders = filteredFamilies?.map(() => "?").join(", ") ?? "";
  const where = filteredFamilies ? `WHERE family IN (${placeholders})` : "";

  const rows = database.prepare(`
    SELECT modelId, family, AVG(score) as avg_score, COUNT(*) as total_runs,
           SUM(CASE
             WHEN completionState = 'PASS' THEN 1
             WHEN completionState IS NULL AND passed = 1 THEN 1
             ELSE 0
           END) as passed_runs,
           SUM(CASE
             WHEN completionState IS NULL THEN 1
             WHEN completionState != 'NC' THEN 1
             ELSE 0
           END) as completed_runs,
           SUM(CASE
             WHEN countsTowardFailureRate = 1 THEN 1
             WHEN countsTowardFailureRate IS NULL AND passed = 0 THEN 1
             ELSE 0
           END) as model_fail_runs,
           SUM(CASE WHEN completionState = 'NC' THEN 1 ELSE 0 END) as nc_runs,
           MAX(timestamp) as last_run, MAX(source) as source
    FROM scores
    ${where}
    GROUP BY modelId, family
    ORDER BY modelId, family
  `).all(...(filteredFamilies ?? [])) as LeaderboardRow[];

  const models = new Map<string, {
    families: Partial<Record<ScoreFamily, number>>;
    totalRuns: number;
    passedRuns: number;
    completedRuns: number;
    modelFailRuns: number;
    notCompleteRuns: number;
    lastRun: string;
    source: string;
  }>();

  for (const row of rows) {
    if (!models.has(row.modelId)) {
      models.set(row.modelId, { families: {}, totalRuns: 0, passedRuns: 0, completedRuns: 0, modelFailRuns: 0, notCompleteRuns: 0, lastRun: "", source: row.source });
    }
    const model = models.get(row.modelId)!;
    model.families[row.family as ScoreFamily] = Math.round(row.avg_score * 100) / 100;
    model.totalRuns += row.total_runs;
    model.passedRuns += (row.passed_runs as number) ?? 0;
    model.completedRuns += (row.completed_runs as number) ?? 0;
    model.modelFailRuns += (row.model_fail_runs as number) ?? 0;
    model.notCompleteRuns += (row.nc_runs as number) ?? 0;
    if (row.last_run > model.lastRun) model.lastRun = row.last_run;
    model.source = row.source;
  }

  const activeFamilies = filteredFamilies ?? SCORE_FAMILIES;
  const entries: LeaderboardEntry[] = [];

  for (const [modelId, data] of models) {
    let weightedSum = 0;
    let weightTotal = 0;
    const familyScores: Record<ScoreFamily, number | null> = { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null };

    for (const family of SCORE_FAMILIES) {
      const score = data.families[family];
      familyScores[family] = score ?? null;
      if (score !== undefined && activeFamilies.includes(family)) {
        weightedSum += score * FAMILY_WEIGHTS[family];
        weightTotal += FAMILY_WEIGHTS[family];
      }
    }

    const composite = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : 0;
    const averagePassRate = data.completedRuns > 0 ? Math.round((data.passedRuns / data.completedRuns) * 100) / 100 : 0;
    // Stability: 1.0 when pass_rate is extreme (all pass or all fail), 0.0 when uncertain (50/50)
    // Formula: 2 * |passRate - 0.5| gives 0 at 50%, 1.0 at 0% or 100%
    const stabilityScore = Math.round(Math.abs(averagePassRate - 0.5) * 2 * 100) / 100;
    // Sample penalty: linearly discount reliability for models with fewer than
    // LEADERBOARD_MIN_N runs. A 1-run model keeps only 1/N of its reliability, a
    // 2-run keeps 2/N, and models at or above the threshold keep the full score.
    // This is intentionally simple — not a confidence interval — so users can
    // read the rank penalty directly.
    const sampleAdequate = data.totalRuns >= LEADERBOARD_MIN_N;
    const samplePenalty = sampleAdequate ? 1 : Math.max(0, data.totalRuns) / LEADERBOARD_MIN_N;
    // Reliability: composite × stability-weighted-factor × sample penalty.
    // A flaky model (stability=0) gets half its composite; a stable model keeps full composite;
    // an under-sampled model gets additionally reduced so it can't outrank well-sampled peers.
    const rawReliability = composite * (0.5 + stabilityScore * 0.5) * samplePenalty;
    const reliabilityScore = Math.round(rawReliability * 100) / 100;
    // Confidence downgrades if the sample is inadequate, regardless of pass rate.
    const confidence: "high" | "medium" | "low" = !sampleAdequate
      ? "low"
      : averagePassRate >= 0.95 && stabilityScore >= 0.8
        ? "high"
        : averagePassRate >= 0.7 || stabilityScore >= 0.5
          ? "medium"
          : "low";

    entries.push({
      modelId,
      composite,
      families: familyScores,
      totalRuns: data.totalRuns,
      completedRuns: data.completedRuns,
      notCompleteRuns: data.notCompleteRuns,
      lastRun: data.lastRun,
      source: data.source as ScoreSource,
      average_pass_rate: averagePassRate,
      model_failure_rate: data.totalRuns > 0 ? Math.round((data.modelFailRuns / data.totalRuns) * 100) / 100 : 0,
      completion_rate: data.totalRuns > 0 ? Math.round((data.completedRuns / data.totalRuns) * 100) / 100 : 0,
      nc_rate: data.totalRuns > 0 ? Math.round((data.notCompleteRuns / data.totalRuns) * 100) / 100 : 0,
      stability_score: stabilityScore,
      reliability_score: reliabilityScore,
      confidence,
      sample_adequate: sampleAdequate,
      sample_penalty: Math.round(samplePenalty * 100) / 100,
    });
  }

  // Sort by reliability-aware score first, then pass_rate, then stability, then composite.
  // Fall back to modelId to guarantee a deterministic, stable ordering when all else ties —
  // otherwise leaderboard rank flaps across reads, which is a UX/consumer hazard.
  entries.sort((a, b) => {
    const aRel = a.reliability_score ?? a.composite;
    const bRel = b.reliability_score ?? b.composite;
    if (bRel !== aRel) return bRel - aRel;
    if ((b.average_pass_rate ?? 0) !== (a.average_pass_rate ?? 0)) return (b.average_pass_rate ?? 0) - (a.average_pass_rate ?? 0);
    if ((b.stability_score ?? 0) !== (a.stability_score ?? 0)) return (b.stability_score ?? 0) - (a.stability_score ?? 0);
    if (b.composite !== a.composite) return b.composite - a.composite;
    return a.modelId.localeCompare(b.modelId);
  });
  return entries;
}
