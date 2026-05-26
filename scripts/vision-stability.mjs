#!/usr/bin/env node
/**
 * Crucible — Vision stability runner (Roadmap Phase B, 2026-05-26).
 *
 * Runs the 5-test Vision POC profile N times against one
 * image-capable provider/model under a hard cost cap, then
 * aggregates per-test and per-turn stability classification.
 *
 * Mirrors `scripts/roleplay-stability.mjs` (Roleplay Phase 7),
 * extended with Vision-specific suspect tiers (FIXTURE_SUSPECT,
 * PROVIDER_SUSPECT, CONFIG_SUSPECT) so recurring attribution
 * patterns from the vision-smoke attributeOutcome surface clearly.
 *
 * Vision stays Experimental and is excluded from the leaderboard
 * composite + model certification regardless of stability outcome.
 * The optional `dryRunGateEligibility` block at the end of the
 * report is a *read-only* eligibility check via the doctrine
 * evaluator — it never promotes anything.
 *
 * Usage (Phase 13-B preferred candidate):
 *   node scripts/vision-stability.mjs \
 *     --provider openrouter --model xiaomi/mimo-v2.5 \
 *     --runs 3 --max-cost-usd 1.50 --write-report
 *
 * Legacy/proven fallback:
 *   node scripts/vision-stability.mjs \
 *     --provider openrouter --model xiaomi/mimo-v2-omni \
 *     --runs 3 --max-cost-usd 1.50 --write-report
 *
 * Reports:
 *   reports/capability-expansion/vision-stability/<ts>.{json,md}
 *   reports/capability-expansion/vision-stability/latest.{json,md}
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runConversationalTask } from "../dist/core/conversational-runner.js";
import { OpenRouterAdapter } from "../dist/adapters/openrouter.js";
import { OpenAIAdapter } from "../dist/adapters/openai.js";
import { evaluatePromotion } from "../dist/core/capability-certification.js";

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

// Phase B stability profile: same 5-test Vision POC suite as
// scripts/vision-smoke.mjs default.
const ALL_TESTS = [
  "vision-ocr-001",
  "vision-ui-001",
  "vision-chart-001",
  "vision-object-count-001",
  "vision-uncertainty-001",
];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "reports", "capability-expansion", "vision-stability");

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
vision-stability — Crucible Roadmap Phase B Vision N-run stability profile

  --provider <id>          openrouter | openai (default: openrouter)
  --model <id>             exact model id (required)
  --runs <n>               number of repeats (default 3; clamp 2-10)
  --max-cost-usd <n>       hard cap across all repeats (default 1.50)
  --tests <csv>            explicit task-id list (overrides 5-test default)
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
  console.error("error: --model is required");
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

// Reuse the same attribution taxonomy as vision-smoke.mjs:
// MODEL / FIXTURE / SCORER / PROVIDER / CONFIG / NEEDS_REVIEW / PASS.
function attributeOutcome(classification, skipReason) {
  const c = String(classification || "").toUpperCase();
  const reason = String(skipReason || "");
  if (c === "PASS") return "PASS";
  if (c.startsWith("SKIPPED_FIXTURE")) return "FIXTURE";
  if (c === "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED" || c === "SKIPPED_UNSUPPORTED_MULTIMODAL") return "CONFIG";
  if (c === "FAIL_CONFIG" || c === "FAIL_CONFIG_MODEL_CAPABILITY") return "CONFIG";
  if (c === "FAIL_PROVIDER" || c === "PROVIDER_HTTP_ERROR" || c === "PROVIDER_FAILURE") return "PROVIDER";
  if (/NEEDS_REVIEW/i.test(reason)) return "NEEDS_REVIEW";
  if (/answer too verbose/i.test(reason)) return "SCORER";
  if (/FAIL_OVER_HALLUCINATION/i.test(reason)) return "MODEL";
  if (/FAIL_OVER_REFUSAL/i.test(reason)) return "MODEL";
  if (/missing expected count|wrong count|missing required object/i.test(reason)) return "MODEL";
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
  const imageSent = bundle?.task?.family === "vision" && !skip;
  const convResults = (bundle?.conversational?.results) || [];
  // Gate on r.passed === false so PASS-with-marker reasons (e.g. Phase 12
  // [UNCERTAINTY=VERBOSE_BUT_SAFE] marker) do not leak into the
  // attribution path. PASS reasons remain visible inside the bundle.
  const firstFailReason = convResults.find((r) => r && r.passed === false && r.failure_reason)?.failure_reason || null;
  const rawError = verdict?.evidence?.rawError || null;
  const skipReason = firstFailReason
    || rawError
    || verdict?.evidence?.skip_reason
    || verdict?.failureReasonSummary
    || null;
  const attribution = attributeOutcome(classification, skipReason);
  return {
    classification: String(classification).toUpperCase(),
    attribution,
    costUsd: Number(usage.cost_usd || usage.estimated_cost_usd || 0),
    tokensIn: Number(usage.tokens_in || 0),
    tokensOut: Number(usage.tokens_out || 0),
    bundleId: bundle?.bundle_id || null,
    runId: bundle?.run_id || null,
    imageSent,
    pass: classification === "PASS",
    firstFailReason: skipReason,
  };
}

async function runOneTest(taskId) {
  const adapter = providerDef.build();
  await adapter.init(providerDef.initArgs(model));
  try {
    const result = await runConversationalTask({
      taskId, adapter, model,
      capabilities: {
        supportsVision: true,
        supportsImageInput: true,
        imageTransportImplemented: true,
      },
    });
    let bundlePath = null;
    try {
      const runsDir = join(ROOT, "runs");
      mkdirSync(runsDir, { recursive: true });
      const bundleId = result.bundle.bundle_id || `bundle-${Date.now()}`;
      const dateOnly = new Date().toISOString().slice(0, 10);
      const slug = `${dateOnly}_${taskId}_${model.replace(/[/:]/g, "-")}_${String(bundleId).slice(-8)}`;
      const localPath = join(runsDir, `run_${slug}.json`);
      writeFileSync(localPath, JSON.stringify(result.bundle, null, 2));
      bundlePath = `runs/run_${slug}.json`;
    } catch {}
    return { result, bundlePath };
  } finally {
    if (adapter.teardown) await adapter.teardown();
  }
}

// ── Stability classification ──────────────────────────────────────────────
//
// Vision-flavored classifier — extends the Roleplay 8-label set with
// per-attribution suspect tiers (FIXTURE_SUSPECT / PROVIDER_SUSPECT /
// CONFIG_SUSPECT) so recurring infrastructure issues are visible
// distinctly from recurring scorer issues.

function classifyTestStability(perRunEntries) {
  const n = perRunEntries.length;
  if (n === 0) return { label: "MODEL_VARIANCE", runs: 0 };
  const passes = perRunEntries.filter((r) => r.classification === "PASS").length;
  const fails = perRunEntries.filter((r) => /^(LOW_SCORE|FAIL_)/.test(r.classification || "") && r.attribution !== "NEEDS_REVIEW").length;
  const reviews = perRunEntries.filter((r) => r.attribution === "NEEDS_REVIEW").length;
  const skips = perRunEntries.filter((r) => /^SKIPPED/.test(r.classification || "")).length;

  // Per-attribution recurrence
  const attrCounts = perRunEntries.reduce((a, r) => { const k = r.attribution || "PASS"; a[k] = (a[k] || 0) + 1; return a; }, {});
  const failAttrs = perRunEntries
    .filter((r) => r.classification !== "PASS" && r.attribution !== "PASS")
    .map((r) => r.attribution);
  const allFailsSame = (label) => failAttrs.length >= 2 && failAttrs.every((a) => a === label);

  // Same-reason recurrence — only triggers SCORER_SUSPECT if the
  // recurring reason text indicates NEEDS_REVIEW / AMBIGUOUS / verbose
  // (matches Phase-8 Roleplay calibration logic).
  const failReasons = perRunEntries
    .filter((r) => r.classification !== "PASS")
    .map((r) => String(r.firstFailReason || "").slice(0, 240));
  const sameReasonFails = failReasons.length >= 2 && new Set(failReasons).size === 1;
  const sameReasonText = sameReasonFails ? failReasons[0] : "";
  const sameReasonIsAmbiguous = sameReasonFails && /(?:^NEEDS_REVIEW:|AMBIGUOUS|answer too verbose)/i.test(sameReasonText);

  // Two paths to SCORER_SUSPECT:
  //   (a) every failure attributes SCORER — even if reason text varies
  //       (e.g. "answer too verbose: 853 chars" vs "820 chars" vs
  //       "998 chars" — same root cause, different char counts).
  //   (b) same-reason recurrence whose text matches the ambiguity
  //       markers (NEEDS_REVIEW / AMBIGUOUS / answer-too-verbose) —
  //       matches Phase-8 Roleplay calibration logic.
  let label;
  if (passes === n) label = "STABLE_PASS";
  else if (skips === n) label = "STABLE_SKIP";
  else if (reviews >= 2) label = "NEEDS_REVIEW_STABLE";
  else if (allFailsSame("CONFIG")) label = "CONFIG_SUSPECT";
  else if (allFailsSame("PROVIDER")) label = "PROVIDER_SUSPECT";
  else if (allFailsSame("FIXTURE")) label = "FIXTURE_SUSPECT";
  else if (allFailsSame("SCORER")) label = "SCORER_SUSPECT";
  else if (sameReasonFails && fails >= 2 && sameReasonIsAmbiguous) label = "SCORER_SUSPECT";
  else if (fails >= 2) label = "RECURRING_FAIL";
  else if (fails === 1 && passes > 0) label = "INTERMITTENT_FAIL";
  else label = "MODEL_VARIANCE";

  return { label, passes, fails, reviews, skips, runs: n, attributionCounts: attrCounts };
}

// ── Dry-run gate eligibility (read-only) ──────────────────────────────────
//
// Calls the doctrine evaluator with the stability evidence; produces a
// CapabilityPromotionDecision payload labelled explicitly as "dry-run
// no mutation performed". Never writes to MODEL_CERTIFICATION or
// certified-models.json (the evaluator is pure-function read-only;
// see docs/CAPABILITY_CERTIFICATION_DOCTRINE.md).

function buildDryRunGateEligibility(allRuns, stabilityByTest, json) {
  // Aggregate evidence: pass rate across all (test × run) cells,
  // recurring attribution categories, suite size.
  const allCells = allRuns.flatMap((r) => r.results);
  const totalCells = allCells.length;
  const passCells = allCells.filter((r) => r.pass).length;
  const stablePassRate = totalCells ? (passCells / totalCells) : 0;
  // Recurring attributions = any attribution that appeared in >=2
  // test-level summaries.
  const testAttrRecurrence = {};
  for (const taskId of Object.keys(stabilityByTest)) {
    const a = stabilityByTest[taskId].attributionCounts || {};
    for (const k of Object.keys(a)) {
      if (k === "PASS") continue;
      if ((a[k] || 0) >= 2) {
        testAttrRecurrence[k] = (testAttrRecurrence[k] || 0) + 1;
      }
    }
  }
  const recurringAttributions = Object.keys(testAttrRecurrence);

  const evidenceRefs = [
    { kind: "stability", path: `reports/capability-expansion/vision-stability/${json.timestamp}.json`, generatedAt: json.timestamp, commit: json.commit },
  ];

  const decisions = ["PROVIDER_TESTED", "STABLE"].map((tier) => {
    const decision = evaluatePromotion({
      capability: "vision",
      providerId: json.provider,
      modelId: json.model,
      currentTier: "EXPERIMENTAL",
      proposedTier: tier,
      suiteSize: json.tests.length,
      repeatRuns: json.runs,
      stablePassRate,
      independentRoutesTested: 1, // this script evaluates one route per invocation
      recurringAttributions,
      evidenceRefs,
    });
    return {
      tier,
      eligible: decision.eligible,
      blockingReasons: decision.blockingReasons,
      // Re-assert the doctrine literal-false guarantees on the payload
      // returned to the report (the evaluator already sets them; we
      // explicitly mirror them here for the operator-facing summary).
      affectsLeaderboard: false,
      affectsCertification: false,
    };
  });

  return {
    label: "DRY-RUN ELIGIBILITY CHECK (read-only; no mutation performed)",
    currentTier: "EXPERIMENTAL",
    decisions,
    affectsLeaderboard: false,
    affectsCertification: false,
    aggregateEvidence: {
      totalCells,
      passCells,
      stablePassRate,
      recurringAttributions,
      independentRoutesTested: 1,
      suiteSize: json.tests.length,
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Vision stability · provider=${provider} model=${model} runs=${runs} cap=$${maxCostUsd}`);
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
        console.log(`    ${s.classification} (${s.attribution}) · cost=$${s.costUsd.toFixed(4)} · image_sent=${s.imageSent}`);
        runResults.push({ taskId, ...s });
        if (["FAIL_CONFIG", "FAIL_PROVIDER", "PROVIDER_HTTP_ERROR", "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED", "SKIPPED_UNSUPPORTED_MULTIMODAL"].includes(s.classification)) {
          console.log(`  classification=${s.classification} — stopping stability profile early`);
          stopped = true; stopReason = s.classification;
          break outer;
        }
      } catch (err) {
        const msg = String((err && err.message) || err).slice(0, 400);
        console.log(`    ERROR · ${msg.slice(0, 200)}`);
        runResults.push({ taskId, classification: "FAIL_HARNESS", attribution: "CONFIG", costUsd: 0, tokensIn: 0, tokensOut: 0, pass: false, imageSent: false, firstFailReason: msg });
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

  // Aggregate
  const stabilityByTest = {};
  for (const taskId of TESTS) {
    const perRun = allRuns.map((r) => r.results.find((rs) => rs.taskId === taskId)).filter(Boolean);
    const summary = classifyTestStability(perRun);
    const failed = perRun.filter((r) => r.classification !== "PASS");
    const representativeReason = (failed[0]?.firstFailReason || "").slice(0, 260) || null;
    stabilityByTest[taskId] = {
      ...summary,
      commonAttribution: Object.entries(summary.attributionCounts || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || "—",
      representativeFailure: representativeReason,
      perRun: perRun.map((r, i) => ({
        runIndex: i + 1,
        classification: r.classification,
        attribution: r.attribution,
        costUsd: r.costUsd,
        bundleId: r.bundleId,
        bundlePath: r.bundlePath,
        imageSent: r.imageSent,
      })),
    };
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
    console.log(`  ${taskId.padEnd(28)} ${s.label.padEnd(22)} P:${s.passes||0} F:${s.fails||0} R:${s.reviews||0}`);
  }
  console.log(`\nTotal cost: $${totalCost.toFixed(4)} across ${allRuns.length} runs · attribution: ${JSON.stringify(aggregateAttribution)}`);

  if (writeReport) {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = {
      schema: "crucible.vision-stability.v1",
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
      perRun: allRuns,
    };
    // Add the read-only dry-run gate eligibility section at the end.
    json.dryRunGateEligibility = buildDryRunGateEligibility(allRuns, stabilityByTest, json);
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
  const dryRun = j.dryRunGateEligibility || {};
  const dryRunRows = (dryRun.decisions || []).map((d) => `- **${d.tier}** — eligible: **${d.eligible}**${d.blockingReasons.length ? "\n  - blockers: " + d.blockingReasons.map((b) => `\`${b.gate}\` (${b.reason})`).join("; ") : ""}`).join("\n");
  return `# Vision stability report

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

## Aggregate attribution

${Object.entries(j.aggregateAttribution || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}

## Dry-run gate eligibility (READ-ONLY — no mutation performed)

${dryRun.label || ""}

- currentTier: ${dryRun.currentTier || "EXPERIMENTAL"}
- affectsLeaderboard: ${dryRun.affectsLeaderboard}
- affectsCertification: ${dryRun.affectsCertification}

${dryRunRows || "_no decisions produced_"}
`;
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
