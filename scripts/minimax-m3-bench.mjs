#!/usr/bin/env node
/**
 * Luak — MiniMax-M3 experimental benchmark runner (2026-05-31).
 *
 * Benchmarks the OpenRouter MiniMax-M3 *experimental* target against the
 * MiMo v2.5 family and Luak baselines across the requested categories, under
 * hard cost controls. MiniMax-M3 is NOT a default model, is NOT the judge, and
 * is NOT routed for normal tasks — it only runs here, behind explicit flags.
 *
 * Safety / cost controls (all enforced below):
 *   - requires explicit `--model minimax-m3` (or another registered
 *     experimental alias); refuses anything else
 *   - moderate default output cap (exported as OPENROUTER_MAX_OUTPUT_TOKENS so
 *     both chat and agentic paths honour it)
 *   - mandatory tiny smoke against the candidate before the full matrix
 *   - hard `--max-cost-usd` cap with early stop
 *   - refuses batch runs (multi-model / repeated / large) unless --approve-batch
 *   - logs estimated tokens (pre-flight) and actual usage (post-run)
 *   - always writes a cost receipt; full reports gated behind --write-report
 *
 * Usage:
 *   # smoke only (cheapest; one safety task against the candidate):
 *   node scripts/minimax-m3-bench.mjs --model minimax-m3 --smoke-only
 *
 *   # single-model, single-pass across supported categories (not a batch):
 *   node scripts/minimax-m3-bench.mjs --model minimax-m3 --max-cost-usd 0.50 --write-report
 *
 *   # full head-to-head vs MiMo v2.5 / v2.5-pro (a batch — needs approval):
 *   node scripts/minimax-m3-bench.mjs --model minimax-m3 --compare \
 *     --approve-batch --max-cost-usd 2.00 --write-report
 *
 * Reports + receipts:
 *   reports/experimental/minimax-m3/<ts>.{json,md}
 *   reports/experimental/minimax-m3/<ts>.receipt.json
 *   reports/experimental/minimax-m3/latest.{json,md,receipt.json}
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { runTask } from "../dist/core/runner.js";
import { runConversationalTask, isConversationalTask } from "../dist/core/conversational-runner.js";
import { OpenRouterAdapter } from "../dist/adapters/openrouter.js";
import {
  resolveExperimentalTarget,
  BENCHMARK_CATEGORIES,
  supportedCategories,
  unsupportedCategories,
  plannedTaskIds,
  SMOKE_TASK_ID,
  evaluateBatch,
  estimateUsdCost,
  pricingFor,
  buildVerdict,
} from "../dist/core/experimental-targets.js";
import { redactSecrets, safeProviderError } from "../dist/core/redact.js";
import { extractFailureEvidence } from "../dist/core/failure-evidence.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "reports", "experimental", "minimax-m3");

// Rough pre-flight token expectations per task (NOT a measurement — the
// authoritative numbers are the post-run actuals). Repo/agentic tasks read
// files over several steps, so they cost far more input than conversational.
const NOMINAL_INPUT_TOKENS = { conversational: 1500, repo: 12000 };
const NOMINAL_OUTPUT_STEPS = { conversational: 1, repo: 4 };

// ── env + argv ───────────────────────────────────────────────────────────────

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
minimax-m3-bench — Luak experimental benchmark for OpenRouter MiniMax-M3

  --model <alias>          experimental alias, required (e.g. minimax-m3)
  --compare                also run the comparison set (MiMo v2.5 / v2.5-pro)
  --categories <csv>       restrict to category keys (default: all supported)
  --runs <n>               repeats per task (default 1; >1 makes it a batch)
  --max-cost-usd <n>       hard spend cap across the whole run (default 0.50)
  --max-output-tokens <n>  output cap (default: target's moderate default)
  --smoke-only             run just the mandatory tiny smoke, then stop
  --approve-batch          allow multi-model / repeated / large runs
  --write-report           also write full JSON + Markdown reports
  -h, --help               show this help

The cost receipt is always written. MiniMax-M3 here is EXPERIMENTAL only:
it never affects the leaderboard or capability certification.
`);
  process.exit(0);
}

const modelAlias = arg("--model", null);
const compare = flag("--compare");
const categoriesArg = arg("--categories", null);
const runs = Math.max(1, Number(arg("--runs", "1")) || 1);
const maxCostUsd = Number(arg("--max-cost-usd", "0.50")) || 0;
const smokeOnly = flag("--smoke-only");
const approveBatch = flag("--approve-batch");
const writeReport = flag("--write-report") || flag("--write");

function die(msg, code = 2) {
  console.error(`error: ${msg}`);
  process.exit(code);
}

if (!modelAlias) die("--model is required (e.g. --model minimax-m3)");
const target = resolveExperimentalTarget(modelAlias);
if (!target) {
  die(`'${modelAlias}' is not a registered experimental target. ` +
      `This runner only accepts experimental aliases (e.g. minimax-m3). ` +
      `Normal models go through 'luak harness --adapter ... --model ...'.`);
}
if (target.adapter !== "openrouter") die(`target ${target.alias} is not an OpenRouter route`);
if (maxCostUsd <= 0) die("--max-cost-usd must be > 0");
if (!process.env.OPENROUTER_API_KEY) die("OPENROUTER_API_KEY not set in env or .env");

const maxOutputTokens = Math.max(
  64,
  Number(arg("--max-output-tokens", String(target.default_max_output_tokens))) || target.default_max_output_tokens,
);
// Honoured by buildOpenRouterChatBody for BOTH chat() and execute() paths.
process.env.OPENROUTER_MAX_OUTPUT_TOKENS = String(maxOutputTokens);

// Resolve categories.
const allSupported = supportedCategories();
let categories = allSupported;
if (categoriesArg) {
  const want = new Set(categoriesArg.split(",").map((s) => s.trim()).filter(Boolean));
  categories = BENCHMARK_CATEGORIES.filter((c) => want.has(c.key));
  const unknown = [...want].filter((k) => !BENCHMARK_CATEGORIES.some((c) => c.key === k));
  if (unknown.length) die(`unknown category key(s): ${unknown.join(", ")}`);
  const blocked = categories.filter((c) => !c.supported).map((c) => c.key);
  if (blocked.length) console.log(`note: requested categories not covered by Luak tasks (skipped): ${blocked.join(", ")}`);
  categories = categories.filter((c) => c.supported);
}

const taskIds = plannedTaskIds(categories);
if (!smokeOnly && taskIds.length === 0) die("no supported tasks selected");

// Model routes.
const models = [target.model, ...(compare ? target.comparison_models : [])];

// ── Batch policy ─────────────────────────────────────────────────────────────

const matrixTaskCount = smokeOnly ? 1 : taskIds.length;
const batch = evaluateBatch({ modelCount: models.length, runs, taskCount: matrixTaskCount });
if (batch.isBatch && !approveBatch) {
  die(`this is a batch run (${batch.reasons.join("; ")}). ` +
      `Re-run with --approve-batch to confirm, or narrow scope ` +
      `(single model, --runs 1, fewer --categories).`, 2);
}

// ── Pre-flight token + cost estimate (rough; logged, not authoritative) ──────

function categoryExecutionFor(taskId) {
  for (const c of BENCHMARK_CATEGORIES) {
    if (c.taskIds.includes(taskId)) return c.execution;
  }
  return "conversational";
}
function categoriesOfTask(taskId) {
  return BENCHMARK_CATEGORIES.filter((c) => c.taskIds.includes(taskId)).map((c) => c.key);
}

function preflightEstimate() {
  const cells = [];
  const ids = smokeOnly ? [SMOKE_TASK_ID] : taskIds;
  for (const model of models) {
    for (let r = 0; r < runs; r++) {
      for (const taskId of ids) {
        const exec = categoryExecutionFor(taskId);
        const tin = NOMINAL_INPUT_TOKENS[exec];
        const tout = maxOutputTokens * NOMINAL_OUTPUT_STEPS[exec];
        cells.push({ model, taskId, tin, tout, usd: estimateUsdCost(model, tin, tout) });
      }
    }
  }
  const totalUsd = cells.reduce((a, c) => a + c.usd, 0);
  const totalTokens = cells.reduce((a, c) => a + c.tin + c.tout, 0);
  return { cells, totalUsd, totalTokens };
}

// ── Run one task on one adapter, capturing usage + outcome ──────────────────

/**
 * Pull a structured provider error off a bundle wherever it landed: the
 * top-level `provider_error`, the last failed provider attempt, or a timeline
 * `error` event. The runner records the failure in the *verdict* (origin
 * PROVIDER/NETWORK) even when `bundle.provider_error` stays null, so we look in
 * every place a structured error can hide.
 */
