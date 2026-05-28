#!/usr/bin/env node
/**
 * Luak — Lane Diagnostic
 *
 * Reads existing bundle files under runs/ for a chosen lane and prints
 * per-model counters that surface the kind of pipeline drift the
 * "universal 15% safety score" audit was tracking. No network calls — this
 * is a passive auditor.
 *
 * Usage:
 *   node scripts/lane-diagnostic.mjs <lane>
 *
 * Where <lane> is one of: safety, benchmark, poison, build, memory,
 * personality, identity, truthfulness, code, classification, workflow,
 * reasoning, summarization, instruction-obedience, prompt-sensitivity,
 * role-stress, context-degradation, token-efficiency, thinking-mode.
 *
 * For each model, prints:
 *   • selected lane / selected models / selected task ids
 *   • runs counted / completed / NC
 *   • provider error / network error / model failure / pass counts
 *   • raw score components (correctness, regression, integrity, efficiency)
 *   • final score
 *   • refusal_quality pass/fail breakdown when conversational evidence
 *     is present in the bundle
 *
 * Designed to be safe to run against the production runs/ directory.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL(".", import.meta.url).pathname, "..");
const RUNS_DIR = process.env.CRUCIBULUM_RUNS_DIR ?? join(ROOT, "runs");

// Lane → manifest task-family mapping. Mirrors TAB_CONFIG in ui/index.html.
// If the UI lane list changes, this table must stay in sync — the test suite
// pins it via tests/lane-scoring.test.ts to guard against drift.
const LANES = {
  safety: ["safety"],
  benchmark: ["spec_discipline", "truthfulness", "cost_efficiency"],
  poison: ["poison_localization"],
  build: ["orchestration"],
  memory: ["memory"],
  personality: ["personality", "identity"],
  tools: ["tool_calling"],
  trust: ["operational_trust"],
  // Experimental scaffolds (2026-05-25) — Roleplay + Vision.
  // Listed so diagnostic tooling can drill into them; lane is not
  // ranked on the leaderboard until promoted out of Experimental.
  roleplay: ["roleplay"],
  vision: ["vision"],
};

function usage() {
  console.error(`Usage: node scripts/lane-diagnostic.mjs <lane>`);
  console.error(`  Lanes: ${Object.keys(LANES).join(", ")}`);
  console.error(`  Or pass a comma-separated task family list directly.`);
  process.exit(2);
}

const arg = process.argv[2];
if (!arg) usage();
const families = LANES[arg] ?? arg.split(",").map((s) => s.trim()).filter(Boolean);
if (families.length === 0) usage();

if (!existsSync(RUNS_DIR)) {
  console.error(`runs/ not found at ${RUNS_DIR}`);
  process.exit(2);
}

const bundles = [];
for (const file of readdirSync(RUNS_DIR)) {
  if (!file.endsWith(".json") || file.endsWith(".crucible.json")) continue;
  try {
    const raw = readFileSync(join(RUNS_DIR, file), "utf-8");
    const bundle = JSON.parse(raw);
    if (!bundle?.task?.family) continue;
    if (!families.includes(bundle.task.family)) continue;
    bundles.push(bundle);
  } catch {
    /* ignore parse failures — those are a different kind of incident */
  }
}

console.log(`Lane: ${arg}`);
console.log(`Families: ${families.join(", ")}`);
console.log(`Runs directory: ${RUNS_DIR}`);
console.log(`Bundles read: ${bundles.length}`);
console.log("");

if (bundles.length === 0) {
  console.log(`(no bundles found for families [${families.join(", ")}])`);
  process.exit(0);
}

const tasks = new Set();
const models = new Map();
for (const b of bundles) {
  tasks.add(b.task.id);
  const key = `${b.agent?.adapter ?? "?"}:${b.agent?.provider ?? "?"}:${b.agent?.model ?? "?"}`;
  if (!models.has(key)) {
    models.set(key, {
      key,
      adapter: b.agent?.adapter,
      provider: b.agent?.provider,
      model: b.agent?.model,
      runs: 0,
      completed: 0,
      nc: 0,
      modelFailures: 0,
      providerErrors: 0,
      networkErrors: 0,
      otherErrors: 0,
      judgeErrors: 0,
      harnessErrors: 0,
      passes: 0,
      scoreTotals: [],
      scoringScoreTotals: [], // excludes NC — leaderboard-equivalent
      inflatedZeroCorrectness: 0, // C=0 but total>=10% (legacy bundles)
      breakdowns: { correctness: [], regression: [], integrity: [], efficiency: [] },
      perQuestionPassed: 0,
      perQuestionFailed: 0,
      refusalQualityResults: 0,
      providerAttempts: 0,
      anomalyFlags: new Set(),
    });
  }
  const m = models.get(key);
  m.runs += 1;
  const verdict = b.verdict ?? {};
  if (verdict.completionState === "PASS") m.passes += 1;
  if (verdict.completionState === "NC") m.nc += 1;
  if (verdict.completionState === "FAIL") m.completed += 1;
  if (verdict.failureOrigin === "MODEL") m.modelFailures += 1;
  else if (verdict.failureOrigin === "PROVIDER") m.providerErrors += 1;
  else if (verdict.failureOrigin === "NETWORK") m.networkErrors += 1;
  else if (verdict.failureOrigin === "JUDGE" || verdict.failureOrigin === "TEST") m.judgeErrors += 1;
  else if (verdict.failureOrigin === "HARNESS") m.harnessErrors += 1;
  else if (verdict.failureOrigin && verdict.failureOrigin !== null) m.otherErrors += 1;
  const total = Number(b.score?.total ?? 0);
  const c = Number(b.score?.breakdown?.correctness ?? 0);
  m.scoreTotals.push(total);
  // Leaderboard-equivalent: only count toward capability average when this
  // run actually completed end-to-end.
  if (verdict.countsTowardModelScore !== false && verdict.completionState !== "NC") {
    m.scoringScoreTotals.push(total);
  }
  if (c === 0 && total >= 0.10) m.inflatedZeroCorrectness += 1;
  m.breakdowns.correctness.push(c);
  m.breakdowns.regression.push(Number(b.score?.breakdown?.regression ?? 0));
  m.breakdowns.integrity.push(Number(b.score?.breakdown?.integrity ?? 0));
  m.breakdowns.efficiency.push(Number(b.score?.breakdown?.efficiency ?? 0));
  m.providerAttempts += Array.isArray(b.provider_attempts) ? b.provider_attempts.length : 0;
  const convResults = b.conversational?.results;
  if (Array.isArray(convResults)) {
    for (const r of convResults) {
      m.refusalQualityResults += 1;
      if (r.passed) m.perQuestionPassed += 1;
      else m.perQuestionFailed += 1;
    }
  }
}

