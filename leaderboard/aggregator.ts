/**
 * Crucibulum — Leaderboard Aggregator
 * Aggregates evidence bundles into leaderboard entries.
 * Computes pass@k, failure taxonomy, performance metrics.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceBundle } from "../adapters/base.js";

const RUNS_DIR = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
const SUBMISSIONS_DIR = join(process.cwd(), "leaderboard", "submissions");

export interface LeaderboardEntry {
  submission_id: string;
  submitted_at: string;
  bundle_hashes: string[];
  crucibulum_version: string;
  agent: {
    adapter: string;
    model: string;
    system: string;
    system_version: string;
  };
  suite: string;
  tasks_attempted: number;
  tasks_passed: number;
  scores: {
    total: number;
    correctness: number;
    regression: number;
    integrity: number;
    efficiency: number;
  };
  pass_at: Record<string, boolean>;
  failure_taxonomy: Record<string, number>;
  performance: {
    median_time_sec: number;
    p90_time_sec: number;
    median_steps: number;
    total_cost_usd: number;
  };
  verified: boolean;
}

export function loadBundles(): EvidenceBundle[] {
  try {
    return readdirSync(RUNS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => { try { return JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")) as EvidenceBundle; } catch { return null; } })
      .filter((b): b is EvidenceBundle => b !== null);
  } catch { return []; }
}

export function aggregateByModel(bundles: EvidenceBundle[]): Map<string, EvidenceBundle[]> {
  const groups = new Map<string, EvidenceBundle[]>();
  for (const b of bundles) {
    const key = `${b.agent.adapter}:${b.agent.model}`;
    const group = groups.get(key) ?? [];
    group.push(b);
    groups.set(key, group);
  }
  return groups;
}

export function buildLeaderboardEntry(modelKey: string, bundles: EvidenceBundle[]): LeaderboardEntry {
  const first = bundles[0]!;
  const taskResults = new Map<string, EvidenceBundle[]>();
  for (const b of bundles) {
    const arr = taskResults.get(b.task.id) ?? [];
    arr.push(b);
    taskResults.set(b.task.id, arr);
  }

  // pass@k: for each task, did at least 1 run pass?
  const passAt: Record<string, boolean> = {};
  for (const [taskId, runs] of taskResults) {
    passAt[`${taskId}_pass@1`] = runs[0]?.score.pass ?? false;
    passAt[`${taskId}_pass@${runs.length}`] = runs.some(r => r.score.pass);
  }

  // Failure taxonomy
  const failureTaxonomy: Record<string, number> = {};
  for (const b of bundles) {
    if (!b.score.pass && b.diagnosis.failure_mode) {
      failureTaxonomy[b.diagnosis.failure_mode] = (failureTaxonomy[b.diagnosis.failure_mode] ?? 0) + 1;
    }
  }

  // Scores
  const avgTotal = bundles.reduce((s, b) => s + b.score.total, 0) / bundles.length;
  const avgCorrectness = bundles.reduce((s, b) => s + b.score.breakdown.correctness, 0) / bundles.length;
  const avgRegression = bundles.reduce((s, b) => s + b.score.breakdown.regression, 0) / bundles.length;
  const avgIntegrity = bundles.reduce((s, b) => s + b.score.breakdown.integrity, 0) / bundles.length;
  const avgEfficiency = bundles.reduce((s, b) => s + b.score.breakdown.efficiency, 0) / bundles.length;

  // Performance metrics
  const durations = bundles.map(b => {
    const s = new Date(b.environment.timestamp_start).getTime();
    const e = new Date(b.environment.timestamp_end).getTime();
    return Math.round((e - s) / 1000);
  }).sort((a, b) => a - b);

  const steps = bundles.map(b => b.timeline.filter(t => t.type !== "task_start" && t.type !== "task_complete").length).sort((a, b) => a - b);

  const median = (arr: number[]) => arr.length === 0 ? 0 : arr[Math.floor(arr.length / 2)]!;
  const p90 = (arr: number[]) => arr.length === 0 ? 0 : arr[Math.floor(arr.length * 0.9)]!;

  const totalCost = bundles.reduce((s, b) => s + b.usage.estimated_cost_usd, 0);

  const tasksPassedCount = [...taskResults.entries()].filter(([, runs]) => runs.some(r => r.score.pass)).length;

  return {
    submission_id: `sub_${new Date().toISOString().slice(0, 10)}_${modelKey.replace(/[/:]/g, "-")}`,
    submitted_at: new Date().toISOString(),
    bundle_hashes: bundles.map(b => b.bundle_hash),
    crucibulum_version: "1.0.0",
    agent: {
      adapter: first.agent.adapter,
      model: first.agent.model,
      system: first.agent.system,
      system_version: first.agent.system_version,
    },
    suite: "v1",
    tasks_attempted: taskResults.size,
    tasks_passed: tasksPassedCount,
    scores: {
      total: Math.round(avgTotal * 1000) / 1000,
      correctness: Math.round(avgCorrectness * 1000) / 1000,
      regression: Math.round(avgRegression * 1000) / 1000,
      integrity: Math.round(avgIntegrity * 1000) / 1000,
      efficiency: Math.round(avgEfficiency * 1000) / 1000,
    },
    pass_at: passAt,
    failure_taxonomy: failureTaxonomy,
    performance: {
      median_time_sec: median(durations),
      p90_time_sec: p90(durations),
      median_steps: median(steps),
      total_cost_usd: Math.round(totalCost * 10000) / 10000,
    },
    verified: true,
  };
}

export function saveSubmission(entry: LeaderboardEntry): string {
  mkdirSync(SUBMISSIONS_DIR, { recursive: true });
  const filePath = join(SUBMISSIONS_DIR, `${entry.submission_id}.json`);
  writeFileSync(filePath, JSON.stringify(entry, null, 2) + "\n", "utf-8");
  return filePath;
}

export function loadSubmissions(): LeaderboardEntry[] {
  try {
    return readdirSync(SUBMISSIONS_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => { try { return JSON.parse(readFileSync(join(SUBMISSIONS_DIR, f), "utf-8")) as LeaderboardEntry; } catch { return null; } })
      .filter((e): e is LeaderboardEntry => e !== null);
  } catch { return []; }
}