function extractStructuredProviderError(bundle) {
  if (bundle?.provider_error && typeof bundle.provider_error === "object") return bundle.provider_error;
  const attempts = Array.isArray(bundle?.provider_attempts) ? bundle.provider_attempts : [];
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i]?.provider_error && typeof attempts[i].provider_error === "object") return attempts[i].provider_error;
  }
  const timeline = Array.isArray(bundle?.timeline) ? bundle.timeline : [];
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]?.provider_error && typeof timeline[i].provider_error === "object") return timeline[i].provider_error;
  }
  return null;
}

/**
 * A task "did not complete" (no model-quality signal) when it failed at the
 * provider or network layer. This is derived from the VERDICT, not just
 * `bundle.provider_error` — that field is frequently null on a failed run while
 * the verdict carries `failureOrigin: "PROVIDER"` and a `provider_*` code.
 */
function isProviderFailure(verdict, structuredError) {
  if (structuredError) return true;
  const origin = verdict?.failureOrigin ?? null;
  if (origin === "PROVIDER" || origin === "NETWORK") return true;
  const code = verdict?.failureReasonCode;
  return typeof code === "string" && /^(provider_|network_)/.test(code);
}

function summarize(taskId, bundle, durationMs, model) {
  const usage = bundle?.usage ?? {};
  const verdict = bundle?.verdict ?? {};
  const tokensIn = Number(usage.tokens_in ?? 0);
  const tokensOut = Number(usage.tokens_out ?? 0);
  // Authoritative cost = accurate per-model price applied to ACTUAL tokens.
  const accurateCostUsd = estimateUsdCost(model, tokensIn, tokensOut);
  const pass = bundle?.score?.pass === true;
  const structuredError = extractStructuredProviderError(bundle);
  const failureOrigin = verdict.failureOrigin ?? null;
  const failureCode =
    verdict.failureReasonCode ||
    (pass ? null : (verdict.completionState && verdict.completionState !== "PASS" ? verdict.completionState : "FAIL"));
  const providerFailure = !pass && isProviderFailure(verdict, structuredError);
  // Persist ONLY the redacted safe projection — never the raw provider error.
  const providerError = structuredError
    ? safeProviderError(structuredError, model)
    : (providerFailure
        ? { provider: "openrouter", model, kind: "UNKNOWN", origin: failureOrigin ?? "PROVIDER", statusCode: null, code: failureCode ? redactSecrets(failureCode) : null, message: redactSecrets(verdict.summary ?? "Provider call did not complete"), requestId: null, retryable: false }
        : null);

  // Auditable failure evidence for every failed cell: a small redacted block in
  // the report/receipt plus an optional per-turn transcript artifact. Built from
  // the bundle's sanitized conversational results — never from raw errors/headers.
  let failureEvidence = null;
  let transcript = null;
  if (!pass) {
    const ev = extractFailureEvidence(bundle, {
      taskId,
      model,
      failureOrigin,
      failureCode,
      providerMessage: providerError ? providerError.message : null,
    });
    failureEvidence = ev.evidence;
    transcript = ev.transcript;
  }

  return {
    taskId,
    model,
    pass,
    durationMs,
    tokensIn,
    tokensOut,
    accurateCostUsd,
    bundleReportedCostUsd: Number(usage.estimated_cost_usd ?? 0),
    providerCostNote: usage.provider_cost_note ?? null,
    failureOrigin,
    failureCode,
    providerFailure,
    providerErrorKind: providerError ? providerError.kind : null,
    providerError,
    bundleId: bundle?.bundle_id ?? null,
    categories: categoriesOfTask(taskId),
    failureEvidence,
    // Sidecar payload for the transcript writer; stripped before serialization.
    _transcript: transcript,
  };
}

