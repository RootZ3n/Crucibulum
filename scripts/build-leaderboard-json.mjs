#!/usr/bin/env node
/**
 * build-leaderboard-json.mjs — generate the portfolio leaderboard JSON.
 *
 * Pipeline:
 *   1. Run the luak-scoreboard CLI --leaderboard to get raw per-model reports
 *      (latest run per model, ranked by adjusted pass rate).
 *   2. Apply judge-correction flips from rescore-conversational.mjs so the
 *      leaderboard reflects the CURRENT (fixed) judge, not capture-time
 *      verdicts (op-007 negation, op-002 hedge, roleplay negation fixes).
 *   3. Filter noise: models with < 20 attempted tasks are excluded (e.g.
 *      smoke-test-only models like qwen3.5-9b at 1 task).
 *   4. Emit the portfolio JSON at src/data/luak-leaderboard.json.
 *
 * Usage: node scripts/build-leaderboard-json.mjs <runs-dir> [--date YYYY-MM-DD]
 */

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreConversationalQuestion } from "../dist/core/conversational-judge.js";

const MIN_TASKS = 20; // exclude smoke-test-only models

const argsIn = process.argv.slice(2);
const dateIdx = argsIn.indexOf("--date");
const dateFilter = dateIdx !== -1 ? argsIn[dateIdx + 1] : null;
const runsDir = dateIdx !== -1 ? argsIn[0] : argsIn[0];
const outPath = dateIdx !== -1 ? argsIn[dateIdx + 2] : argsIn[1];

if (!runsDir) {
  console.error("usage: node build-leaderboard-json.mjs <runs-dir> [--date YYYY-MM-DD] [out.json]");
  process.exit(1);
}

// 1. Raw leaderboard from the scoreboard CLI (luak-scoreboard repo).
const cli = join(process.cwd(), "..", "luak-scoreboard", "dist", "cli.js");
let raw;
try {
  const args = [cli, runsDir, "--leaderboard", "--json"];
  if (dateFilter) args.push("--date", dateFilter);
  raw = JSON.parse(execFileSync("node", args, { encoding: "utf8" }));
} catch (e) {
  console.error("scoreboard CLI failed:", e.message);
  process.exit(1);
}

// 2. Judge-correction flips: for each model, find conversational FAIL runs and
//    re-score with the current judge; collect task->newVerdict overrides.
function judgeFlips(model) {
  const files = readdirSync(runsDir)
    .filter((f) => f.startsWith("run_") && f.endsWith(".json") && !f.endsWith(".hash"))
    .sort();
  const flips = new Map();
  for (const f of files) {
    const m = f.match(/^run_(\d{4}-\d{2}-\d{2})_([^_]+)_([^_]+)_[0-9a-f]+\.json$/);
    if (!m) continue;
    const [, date, task, fModel] = m;
    if (fModel !== model) continue;
    if (dateFilter && date !== dateFilter) continue;

    const d = JSON.parse(readFileSync(join(runsDir, f), "utf8"));
    const conv = d.conversational?.results;
    if (!Array.isArray(conv) || conv.length === 0) continue;
    const oldState = d.verdict?.completionState;
    if (oldState !== "FAIL" && oldState !== "PASS") continue;

    const family = d.task?.family;
    let manifest = null;
    if (family) {
      const famDir = family.replace(/_/g, "-");
      for (const cand of [
        join(process.cwd(), "tasks", famDir, task, "manifest.json"),
        join(process.cwd(), "tasks", family, task, "manifest.json"),
      ]) {
        try { manifest = JSON.parse(readFileSync(cand, "utf8")); break; } catch { /* next */ }
      }
    }
    if (!manifest) continue;

    const qs = manifest.questions || [];
    let allPass = true;
    for (const r of conv) {
      const q = qs.find((qq) => qq.id === r.question_id);
      if (!q) continue;
      if (!scoreConversationalQuestion({ ...q }, r.response).passed) allPass = false;
    }
    const newState = allPass ? "PASS" : "FAIL";
    if (newState !== oldState) flips.set(task, newState);
  }
  return flips;
}

// Apply flips to a scoreboard report's task counts.
function applyFlips(report, flips) {
  if (flips.size === 0) return report;
  let pass = report.tasks.pass;
  let fail = report.tasks.fail;
  let adjPass = pass;
  let adjFail = fail;
  // Families are aggregated in the report; the flip delta applies to totals.
  // We recompute adjusted rate from pass/fail after flips.
  for (const [, newState] of flips) {
    if (newState === "PASS") { pass += 1; fail -= 1; adjPass += 1; adjFail -= 1; }
    else { pass -= 1; fail += 1; adjPass -= 1; adjFail += 1; }
  }
  const total = report.tasks.total;
  const skipped = report.tasks.skipped;
  const attempted = adjPass + adjFail;
  return {
    ...report,
    tasks: { ...report.tasks, pass, fail },
    passRate: {
      raw: total ? pass / total : 0,
      adjusted: attempted ? adjPass / attempted : 0,
      excludedSkipped: skipped,
    },
  };
}

const models = raw.models
  .filter((m) => m.tasks.pass + m.tasks.fail >= MIN_TASKS)
  .map((m) => {
    const flips = judgeFlips(m.model);
    const corrected = applyFlips(m, flips);
    return { ...corrected, flipsApplied: flips.size };
  })
  .sort((a, b) => {
    if (a.passRate.adjusted !== b.passRate.adjusted) return b.passRate.adjusted - a.passRate.adjusted;
    if (a.costUsd !== b.costUsd) return a.costUsd - b.costUsd;
    return a.model < b.model ? -1 : 1;
  })
  .map((m, i) => ({ ...m, rank: i + 1 }));

const out = {
  generated: new Date().toISOString(),
  date: dateFilter ?? raw.date,
  count: models.length,
  models,
};

const outPathFinal = outPath || "leaderboard-output.json";
writeFileSync(outPathFinal, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${outPathFinal}: ${models.length} models`);
for (const m of models) {
  console.log(
    `  #${m.rank} ${m.model} adj ${(m.passRate.adjusted * 100).toFixed(1)}% pass ${m.tasks.pass}/${m.tasks.pass + m.tasks.fail} cost $${m.costUsd.toFixed(4)} flips ${m.flipsApplied}`,
  );
}
