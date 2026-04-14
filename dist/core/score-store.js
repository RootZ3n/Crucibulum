/**
 * Crucibulum — Score Store
 * SQLite-backed score storage with query and leaderboard support.
 */
import Database from "better-sqlite3";
import { resolve, join } from "node:path";
import { mkdirSync } from "node:fs";
import { FAMILY_WEIGHTS, SCORE_FAMILIES, LEADERBOARD_MIN_N, } from "../types/scores.js";
import { log } from "../utils/logger.js";
const STATE_DIR = resolve(process.env["CRUCIBULUM_STATE_DIR"] ?? join(process.cwd(), "state"));
const DB_PATH = join(STATE_DIR, "scores.db");
let db = null;
function getDb() {
    if (db)
        return db;
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
export function storeScores(scores, source, runId) {
    const database = getDb();
    const errors = [];
    let stored = 0;
    const insert = database.prepare(`
    INSERT INTO scores (modelId, taskId, family, category, passed, score, rawScore,
      duration_ms, tokensUsed, costEstimate, anomalyFlags, timestamp, metadata, source, runId)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
    const insertMany = database.transaction((items) => {
        for (const s of items) {
            try {
                insert.run(s.modelId, s.taskId, s.family, s.category, s.passed ? 1 : 0, s.score, s.rawScore, s.duration_ms, s.tokensUsed ?? null, s.costEstimate ?? null, s.anomalyFlags ? JSON.stringify(s.anomalyFlags) : null, s.timestamp, s.metadata ? JSON.stringify(s.metadata) : null, source, runId ?? null);
                stored++;
            }
            catch (err) {
                errors.push(`${s.taskId}: ${String(err)}`);
            }
        }
    });
    insertMany(scores);
    log("info", "score-store", `Stored ${stored} scores from ${source}${errors.length ? `, ${errors.length} errors` : ""}`);
    return { stored, errors };
}
export function queryScores(query) {
    const database = getDb();
    const conditions = [];
    const params = [];
    if (query.modelId) {
        conditions.push("modelId = ?");
        params.push(query.modelId);
    }
    if (query.family) {
        conditions.push("family = ?");
        params.push(query.family);
    }
    if (query.taskId) {
        conditions.push("taskId = ?");
        params.push(query.taskId);
    }
    if (query.source) {
        conditions.push("source = ?");
        params.push(query.source);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = Math.min(query.limit ?? 100, 1000);
    const rows = database.prepare(`SELECT modelId, taskId, family, category, passed, score, rawScore, duration_ms, tokensUsed, costEstimate, anomalyFlags, timestamp, metadata FROM scores ${where} ORDER BY timestamp DESC LIMIT ?`).all(...params, limit);
    return rows.map((r) => ({
        modelId: r.modelId,
        taskId: r.taskId,
        family: r.family,
        category: r.category,
        passed: !!r.passed,
        score: r.score,
        rawScore: r.rawScore,
        duration_ms: r.duration_ms,
        tokensUsed: r.tokensUsed ?? undefined,
        costEstimate: r.costEstimate ?? undefined,
        anomalyFlags: r.anomalyFlags ? JSON.parse(r.anomalyFlags) : undefined,
        timestamp: r.timestamp,
        metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
    }));
}
export function getLeaderboard(families) {
    const database = getDb();
    const filteredFamilies = Array.isArray(families) && families.length > 0
        ? [...new Set(families)]
        : null;
    const placeholders = filteredFamilies?.map(() => "?").join(", ") ?? "";
    const where = filteredFamilies ? `WHERE family IN (${placeholders})` : "";
    const rows = database.prepare(`
    SELECT modelId, family, AVG(score) as avg_score, COUNT(*) as total_runs,
           SUM(passed) as passed_runs, MAX(timestamp) as last_run, MAX(source) as source
    FROM scores
    ${where}
    GROUP BY modelId, family
    ORDER BY modelId, family
  `).all(...(filteredFamilies ?? []));
    const models = new Map();
    for (const row of rows) {
        if (!models.has(row.modelId)) {
            models.set(row.modelId, { families: {}, totalRuns: 0, passedRuns: 0, lastRun: "", source: row.source });
        }
        const model = models.get(row.modelId);
        model.families[row.family] = Math.round(row.avg_score * 100) / 100;
        model.totalRuns += row.total_runs;
        model.passedRuns += row.passed_runs ?? 0;
        if (row.last_run > model.lastRun)
            model.lastRun = row.last_run;
        model.source = row.source;
    }
    const activeFamilies = filteredFamilies ?? SCORE_FAMILIES;
    const entries = [];
    for (const [modelId, data] of models) {
        let weightedSum = 0;
        let weightTotal = 0;
        const familyScores = { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null };
        for (const family of SCORE_FAMILIES) {
            const score = data.families[family];
            familyScores[family] = score ?? null;
            if (score !== undefined && activeFamilies.includes(family)) {
                weightedSum += score * FAMILY_WEIGHTS[family];
                weightTotal += FAMILY_WEIGHTS[family];
            }
        }
        const composite = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : 0;
        const averagePassRate = data.totalRuns > 0 ? Math.round((data.passedRuns / data.totalRuns) * 100) / 100 : 0;
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
        const confidence = !sampleAdequate
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
            lastRun: data.lastRun,
            source: data.source,
            average_pass_rate: averagePassRate,
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
        if (bRel !== aRel)
            return bRel - aRel;
        if ((b.average_pass_rate ?? 0) !== (a.average_pass_rate ?? 0))
            return (b.average_pass_rate ?? 0) - (a.average_pass_rate ?? 0);
        if ((b.stability_score ?? 0) !== (a.stability_score ?? 0))
            return (b.stability_score ?? 0) - (a.stability_score ?? 0);
        if (b.composite !== a.composite)
            return b.composite - a.composite;
        return a.modelId.localeCompare(b.modelId);
    });
    return entries;
}
//# sourceMappingURL=score-store.js.map