async function runOne(model, taskId) {
  const adapter = new OpenRouterAdapter();
  await adapter.init({ model, api_key: process.env.OPENROUTER_API_KEY });
  const start = Date.now();
  try {
    const conv = isConversationalTask(taskId);
    const result = conv
      ? await runConversationalTask({ taskId, adapter, model })
      : await runTask({ taskId, adapter, model, keepWorkspace: false });
    return summarize(taskId, result.bundle, Date.now() - start, model);
  } finally {
    if (adapter.teardown) await adapter.teardown();
  }
}

// ── Aggregation ──────────────────────────────────────────────────────────────

const TOOL_JSON_CATEGORY_KEYS = new Set(["tool-call-planning", "structured-json-reliability"]);

function aggregate(model, cells) {
  const mine = cells.filter((c) => c.model === model);
  const tasksRun = mine.length;
  const tasksPassed = mine.filter((c) => c.pass).length;
  const passRate = tasksRun ? tasksPassed / tasksRun : 0;
  const avgLatencyMs = tasksRun ? mine.reduce((a, c) => a + c.durationMs, 0) / tasksRun : 0;
  const totalCostUsd = mine.reduce((a, c) => a + c.accurateCostUsd, 0);
  const costPerUsefulUsd = tasksPassed ? totalCostUsd / tasksPassed : Infinity;
  const toolJsonCells = mine.filter((c) => c.categories.some((k) => TOOL_JSON_CATEGORY_KEYS.has(k)));
  const toolJsonTasksRun = toolJsonCells.length;
  const toolJsonReliability = toolJsonTasksRun
    ? toolJsonCells.filter((c) => c.pass).length / toolJsonTasksRun
    : 0;
  const failureModes = [...new Set(
    mine.filter((c) => !c.pass)
      .map((c) => redactSecrets(c.providerErrorKind ? `provider:${c.providerErrorKind}` : (c.failureCode || "FAIL")))
  )];
  // Run-validity signals: a task only "completed" (carries a model-quality
  // signal) if it did not fail at the provider/network/harness layer.
  const providerFailures = mine.filter((c) => c.providerFailure).length;
  const completedCalls = mine.filter((c) => !c.providerFailure && c.failureOrigin !== "HARNESS").length;
  const tokensObserved = mine.reduce((a, c) => a + c.tokensIn + c.tokensOut, 0);
  const spendObserved = totalCostUsd;
  return {
    model, tasksRun, tasksPassed, passRate, avgLatencyMs, totalCostUsd, costPerUsefulUsd,
    toolJsonTasksRun, toolJsonReliability, failureModes,
    completedCalls, providerFailures, tokensObserved, spendObserved,
  };
}

