/**
 * Crucibulum — Score Store
 * SQLite-backed score storage with query and leaderboard support.
 */

import Database from "better-sqlite3";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ModelScore, ScoreSource, ScoreFamily, LeaderboardEntry, FAMILY_WEIGHTS } from "../types/scores.js";
import { log } from "../utils/logger.js";

const STATE_DIR = resolve(process.env["CRUCIBULUM_STATE_DIR"] ?? join(process.cwd(), "state"));
const DB_PATH = join(STATE_DIR, "scores.db");

let db: InstanceType<typeof Database> | null = null;

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
      source TEXT NOT NULL DEFAULT 'crucibulum',
      runId TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_scores_model ON scores(modelId);
    CREATE INDEX IF NOT EXISTS idx_scores_family ON scores(family);
    CREATE INDEX IF NOT EXISTS idx_scores_task ON scores(taskId);
    CREATE INDEX IF NOT EXISTS idx_scores_timestamp ON scores(timestamp DESC);
  `);

  log("info", "score-store", `Score store initialized at ${DB_PATH}`);
  return db;
}

// ── Store scores ─────────────────────────────────────────────────────────

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
      duration_ms, tokensUsed, costEstimate, anomalyFlags, timestamp, metadata, source, runId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

// ── Query scores ─────────────────────────────────────────────────────────

export interface ScoreQuery {
  modelId?: string | undefined;
  family?: string | undefined;
  taskId?: string | undefined;
  source?: string | undefined;
  limit?: number | undefined;
}

interface ScoreRow {
  id: number;
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
  source: string;
  runId: string | null;
  created_at: string;
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
    `SELECT * FROM scores ${where} ORDER BY timestamp DESC LIMIT ?`
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
  }));
}

// ── Leaderboard ──────────────────────────────────────────────────────────

const WEIGHTS: Record<string, number> = {
  A: 0.20, B: 0.25, C: 0.25, D: 0.10, E: 0.05, F: 0.05, G: 0.05, H: 0.05, I: 0.05,
};

interface LeaderboardRow {
  modelId: string;
  family: string;
  avg_score: number;
  total_runs: number;
  last_run: string;
  source: string;
}

export function getLeaderboard(): LeaderboardEntry[] {
  const database = getDb();

  // Get average score per model per family
  const rows = database.prepare(`
    SELECT modelId, family, AVG(score) as avg_score, COUNT(*) as total_runs,
           MAX(timestamp) as last_run, source
    FROM scores
    GROUP BY modelId, family
    ORDER BY modelId, family
  `).all() as LeaderboardRow[];

  // Group by model
  const models = new Map<string, { families: Record<string, number>; totalRuns: number; lastRun: string; source: string }>();

  for (const row of rows) {
    if (!models.has(row.modelId)) {
      models.set(row.modelId, { families: {}, totalRuns: 0, lastRun: "", source: row.source });
    }
    const model = models.get(row.modelId)!;
    model.families[row.family] = Math.round(row.avg_score * 100) / 100;
    model.totalRuns += row.total_runs;
    if (row.last_run > model.lastRun) model.lastRun = row.last_run;
    model.source = row.source;
  }

  // Compute weighted composite
  const entries: LeaderboardEntry[] = [];
  for (const [modelId, data] of models) {
    let weightedSum = 0;
    let weightTotal = 0;
    const familyScores: Record<ScoreFamily, number | null> = { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null };

    for (const [family, weight] of Object.entries(WEIGHTS)) {
      const score = data.families[family];
      familyScores[family as ScoreFamily] = score ?? null;
      if (score !== undefined) {
        weightedSum += score * weight;
        weightTotal += weight;
      }
    }

    const composite = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : 0;

    entries.push({
      modelId,
      composite,
      families: familyScores,
      totalRuns: data.totalRuns,
      lastRun: data.lastRun,
      source: data.source as ScoreSource,
    });
  }

  entries.sort((a, b) => b.composite - a.composite);
  return entries;
}

export function closeScoreStore(): void {
  if (db) {
    db.close();
    db = null;
  }
}
