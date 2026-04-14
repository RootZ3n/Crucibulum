/**
 * Crucibulum — Leaderboard Aggregator
 * Aggregates evidence bundles into leaderboard entries.
 * Computes pass@k, failure taxonomy, performance metrics.
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceBundle } from "../adapters/base.js";
import { canonicalPercent } from "../types/scores.js";
import { loadVerifiedBundle } from "../core/bundle.js";
import { log } from "../utils/logger.js";

const RUNS_DIR = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
const SUBMISSIONS_DIR = join(process.cwd(), "leaderboard", "submissions");

export interface LeaderboardEntry {
  submission_id: string;
  submitted_at: string;
  bundle_hashes: string[];
  crucibulum_version: string;
  agent: {
    adapter: string;
    provider: string;
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
  review_signals: {
    disagreement_rate: number;
    qc_disagreement_rate: number;
    review_blocked_rate: number;
  };
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
    const files = readdirSync(RUNS_DIR).filter(f => f.endsWith(".json") && !f.endsWith(".crucible.json"));
    const bundles: EvidenceBundle[] = [];
    for (const f of files) {
      try {
        const bundle = loadVerifiedBundle(readFileSync(join(RUNS_DIR, f), "utf-8"), f);
        if (bundle) bundles.push(bundle);
      } catch (err) {
        log("warn", "aggregator", `Skipping unreadable bundle file ${f}: ${String(err).slice(0, 120)}`);
      }
    }
    return bundles;
  } catch { return []; }
}

export function aggregateByModel(bundles: EvidenceBundle[]): Map<string, EvidenceBundle[]> {
  const groups = new Map<string, EvidenceBundle[]>();
  for (const b of bundles) {
    const key = `${b.agent.adapter}:${b.agent.provider}:${b.agent.model}`;
    const group = groups.get(key) ?? [];
    group.push(b);
    groups.set(key, group);
  }
  return groups;
}

export function buildLeaderboardEntry(modelKey: string, bundles: EvidenceBundle[]): LeaderboardEntry {
  if (bundles.length === 0) {
    throw new Error(`buildLeaderboardEntry: cannot build entry for ${modelKey} with zero bundles`);
  }
  const first = bundles[0]!;
  const taskResults = new Map<string, EvidenceBundle[]>();
  for (const b of bundles) {
    const arr = taskResults.get(b.task.id) ?? [];
    arr.push(b);
    taskResults.set(b.task.id, arr);
  }

  // pass@k: for each task, did at least 1 run pass?
  const passAt: Record<string, boolean> = {};
  const taskPassAt = new Map<string, { pass1: boolean; pass3: boolean | null; pass5: boolean | null }>();
  for (const [taskId, runs] of taskResults) {
    const orderedRuns = [...runs].sort((a, b) => new Date(a.environment.timestamp_start).getTime() - new Date(b.environment.timestamp_start).getTime());
    const pass1 = orderedRuns[0]?.score.pass ?? false;
    const pass3 = orderedRuns.length >= 3 ? orderedRuns.slice(0, 3).some((run) => run.score.pass) : null;
    const pass5 = orderedRuns.length >= 5 ? orderedRuns.slice(0, 5).some((run) => run.score.pass) : null;
    passAt[`${taskId}_pass@1`] = pass1;
    if (pass3 !== null) passAt[`${taskId}_pass@3`] = pass3;
    if (pass5 !== null) passAt[`${taskId}_pass@5`] = pass5;
    passAt[`${taskId}_pass@${orderedRuns.length}`] = orderedRuns.some(r => r.score.pass);
    taskPassAt.set(taskId, { pass1, pass3, pass5 });
  }
  passAt["overall_pass@1"] = [...taskPassAt.values()].every((task) => task.pass1);
  if ([...taskPassAt.values()].every((task) => task.pass3 !== null)) {
    passAt["overall_pass@3"] = [...taskPassAt.values()].every((task) => !!task.pass3);
  }
  if ([...taskPassAt.values()].every((task) => task.pass5 !== null)) {
    passAt["overall_pass@5"] = [...taskPassAt.values()].every((task) => !!task.pass5);
  }

  // Failure taxonomy
  const failureTaxonomy: Record<string, number> = {};
  for (const b of bundles) {
    if (!b.score.pass && b.diagnosis.failure_mode) {
      failureTaxonomy[b.diagnosis.failure_mode] = (failureTaxonomy[b.diagnosis.failure_mode] ?? 0) + 1;
    }
  }

  // Scores
  const avgTotal = bundles.reduce((s, b) => s + canonicalPercent(b.score.total), 0) / bundles.length;
  const avgCorrectness = bundles.reduce((s, b) => s + canonicalPercent(b.score.breakdown.correctness), 0) / bundles.length;
  const avgRegression = bundles.reduce((s, b) => s + canonicalPercent(b.score.breakdown.regression), 0) / bundles.length;
  const avgIntegrity = bundles.reduce((s, b) => s + canonicalPercent(b.score.breakdown.integrity), 0) / bundles.length;
  const avgEfficiency = bundles.reduce((s, b) => s + canonicalPercent(b.score.breakdown.efficiency), 0) / bundles.length;

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
  const disagreementRate = bundles.length === 0 ? 0 : bundles.filter((bundle) => bundle.review?.secondOpinion?.disagreement || bundle.review?.qcReview?.disagreement).length / bundles.length;
  const qcDisagreementRate = bundles.length === 0 ? 0 : bundles.filter((bundle) => bundle.review?.qcReview?.disagreement).length / bundles.length;
  const reviewBlockedRate = bundles.length === 0 ? 0 : bundles.filter((bundle) => !!bundle.review?.security.review_blocked_reason).length / bundles.length;

  const tasksPassedCount = [...taskResults.entries()].filter(([, runs]) => runs.some(r => r.score.pass)).length;
  // Honest verification: submission is verified only if every bundle passed hash re-check on load.
  const allVerified = bundles.every((b) => b.trust.bundle_verified === true);

  return {
    submission_id: `sub_${new Date().toISOString().slice(0, 10)}_${modelKey.replace(/[/:]/g, "-")}`,
    submitted_at: new Date().toISOString(),
    bundle_hashes: bundles.map(b => b.bundle_hash),
    crucibulum_version: "1.0.0",
    agent: {
      adapter: first.agent.adapter,
      provider: first.agent.provider,
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
    review_signals: {
      disagreement_rate: Math.round(disagreementRate * 10000) / 10000,
      qc_disagreement_rate: Math.round(qcDisagreementRate * 10000) / 10000,
      review_blocked_rate: Math.round(reviewBlockedRate * 10000) / 10000,
    },
    performance: {
      median_time_sec: median(durations),
      p90_time_sec: p90(durations),
      median_steps: median(steps),
      total_cost_usd: Math.round(totalCost * 10000) / 10000,
    },
    verified: allVerified,
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