const avg = (xs) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
const pct = (x) => `${Math.round(x * 100)}%`;

console.log(`Task ids in scope (${tasks.size}): ${[...tasks].sort().join(", ")}`);
console.log(`Models in scope (${models.size}):`);
for (const m of models.values()) {
  console.log("");
  console.log(`  ▸ ${m.model}  [${m.adapter}/${m.provider}]`);
  console.log(`      runs:                 ${m.runs}`);
  console.log(`      passes:               ${m.passes}`);
  console.log(`      FAIL (completed):     ${m.completed}`);
  console.log(`      NC:                   ${m.nc}`);
  console.log(`      failureOrigin counts: MODEL=${m.modelFailures}  PROVIDER=${m.providerErrors}  NETWORK=${m.networkErrors}  JUDGE/TEST=${m.judgeErrors}  HARNESS=${m.harnessErrors}  OTHER=${m.otherErrors}`);
  console.log(`      provider attempts:    ${m.providerAttempts}`);
  console.log(`      per-question:         pass=${m.perQuestionPassed}  fail=${m.perQuestionFailed}  total=${m.refusalQualityResults}`);
  console.log(`      score components avg: correctness=${pct(avg(m.breakdowns.correctness))}  regression=${pct(avg(m.breakdowns.regression))}  integrity=${pct(avg(m.breakdowns.integrity))}  efficiency=${pct(avg(m.breakdowns.efficiency))}`);
  console.log(`      final score avg:      ${pct(avg(m.scoreTotals))}  (range ${pct(Math.min(...m.scoreTotals))}–${pct(Math.max(...m.scoreTotals))})`);
  if (m.scoringScoreTotals.length !== m.scoreTotals.length) {
    console.log(`      leaderboard-equivalent (NC excluded): ${m.scoringScoreTotals.length === 0 ? '(no scoring-eligible runs)' : `${pct(avg(m.scoringScoreTotals))} over ${m.scoringScoreTotals.length} runs`}`);
  }
  if (m.inflatedZeroCorrectness > 0) {
    console.log(`      ⚠ ${m.inflatedZeroCorrectness} bundle(s) with C=0 but stored total≥10% — pre-fix inflation, will not reproduce on new runs`);
  }
}

// Cross-model collapse heuristic — if every model has the *same* avg total,
// that's the universal-floor signature the safety audit chased.
const uniqueTotals = new Set([...models.values()].map((m) => Math.round(avg(m.scoreTotals) * 100)));
console.log("");
if (uniqueTotals.size === 1 && models.size > 1) {
  const sharedPct = [...uniqueTotals][0];
  // A collapse to a high score (e.g. 100% across the board) is "everyone
  // passed" — not the safety-15% pathology. Only treat sub-passing
  // collapse as a scoring-bug signal.
  if (sharedPct < 60) {
    console.log(`⚠ All ${models.size} models share the same sub-passing average total (${sharedPct}%) — likely scoring collapse, investigate before trusting.`);
  } else {
    console.log(`ℹ All ${models.size} models converged on ${sharedPct}% — every model passed equally, not a bug shape.`);
  }
} else {
  console.log(`Distinct average totals across ${models.size} models: ${uniqueTotals.size}`);
}

// All-failed warning
const allModelsAllFailed = [...models.values()].every((m) => m.passes === 0 && m.runs > 0);
if (allModelsAllFailed && models.size > 0) {
  console.log(`⚠ Every model in this lane shows 0 passes — verify the judge or provider before trusting the leaderboard.`);
}
// All-provider-failed warning
const allModelsAllProviderFailed = [...models.values()].every((m) => m.providerErrors + m.networkErrors >= m.runs && m.runs > 0);
if (allModelsAllProviderFailed && models.size > 0) {
  console.log(`⚠ Every model in this lane is a provider/network NC — leaderboard scores are not capability signals.`);
}
// Inflated-zero-correctness population
const inflatedPop = [...models.values()].reduce((s, m) => s + m.inflatedZeroCorrectness, 0);
if (inflatedPop > 0) {
  console.log(`⚠ ${inflatedPop} bundle(s) in this lane carry the pre-fix C=0/total≥10% inflation shape. Backend aggregation now excludes NC; re-run to refresh stored bundles.`);
}
