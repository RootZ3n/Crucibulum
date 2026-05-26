#!/usr/bin/env node
/**
 * Crucible — Roleplay stability runner (Phase 7)
 *
 * Runs the same 7-test Roleplay POC profile N times against one
 * text-capable provider/model under a hard cost cap, then
 * aggregates per-test and per-turn stability classification:
 *
 *   STABLE_PASS         — every run PASSed
 *   RECURRING_FAIL      — failed in ≥2 runs (same or different reasons)
 *   INTERMITTENT_FAIL   — failed in exactly 1 run; passed otherwise
 *   NEEDS_REVIEW_STABLE — NEEDS_REVIEW attribution in ≥2 runs
 *   MODEL_VARIANCE      — mixed pass/needs-review/fail without clear pattern
 *   SCORER_SUSPECT      — failures share scorer reason despite different
 *                         model responses (suggests over-narrow scorer)
 *   PROMPT_SUSPECT      — every failure attributes PROMPT
 *
 * Roleplay stays Experimental and is excluded from the leaderboard
 * composite + model certification regardless of stability outcome.
 *
 * Usage:
 *   node scripts/roleplay-stability.mjs \
 *     --provider openrouter --model xiaomi/mimo-v2-flash \
 *     --runs 3 --max-cost-usd 1.50 --write-report
 *
 * Reports:
 *   reports/capability-expansion/roleplay-stability/<ts>.{json,md}
 *   reports/capability-expansion/roleplay-stability/latest.{json,md}
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runConversationalTask } from "../dist/core/conversational-runner.js";
import { OpenRouterAdapter } from "../dist/adapters/openrouter.js";
import { OpenAIAdapter } from "../dist/adapters/openai.js";

const PROVIDERS = {
  openrouter: {
    label: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    build: () => new OpenRouterAdapter(),
    initArgs: (model) => ({ model, api_key: process.env.OPENROUTER_API_KEY }),
  },
  openai: {
    label: "OpenAI",
    envKey: "OPENAI_API_KEY",
    build: () => new OpenAIAdapter(),
    initArgs: (model) => ({ model }),
  },
};

// Phase 7 stability profile uses the same 7 live tests as Phase 2+.
const ALL_TESTS = [
  "roleplay-character-001",
  "roleplay-continuity-001",
  "roleplay-drift-001",
  "roleplay-refusal-001",
  "roleplay-continuity-002",
  "roleplay-contradiction-001",
  "roleplay-persona-break-001",
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "reports", "capability-expansion", "roleplay-stability");

function loadEnvFile() {
  const p = join(ROOT, ".env");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf-8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}
loadEnvFile();

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n, def = null) => {
  const i = argv.indexOf(n);
  if (i < 0 || i + 1 >= argv.length) return def;
  return argv[i + 1];
};

if (flag("-h") || flag("--help")) {
  console.log(`
roleplay-stability — Crucible Phase 7 N-run stability profile

  --provider <id>          openrouter | openai (default: openrouter)
  --model <id>             exact model id (required)
  --runs <n>               number of repeats (default 3; clamp 2-10)
  --max-cost-usd <n>       hard cap across all repeats (default 1.50)
  --tests <csv>            explicit task-id list (overrides 7-test default)
  --write-report           Persist JSON + Markdown aggregate reports.
  -h, --help               Show this help.
`);
  process.exit(0);
}

const provider = arg("--provider", "openrouter");
const model = arg("--model", null);
const runs = Math.min(10, Math.max(2, Number(arg("--runs", "3")) || 3));
const maxCostUsd = Number(arg("--max-cost-usd", "1.50")) || 0;
const writeReport = flag("--write-report") || flag("--write");
const explicitTestsArg = arg("--tests", null);

if (!model) {
  console.error("error: --model is required (no default — Phase 7 uses one explicit route per invocation)");
  process.exit(2);
}
if (maxCostUsd <= 0) {
  console.error("error: --max-cost-usd is required (>0)");
  process.exit(2);
}
const providerDef = PROVIDERS[provider];
if (!providerDef) {
  console.error(`error: --provider must be one of ${Object.keys(PROVIDERS).join(", ")} (got: ${provider})`);
  process.exit(2);
}
if (!process.env[providerDef.envKey]) {
  console.error(`error: ${providerDef.envKey} not set in env or .env`);
  process.exit(2);
}

const TESTS = explicitTestsArg
  ? explicitTestsArg.split(",").map((s) => s.trim()).filter(Boolean)
  : [...ALL_TESTS];

function nowStamp() {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z").replace(/[:.]/g, "-");
}
function commitHash() {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf-8" });
  return (r.stdout || "").trim();
}
function dirtyTree() {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf-8" });
  return (r.stdout || "").trim().length > 0;
}

// Same attribution helper as roleplay-smoke.mjs — kept inline to
// keep this script self-contained. If both helpers diverge, prefer
// roleplay-smoke.mjs as the canonical version.
function attributeOutcome(classification, reasonText) {
  const c = String(classification || "").toUpperCase();
  const reason = String(reasonText || "");
  if (c === "PASS") return "PASS";
  if (c.startsWith("SKIPPED_FIXTURE")) return "FIXTURE";
  if (c === "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED" || c === "SKIPPED_UNSUPPORTED_MULTIMODAL" || c === "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE") return "CONFIG";
  if (c === "FAIL_CONFIG" || c === "FAIL_CONFIG_MODEL_CAPABILITY") return "CONFIG";
  if (c === "FAIL_PROVIDER" || c === "PROVIDER_HTTP_ERROR" || c === "PROVIDER_FAILURE") return "PROVIDER";
  if (/NEEDS_REVIEW/i.test(reason)) return "NEEDS_REVIEW";
  if (/\[PROMPT_ECHOED_FORBIDDEN\]|\[CONTEXT=NEGATED_FORBIDDEN_IDENTITY\]|\[CONTEXT=QUOTED_ATTACK_REFUSAL\]/i.test(reason)) return "PROMPT";
  if (/answer too verbose/i.test(reason)) return "SCORER";
  if (/\[SEVERITY=SEVERE/.test(reason) || /FAIL_PRODUCT/i.test(reason)) return "MODEL";
  if (c === "LOW_SCORE") return "MODEL";
  return "MODEL";
}

function summarizeBundle(bundle) {
  const score = bundle?.score || {};
  const verdict = bundle?.verdict || {};
  const usage = bundle?.usage || {};
  const skip = score.skipped === true ? (score.skip_classification || verdict.failureReasonCode || "SKIPPED") : null;
  const classification = skip
    || (verdict.completionState === "PASS" ? "PASS" : verdict.failureReasonCode || verdict.completionState || "UNKNOWN");
  const convResults = (bundle?.conversational?.results) || [];
  const turnSummary = convResults.map((r) => ({
    questionId: r.question_id,
    question: typeof r.question === "string" ? r.question.slice(0, 320) : null,
    passed: !!r.passed,
    failureReason: r.failure_reason || null,
    responsePreview: typeof r.response === "string" ? r.response.slice(0, 320) : null,
  }));
  const firstFailReason = convResults.find((r) => r && r.failure_reason)?.failure_reason || null;
  const reasonText = firstFailReason || verdict?.evidence?.rawError || verdict?.failureReasonSummary || null;
  const attribution = attributeOutcome(classification, reasonText);
  return {
    classification: String(classification).toUpperCase(),
    attribution,
    costUsd: Number(usage.cost_usd || usage.estimated_cost_usd || 0),
    tokensIn: Number(usage.tokens_in || 0),
    tokensOut: Number(usage.tokens_out || 0),
    bundleId: bundle?.bundle_id || null,
    runId: bundle?.run_id || null,
    pass: classification === "PASS",
    turnCount: convResults.length,
    turnSummary,
    firstFailReason: reasonText,
  };
}

async function runOneTest(taskId) {
  const adapter = providerDef.build();
  await adapter.init(providerDef.initArgs(model));
  try {
    const result = await runConversationalTask({
      taskId, adapter, model,
      capabilities: { supportsText: true, supportsRoleplay: true },
    });
    // Persist bundle per-run for evidence preservation. Bundle ids
    // are unique so multiple repeats won't overwrite each other.
    try {
      const runsDir = join(ROOT, "runs");
      mkdirSync(runsDir, { recursive: true });
      const bundleId = result.bundle.bundle_id || `bundle-${Date.now()}`;
      const dateOnly = new Date().toISOString().slice(0, 10);
      const slug = `${dateOnly}_${taskId}_${model.replace(/[/:]/g, "-")}_${String(bundleId).slice(-8)}`;
      const bundlePath = join(runsDir, `run_${slug}.json`);
      writeFileSync(bundlePath, JSON.stringify(result.bundle, null, 2));
      return { result, bundlePath: `runs/${`run_${slug}.json`}` };
    } catch (err) {
      return { result, bundlePath: null };
    }
  } finally {
    if (adapter.teardown) await adapter.teardown();
  }
}

// ── Stability classification ──────────────────────────────────────────────

function classifyTestStability(perRunEntries) {
  const n = perRunEntries.length;
  if (n === 0) return { label: "MODEL_VARIANCE", reason: "no run data" };
  const passes = perRunEntries.filter((r) => r.classification === "PASS").length;
  const fails = perRunEntries.filter((r) => /^(LOW_SCORE|FAIL_)/.test(r.classification || "") && r.attribution !== "NEEDS_REVIEW").length;
  const reviews = perRunEntries.filter((r) => r.attribution === "NEEDS_REVIEW").length;
  const skips = perRunEntries.filter((r) => /^SKIPPED/.test(r.classification || "")).length;
  // Same-reason repeated failures suggest a scorer issue ONLY when
  // the reason itself indicates ambiguity. Phase 8 fix: same-reason
  // failures whose text contains [SEVERITY=…] or [VOICE=…] or
  // [INTENT=…] markers are RECURRING_FAIL (true model pattern). Only
  // NEEDS_REVIEW / AMBIGUOUS markers trigger SCORER_SUSPECT.
  const failReasons = perRunEntries
    .filter((r) => r.classification !== "PASS")
    .map((r) => String(r.firstFailReason || "").slice(0, 240));
  const uniqueFailReasonSet = new Set(failReasons);
  const sameReasonFails = failReasons.length >= 2 && uniqueFailReasonSet.size === 1;
  const sameReasonText = sameReasonFails ? failReasons[0] : "";
  const sameReasonIsAmbiguous = sameReasonFails && /(?:^NEEDS_REVIEW:|AMBIGUOUS|VOICE=AMBIGUOUS)/i.test(sameReasonText);
  // Same-attribution PROMPT pattern.
  const promptAttribs = perRunEntries.filter((r) => r.attribution === "PROMPT").length;
  let label;
  if (passes === n) label = "STABLE_PASS";
  else if (skips === n) label = "STABLE_SKIP";
  else if (reviews >= 2) label = "NEEDS_REVIEW_STABLE";
  else if (sameReasonFails && fails >= 2 && sameReasonIsAmbiguous) label = "SCORER_SUSPECT";
  else if (promptAttribs >= 2 && fails >= 2) label = "PROMPT_SUSPECT";
  else if (fails >= 2) label = "RECURRING_FAIL";
  else if (fails === 1 && passes > 0) label = "INTERMITTENT_FAIL";
  else label = "MODEL_VARIANCE";
  return { label, passes, fails, reviews, skips, runs: n };
}

function classifyTurnStability(perRunTurnEntries) {
  const n = perRunTurnEntries.length;
  if (n === 0) return { label: "MODEL_VARIANCE", runs: 0 };
  const passes = perRunTurnEntries.filter((t) => t.passed).length;
  const reviews = perRunTurnEntries.filter((t) => /^NEEDS_REVIEW:/.test(String(t.failureReason || ""))).length;
  const fails = perRunTurnEntries.filter((t) => !t.passed && !/^NEEDS_REVIEW:/.test(String(t.failureReason || ""))).length;
  const failReasons = perRunTurnEntries
    .filter((t) => !t.passed)
    .map((t) => String(t.failureReason || "").slice(0, 200));
  const sameReasonFails = failReasons.length >= 2 && new Set(failReasons).size === 1;
  let label;
  if (passes === n) label = "STABLE_PASS";
  else if (reviews >= 2) label = "NEEDS_REVIEW_STABLE";
  else if (sameReasonFails && fails >= 2) label = "SCORER_SUSPECT";
  else if (fails >= 2) label = "RECURRING_FAIL";
  else if (fails === 1 && passes > 0) label = "INTERMITTENT_FAIL";
  else label = "MODEL_VARIANCE";
  return { label, passes, fails, reviews, runs: n };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Roleplay stability · provider=${provider} model=${model} runs=${runs} cap=$${maxCostUsd}`);
  console.log(`Tests: ${TESTS.join(", ")}\n`);
  const ts = nowStamp();
  const allRuns = [];
  let totalCost = 0;
  let stopped = false;
  let stopReason = null;

  outer: for (let i = 0; i < runs; i++) {
    console.log(`\n── run ${i + 1}/${runs} ──`);
    const runResults = [];
    for (const taskId of TESTS) {
      if (totalCost >= maxCostUsd) {
        console.log(`  cap reached ($${totalCost.toFixed(4)} >= $${maxCostUsd}) — stopping`);
        stopped = true; stopReason = "cost_cap";
        break outer;
      }
      console.log(`  → ${taskId}`);
      try {
        const { result, bundlePath } = await runOneTest(taskId);
        const s = summarizeBundle(result.bundle);
        s.bundlePath = bundlePath;
        totalCost += s.costUsd;
        console.log(`    ${s.classification} (${s.attribution}) · turns=${s.turnCount} · cost=$${s.costUsd.toFixed(4)}`);
        runResults.push({ taskId, ...s });
        if (["FAIL_CONFIG", "FAIL_PROVIDER", "PROVIDER_HTTP_ERROR", "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE"].includes(s.classification)) {
          console.log(`  classification=${s.classification} — stopping stability profile early`);
          stopped = true; stopReason = s.classification;
          break outer;
        }
      } catch (err) {
        const msg = String((err && err.message) || err).slice(0, 400);
        console.log(`    ERROR · ${msg.slice(0, 200)}`);
        runResults.push({ taskId, classification: "FAIL_HARNESS", attribution: "CONFIG", costUsd: 0, tokensIn: 0, tokensOut: 0, pass: false, turnCount: 0, turnSummary: [], firstFailReason: msg });
        stopped = true; stopReason = "harness_error";
        break outer;
      }
    }
    allRuns.push({
      runIndex: i + 1,
      timestamp: nowStamp(),
      results: runResults,
      totalCostUsd: runResults.reduce((a, r) => a + (r.costUsd || 0), 0),
    });
  }

  // ── Aggregate stability ──────────────────────────────────────────────────
  const stabilityByTest = {};
  for (const taskId of TESTS) {
    const perRun = allRuns
      .map((r) => r.results.find((rs) => rs.taskId === taskId))
      .filter(Boolean);
    const summary = classifyTestStability(perRun);
    const attrCounts = perRun.reduce((a, r) => { const k = r.attribution || "PASS"; a[k] = (a[k] || 0) + 1; return a; }, {});
    const commonAttribution = Object.entries(attrCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
    const failed = perRun.filter((r) => r.classification !== "PASS");
    const representativeReason = (failed[0]?.firstFailReason || "").slice(0, 240) || null;
    stabilityByTest[taskId] = {
      ...summary,
      attributionCounts: attrCounts,
      commonAttribution,
      representativeFailure: representativeReason,
      perRun: perRun.map((r, i) => ({
        runIndex: i + 1,
        classification: r.classification,
        attribution: r.attribution,
        costUsd: r.costUsd,
        bundleId: r.bundleId,
        bundlePath: r.bundlePath,
      })),
    };
  }

  const turnStability = {};
  for (const taskId of TESTS) {
    const perRunTurns = allRuns.map((r) => r.results.find((rs) => rs.taskId === taskId)?.turnSummary || []);
    const allTurnIds = new Set();
    perRunTurns.forEach((ts) => ts.forEach((t) => allTurnIds.add(t.questionId)));
    turnStability[taskId] = {};
    for (const turnId of allTurnIds) {
      const turnsAcrossRuns = perRunTurns.map((ts) => ts.find((t) => t.questionId === turnId)).filter(Boolean);
      turnStability[taskId][turnId] = classifyTurnStability(turnsAcrossRuns);
    }
  }

  const aggregateAttribution = {};
  for (const run of allRuns) {
    for (const r of run.results) {
      const k = r.attribution || "PASS";
      aggregateAttribution[k] = (aggregateAttribution[k] || 0) + 1;
    }
  }

  console.log(`\n── stability summary ──`);
  for (const taskId of TESTS) {
    const s = stabilityByTest[taskId];
    console.log(`  ${taskId.padEnd(30)} ${s.label.padEnd(20)} P:${s.passes||0} F:${s.fails||0} R:${s.reviews||0}`);
  }
  console.log(`\nTotal cost: $${totalCost.toFixed(4)} across ${allRuns.length} runs · attribution rollup: ${JSON.stringify(aggregateAttribution)}`);

  if (writeReport) {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = {
      schema: "crucible.roleplay-stability.v1",
      timestamp: ts,
      commit: commitHash(),
      dirtyTree: dirtyTree(),
      provider,
      model,
      runs: allRuns.length,
      requestedRuns: runs,
      maxCostUsd,
      totalCostUsd: totalCost,
      tests: TESTS,
      stopped,
      stopReason,
      affectsLeaderboard: false,
      affectsCertification: false,
      experimental: true,
      aggregateAttribution,
      stabilityByTest,
      turnStability,
      perRun: allRuns,
    };
    writeFileSync(join(OUT_DIR, `${ts}.json`), JSON.stringify(json, null, 2) + "\n");
    writeFileSync(join(OUT_DIR, "latest.json"), JSON.stringify(json, null, 2) + "\n");
    const md = renderMd(json);
    writeFileSync(join(OUT_DIR, `${ts}.md`), md);
    writeFileSync(join(OUT_DIR, "latest.md"), md);
    console.log(`\nreports: ${OUT_DIR.replace(ROOT + "/", "")}/{${ts},latest}.{json,md}`);
  }

  process.exit(stopReason === "harness_error" ? 1 : 0);
}

function renderMd(j) {
  const testRows = j.tests.map((t) => {
    const s = j.stabilityByTest[t] || {};
    return `| ${t} | ${s.label || "—"} | ${s.passes ?? "—"} | ${s.fails ?? "—"} | ${s.reviews ?? "—"} | ${s.commonAttribution || "—"} |`;
  }).join("\n");
  const turnTables = j.tests.map((t) => {
    const tu = j.turnStability[t] || {};
    const ids = Object.keys(tu).sort();
    if (ids.length === 0) return `### ${t}\n\n_(no turn data)_\n`;
    const rows = ids.map((id) => {
      const e = tu[id] || {};
      return `| ${id} | ${e.label || "—"} | ${e.passes ?? "—"} | ${e.fails ?? "—"} | ${e.reviews ?? "—"} |`;
    }).join("\n");
    return `### ${t}\n\n| Turn | Stability | Pass | Fail | NEEDS_REVIEW |\n|---|---|---:|---:|---:|\n${rows}\n`;
  }).join("\n");
  const failureExcerpts = j.tests.map((t) => {
    const s = j.stabilityByTest[t] || {};
    if (!s.representativeFailure) return null;
    return `- **${t}** — ${String(s.representativeFailure).slice(0, 320)}`;
  }).filter(Boolean).join("\n");
  return `# Roleplay stability report

- **Timestamp (UTC):** ${j.timestamp}
- **Commit:** ${j.commit}${j.dirtyTree ? " (dirty tree)" : ""}
- **Provider/Model:** ${j.provider}/${j.model}
- **Runs completed:** ${j.runs} / ${j.requestedRuns} requested
- **Cost cap:** $${j.maxCostUsd} · **actual:** $${j.totalCostUsd.toFixed(4)}
- **Stopped early:** ${j.stopped ? "yes (" + j.stopReason + ")" : "no"}
- **Affects leaderboard:** ${j.affectsLeaderboard}
- **Affects certification:** ${j.affectsCertification}
- **Experimental:** ${j.experimental}

## Per-test stability

| Task | Stability | Pass | Fail | NEEDS_REVIEW | Common attribution |
|---|---|---:|---:|---:|---|
${testRows}

## Aggregate attribution across runs

${Object.entries(j.aggregateAttribution || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}

## Per-turn stability

${turnTables}

## Representative failure excerpts

${failureExcerpts || "_no failures recorded_"}
`;
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