// ── Main ─────────────────────────────────────────────────────────────────────

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

/** Short, secret-redacted failure summary for the terminal (req. 6/7). */
function logFailureSummary(cell) {
  const fe = cell?.failureEvidence;
  if (!fe) return;
  if (fe.failedTurnId) console.log(`   failed turn   : ${redactSecrets(fe.failedTurnId)}`);
  if (fe.judgeReason) console.log(`   judge reason  : ${redactSecrets(fe.judgeReason).slice(0, 160)}`);
  if (fe.responseExcerpt) console.log(`   response excpt: ${redactSecrets(fe.responseExcerpt).slice(0, 160)}`);
}

/** OpenRouter slug → filename-safe token. */
function modelSafe(model) {
  return String(model).replace(/[/:]/g, "-");
}

async function main() {
  const ts = nowStamp();
  console.log("=".repeat(72));
  console.log(` Luak — MiniMax-M3 EXPERIMENTAL benchmark`);
  console.log(`   target        : ${target.label}`);
  console.log(`   route         : ${target.adapter} / ${target.model}`);
  console.log(`   models        : ${models.join(", ")}`);
  console.log(`   categories    : ${categories.map((c) => c.key).join(", ") || "(smoke only)"}`);
  console.log(`   tasks         : ${smokeOnly ? SMOKE_TASK_ID + " (smoke only)" : taskIds.join(", ")}`);
  console.log(`   runs/task     : ${runs}`);
  console.log(`   max output    : ${maxOutputTokens} tokens/call`);
  console.log(`   cost cap      : $${maxCostUsd.toFixed(2)} (hard, early-stop)`);
  console.log(`   affects board : false   affects cert: false`);
  console.log("=".repeat(72));

  const dropped = unsupportedCategories();
  if (dropped.length) {
    console.log(`Categories with no Luak coverage (reported as "not evaluated"):`);
    for (const c of dropped) console.log(`   - ${c.key}: ${c.note}`);
  }

  // Pre-flight estimate.
  const est = preflightEstimate();
  console.log(`\nPre-flight estimate (rough, nominal): ~${est.totalTokens.toLocaleString()} tokens, ~$${est.totalUsd.toFixed(4)} across ${est.cells.length} cell(s).`);
  if (est.totalUsd > maxCostUsd) {
    console.log(`  ! estimate exceeds the $${maxCostUsd.toFixed(2)} cap — the run will stop early when the cap is hit.`);
  }

  const cells = [];
  let totalCost = 0;
  let stopped = false;
  let stopReason = null;

  // ── Mandatory smoke (candidate only, one safety task) ──────────────────────
  console.log(`\n── smoke: ${SMOKE_TASK_ID} on ${target.model} ──`);
  let smoke;
  try {
    smoke = await runOne(target.model, SMOKE_TASK_ID);
  } catch (err) {
    console.error(`SMOKE FAILED (exception): ${redactSecrets(String(err?.message || err)).slice(0, 240)}`);
    console.error("Aborting before the benchmark matrix — fix the route/credentials first.");
    process.exit(1);
  }
  totalCost += smoke.accurateCostUsd;
  console.log(`   ${smoke.pass ? "PASS" : "FAIL"} · ${smoke.tokensIn}+${smoke.tokensOut} tok · $${smoke.accurateCostUsd.toFixed(4)} · ${smoke.durationMs}ms`);
  if (smoke.providerFailure) {
    const e = smoke.providerError ?? {};
    console.error(`SMOKE FAILED (provider call did not complete: ${redactSecrets(e.message || e.kind || "provider error")}${e.statusCode ? ` [HTTP ${e.statusCode}]` : ""}).`);
    console.error("Aborting before the benchmark matrix — the provider route is not healthy; do NOT treat this as a model verdict.");
    process.exit(1);
  }
  if (!smoke.pass) logFailureSummary(smoke);
  // The smoke doubles as the candidate's safety-001 cell (avoids double spend).
  cells.push(smoke);

  if (smokeOnly) {
    console.log(`\nSmoke-only run complete. Total cost: $${totalCost.toFixed(4)}.`);
  } else {
    // ── Benchmark matrix ──────────────────────────────────────────────────────
    outer:
    for (const model of models) {
      for (let r = 0; r < runs; r++) {
        for (const taskId of taskIds) {
          // Reuse the smoke result for the candidate's first safety-001 cell.
          if (model === target.model && r === 0 && taskId === SMOKE_TASK_ID) continue;
          if (totalCost >= maxCostUsd) {
            console.log(`\n  cost cap reached ($${totalCost.toFixed(4)} >= $${maxCostUsd.toFixed(2)}) — stopping`);
            stopped = true; stopReason = "cost_cap";
            break outer;
          }
          console.log(`\n── ${model} · run ${r + 1}/${runs} · ${taskId} ──`);
          try {
            const cell = await runOne(model, taskId);
            totalCost += cell.accurateCostUsd;
            cells.push(cell);
            console.log(`   ${cell.pass ? "PASS" : "FAIL"}${cell.failureCode ? " (" + redactSecrets(cell.failureCode) + ")" : ""} · ${cell.tokensIn}+${cell.tokensOut} tok · $${cell.accurateCostUsd.toFixed(4)} · ${cell.durationMs}ms`);
            if (cell.providerFailure) {
              const e = cell.providerError ?? {};
              console.log(`   provider call did not complete: ${redactSecrets(e.message || e.kind || "provider error")}${e.statusCode ? ` [HTTP ${e.statusCode}]` : ""} — stopping (not a model verdict)`);
              stopped = true; stopReason = `provider:${redactSecrets(cell.providerErrorKind || "PROVIDER_ERROR")}`;
              break outer;
            }
            if (!cell.pass) logFailureSummary(cell);
          } catch (err) {
            console.log(`   ERROR: ${redactSecrets(String(err?.message || err)).slice(0, 200)}`);
            const ev = extractFailureEvidence(null, { taskId, model, failureOrigin: "HARNESS", failureCode: "HARNESS_ERROR", providerMessage: redactSecrets(String(err?.message || err)).slice(0, 200) });
            cells.push({ taskId, model, pass: false, durationMs: 0, tokensIn: 0, tokensOut: 0, accurateCostUsd: 0, bundleReportedCostUsd: 0, providerCostNote: null, failureOrigin: "HARNESS", failureCode: "HARNESS_ERROR", providerFailure: false, providerErrorKind: null, providerError: null, bundleId: null, categories: categoriesOfTask(taskId), failureEvidence: ev.evidence, _transcript: ev.transcript });
            stopped = true; stopReason = "harness_error";
            break outer;
          }
        }
      }
    }
  }

  // ── Aggregate + verdict ─────────────────────────────────────────────────────
  const routeMetrics = {};
  for (const model of models) routeMetrics[model] = aggregate(model, cells);

  const candidate = routeMetrics[target.model];
  const mimo = routeMetrics["xiaomi/mimo-v2.5"];
  const mimoPro = routeMetrics["xiaomi/mimo-v2.5-pro"];
  // A smoke-only run is a gate, not an evaluation — it must not produce a
  // real recommendation off a single safety task.
  const verdict = buildVerdict({
    candidate,
    mimo,
    mimoPro,
    hasData: !smokeOnly && candidate.tasksRun > 0,
  });
  // An invalid run is NOT a model verdict. Surface it in the receipt + exit code
  // so no downstream reader (or human) mistakes a provider outage for REJECT.
  const runInvalid = verdict.recommendation === "PROVIDER_FAILURE" || verdict.recommendation === "INVALID_RUN";

  // ── Auditable transcripts (one per failed cell) ─────────────────────────────
  // Write a minimal redacted transcript artifact for every failed cell so the
  // report/receipt can POINT at the underlying turns instead of discarding them.
  mkdirSync(OUT_DIR, { recursive: true });
  const TRANS_DIR = join(OUT_DIR, "transcripts");
  let transcriptsWritten = false;
  const usedNames = new Set();
  for (const cell of cells) {
    if (cell.pass || !cell._transcript || !cell.failureEvidence) continue;
    if (!transcriptsWritten) { mkdirSync(TRANS_DIR, { recursive: true }); transcriptsWritten = true; }
    let base = `${ts}-${cell.taskId}-${modelSafe(cell.model)}`;
    let name = `${base}.json`;
    for (let n = 2; usedNames.has(name); n++) name = `${base}-${n}.json`;
    usedNames.add(name);
    // The transcript was redacted at build time; redact the serialized form once
    // more as a belt-and-braces guarantee before it ever touches disk (req. 6).
    writeFileSync(join(TRANS_DIR, name), redactSecrets(JSON.stringify(cell._transcript, null, 2)) + "\n");
    cell.failureEvidence.transcriptPath = `transcripts/${name}`;
  }
  // Drop the sidecar payload so it never lands in the report/receipt JSON.
  for (const cell of cells) delete cell._transcript;
  const failureEvidence = cells.filter((c) => !c.pass && c.failureEvidence).map((c) => c.failureEvidence);

  // ── Receipt (always written) ────────────────────────────────────────────────
  const actualTokens = cells.reduce((a, c) => a + c.tokensIn + c.tokensOut, 0);
  const receipt = {
    schema: "luak.experimental-receipt.v1",
    timestamp: ts,
    commit: commitHash(),
    dirtyTree: dirtyTree(),
    target: { alias: target.alias, model: target.model, tier: target.tier },
    affectsLeaderboard: false,
    affectsCertification: false,
    controls: {
      maxCostUsd,
      maxOutputTokens,
      runs,
      smokeOnly,
      approveBatch,
      batch: batch,
      smokeTask: SMOKE_TASK_ID,
    },
    pricingUsedUsdPerM: models.map((m) => ({ model: m, ...(pricingFor(m) ?? { note: "unknown route — estimated at MiniMax-M3 rate" }) })),
    estimate: { nominalTokens: est.totalTokens, nominalCostUsd: Number(est.totalUsd.toFixed(6)), cells: est.cells.length },
    actual: {
      tokens: actualTokens,
      costUsd: Number(totalCost.toFixed(6)),
      cellsRun: cells.length,
      stopped,
      stopReason,
      recommendation: verdict.recommendation,
      runValid: !runInvalid,
    },
    perModel: Object.fromEntries(Object.entries(routeMetrics).map(([m, v]) => [m, {
      tasksRun: v.tasksRun,
      tasksPassed: v.tasksPassed,
      passRate: Number(v.passRate.toFixed(3)),
      avgLatencyMs: Math.round(v.avgLatencyMs),
      totalCostUsd: Number(v.totalCostUsd.toFixed(6)),
      costPerUsefulUsd: Number.isFinite(v.costPerUsefulUsd) ? Number(v.costPerUsefulUsd.toFixed(6)) : null,
      toolJsonReliability: Number(v.toolJsonReliability.toFixed(3)),
      completedCalls: v.completedCalls,
      providerFailures: v.providerFailures,
      failureModes: v.failureModes,
    }])),
    // Safe, auditable evidence for every failed cell — points at the redacted
    // transcript artifacts and carries no raw errors/headers/env (req. 1-6).
    failureEvidence,
  };

  const receiptPath = join(OUT_DIR, `${ts}.receipt.json`);
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  writeFileSync(join(OUT_DIR, "latest.receipt.json"), JSON.stringify(receipt, null, 2) + "\n");

  // ── Full report (gated) ──────────────────────────────────────────────────────
  const report = {
    schema: "luak.experimental-benchmark.v1",
    ...receipt,
    categories: {
      evaluated: categories.map((c) => ({ key: c.key, taskIds: c.taskIds, note: c.note })),
      notEvaluated: unsupportedCategories().map((c) => ({ key: c.key, reason: c.note })),
    },
    cells,
    verdict,
  };
  if (writeReport) {
    writeFileSync(join(OUT_DIR, `${ts}.json`), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(join(OUT_DIR, "latest.json"), JSON.stringify(report, null, 2) + "\n");
    const md = renderMd(report);
    writeFileSync(join(OUT_DIR, `${ts}.md`), md);
    writeFileSync(join(OUT_DIR, "latest.md"), md);
  }

  // ── Console verdict ───────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(72));
  console.log(` VERDICT — ${verdict.recommendation}`);
  console.log(`   ${verdict.rationale}`);
  console.log(`   quality vs MiMo v2.5      : ${verdict.qualityVsMimo}`);
  console.log(`   quality vs MiMo v2.5 Pro  : ${verdict.qualityVsMimoPro}`);
  console.log(`   latency                   : ${verdict.latency}`);
  console.log(`   tool / JSON reliability   : ${verdict.toolJsonReliability}`);
  console.log(`   failure modes             : ${verdict.failureModes.join(", ")}`);
  console.log(`   cost per useful result    : ${verdict.costPerUsefulResult}`);
  console.log(`   ── actual spend: $${totalCost.toFixed(4)} / cap $${maxCostUsd.toFixed(2)}${stopped ? ` (stopped: ${stopReason})` : ""}`);
  console.log(`   receipt: ${receiptPath.replace(ROOT + "/", "")}`);
  if (writeReport) console.log(`   report : ${OUT_DIR.replace(ROOT + "/", "")}/{${ts},latest}.{json,md}`);
  console.log("=".repeat(72));

  if (runInvalid) {
    console.log(`   ! run marked ${verdict.recommendation} — NOT a model-quality verdict; provider route must be healthy before a real comparison.`);
  }
  process.exit(stopReason === "harness_error" ? 1 : runInvalid ? 3 : 0);
}

function fmtUsd(n) {
  if (n == null) return "n/a";
  if (!Number.isFinite(n)) return "n/a";
  return `$${n.toFixed(4)}`;
}

function renderMd(j) {
  const rows = Object.entries(j.perModel).map(([m, v]) =>
    `| ${m} | ${v.tasksPassed}/${v.tasksRun} | ${Math.round(v.passRate * 100)}% | ${v.avgLatencyMs} ms | ${Math.round(v.toolJsonReliability * 100)}% | ${fmtUsd(v.totalCostUsd)} | ${v.costPerUsefulUsd == null ? "n/a" : fmtUsd(v.costPerUsefulUsd)} |`
  ).join("\n");
  const notEval = j.categories.notEvaluated.map((c) => `- \`${c.key}\` — ${c.reason}`).join("\n") || "(none)";
  const mdInline = (s) => String(s ?? "").replace(/\r?\n+/g, " ").replace(/`/g, "'").trim();
  const fe = Array.isArray(j.failureEvidence) ? j.failureEvidence : [];
  const failureEvidenceMd = fe.length
    ? fe.map((e) => {
        const lines = [`### ${e.taskId} · \`${e.model}\``];
        if (e.failedTurnId) lines.push(`- **Failed turn:** ${mdInline(e.failedTurnId)}`);
        lines.push(`- **Failure:** ${e.failureOrigin ?? "?"} / ${e.failureCode ?? "?"}${typeof e.score === "number" ? ` (score ${e.score.toFixed(2)})` : ""}`);
        if (e.judgeReason) lines.push(`- **Judge reason:** ${mdInline(e.judgeReason)}`);
        if (e.responseExcerpt) lines.push(`- **Response excerpt:** ${mdInline(e.responseExcerpt)}`);
        if (e.promptExcerpt) lines.push(`- **Prompt excerpt:** ${mdInline(e.promptExcerpt)}`);
        lines.push(`- **Transcript:** ${e.transcriptPath ? "`" + e.transcriptPath + "`" : "(none written)"}`);
        return lines.join("\n");
      }).join("\n\n")
    : "(no failed cells)";
  return `# MiniMax-M3 experimental benchmark

- **Timestamp (UTC):** ${j.timestamp}
- **Commit:** ${j.commit}${j.dirtyTree ? " (dirty tree)" : ""}
- **Target:** ${j.target.alias} → \`${j.target.model}\` (tier ${j.target.tier})
- **Affects leaderboard:** ${j.affectsLeaderboard} · **Affects certification:** ${j.affectsCertification}
- **Cost cap:** $${j.controls.maxCostUsd} · **actual:** ${fmtUsd(j.actual.costUsd)}${j.actual.stopped ? ` (stopped: ${j.actual.stopReason})` : ""}
- **Max output:** ${j.controls.maxOutputTokens} tokens/call · **runs/task:** ${j.controls.runs}
- **Batch:** ${j.controls.batch.isBatch ? "yes (" + j.controls.batch.reasons.join("; ") + ")" : "no"}

## Per-model results

| Model | Pass | Pass rate | Latency | Tool/JSON | Cost | Cost/useful |
|---|---|---:|---:|---:|---:|---:|
${rows}

## Verdict — ${j.verdict.recommendation}

${j.verdict.rationale}

- **Quality vs MiMo v2.5:** ${j.verdict.qualityVsMimo}
- **Quality vs MiMo v2.5 Pro:** ${j.verdict.qualityVsMimoPro}
- **Latency:** ${j.verdict.latency}
- **Tool/JSON reliability:** ${j.verdict.toolJsonReliability}
- **Failure modes:** ${j.verdict.failureModes.join(", ")}
- **Cost per useful result:** ${j.verdict.costPerUsefulResult}

## Failure evidence

${failureEvidenceMd}

## Categories not evaluated

${notEval}

## Cost estimate vs actual

- **Pre-flight estimate (rough, nominal):** ~${j.estimate.nominalTokens.toLocaleString()} tokens, ${fmtUsd(j.estimate.nominalCostUsd)}
- **Actual:** ${j.actual.tokens.toLocaleString()} tokens, ${fmtUsd(j.actual.costUsd)} across ${j.actual.cellsRun} cell(s)
`;
}

main().catch((err) => { console.error("fatal:", redactSecrets(err?.stack || String(err?.message || err))); process.exit(1); });
