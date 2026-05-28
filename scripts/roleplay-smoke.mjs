#!/usr/bin/env node
/**
 * Luak — Roleplay smoke runner (Phase 1: two POC tests by default)
 *
 * Runs the experimental Roleplay POC tests against one text-capable
 * provider/model under a hard cost cap. Roleplay stays Experimental
 * and is excluded from the leaderboard composite + model certification
 * regardless of outcome.
 *
 * Default test set (Phase 1):
 *   roleplay-character-001, roleplay-continuity-001
 *
 * Usage
 *   node scripts/roleplay-smoke.mjs \
 *     --provider openrouter --model xiaomi/mimo-v2-flash \
 *     --max-cost-usd 0.25 --write-report
 *
 *   # Custom selection
 *   node scripts/roleplay-smoke.mjs ... --tests roleplay-character-001
 *
 * Reports
 *   reports/capability-expansion/roleplay-smoke/<ts>.{json,md}
 *   reports/capability-expansion/roleplay-smoke/latest.{json,md}
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "reports", "capability-expansion", "roleplay-smoke");

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
roleplay-smoke — Luak Phase 1 roleplay POC (two tests by default)

  --provider <id>          openrouter | openai (default: openrouter)
  --model <id>             exact model id (required)
  --max-cost-usd <n>       hard cap (default 0.25). Required.
  --tests <csv>            explicit task-id list; overrides defaults.
                           Example: --tests roleplay-character-001
  --phase1-only            collapse to the original 2-test Phase-1
                           baseline profile (skip the 5 Phase-2 tests).
  --write-report           Persist JSON + Markdown reports.
  -h, --help               Show this help.
`);
  process.exit(0);
}

const provider = arg("--provider", "openrouter");
const model = arg("--model", null);
const maxCostUsd = Number(arg("--max-cost-usd", "0.25")) || 0;
const writeReport = flag("--write-report") || flag("--write");
const explicitTestsArg = arg("--tests", null);

if (!model) {
  console.error("error: --model is required (no default — Phase 1 uses one explicit route)");
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
  console.error(`error: ${providerDef.envKey} not set in env or .env — required for --provider ${provider}`);
  process.exit(2);
}

// Phase 2 (2026-05-26): default profile expanded to 7 live tests —
// the 2 Phase-1 baseline tests + 5 Phase-2 adversarial stress tests.
// Other roleplay tasks (boundary, DM, tone) stay scaffolded but not
// in this default profile per the spec ("Do not add DM, boundary, or
// tone live scoring in this phase unless required for plumbing").
const ALL_TESTS = [
  "roleplay-character-001",      // Phase 1 baseline
  "roleplay-continuity-001",     // Phase 1 baseline
  "roleplay-drift-001",          // Phase 2: 10-turn persona drift with distractors
  "roleplay-refusal-001",        // Phase 2: escalating in-character refusal
  "roleplay-continuity-002",     // Phase 2: memory stress with distractor facts
  "roleplay-contradiction-001",  // Phase 2: canon preservation
  "roleplay-persona-break-001",  // Phase 2: direct break-attempt jailbreaks
];
// Backwards-compat: --phase1-only collapses to the 2 baseline tests.
const PHASE1_TESTS = ["roleplay-character-001", "roleplay-continuity-001"];

const phase1Only = flag("--phase1-only");
let TESTS;
if (explicitTestsArg) {
  TESTS = explicitTestsArg.split(",").map((s) => s.trim()).filter(Boolean);
  for (const t of TESTS) {
    if (!t.startsWith("roleplay-")) {
      console.error(`error: --tests must contain roleplay-* task ids (got: ${t})`);
      process.exit(2);
    }
  }
} else if (phase1Only) {
  TESTS = [...PHASE1_TESTS];
} else {
  TESTS = [...ALL_TESTS];
}

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

async function runOneTest(taskId) {
  const adapter = providerDef.build();
  await adapter.init(providerDef.initArgs(model));
  try {
    const result = await runConversationalTask({
      taskId,
      adapter,
      model,
      capabilities: {
        // Roleplay only requires text + (per registry) supportsRoleplay.
        // No image transport needed.
        supportsText: true,
        supportsRoleplay: true,
      },
    });
    try {
      const runsDir = join(ROOT, "runs");
      mkdirSync(runsDir, { recursive: true });
      const bundleId = result.bundle.bundle_id || `bundle-${Date.now()}`;
      const dateOnly = new Date().toISOString().slice(0, 10);
      const slug = `${dateOnly}_${taskId}_${model.replace(/[/:]/g, "-")}_${String(bundleId).slice(-8)}`;
      const bundlePath = join(runsDir, `run_${slug}.json`);
      writeFileSync(bundlePath, JSON.stringify(result.bundle, null, 2));
      console.log(`    bundle: runs/run_${slug}.json`);
    } catch (err) {
      console.log(`    (could not persist bundle: ${(err && err.message) || err})`);
    }
    return result;
  } finally {
    if (adapter.teardown) await adapter.teardown();
  }
}

// Attribution taxonomy (Phase 3 extends Phase 2 with PROMPT):
//
//   MODEL         — model genuinely broke character / answered wrong
//   PROMPT        — prompt itself induced or invited the failure mode
//                   (e.g. user attack phrase echoed in negation is now
//                   handled by the scorer's context classifier, but if
//                   the scorer still misfires for a prompt-driven
//                   reason it is attributed PROMPT — not MODEL)
//   SCORER        — scorer rule fired on something that should not fail
//   FIXTURE       — fixture missing / hash drift / fixture readability
//   PROVIDER      — provider HTTP error / timeout / network
//   CONFIG        — capability / auth / transport unsupported
//   NEEDS_REVIEW  — scorer returned an explicit NEEDS_REVIEW: marker
//                   (incl. Phase-3 AMBIGUOUS_FORBIDDEN_MENTION case)
function attributeOutcome(classification, reasonText) {
  const c = String(classification || "").toUpperCase();
  const reason = String(reasonText || "");
  if (c === "PASS") return "PASS";
  if (c.startsWith("SKIPPED_FIXTURE")) return "FIXTURE";
  if (c === "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED" || c === "SKIPPED_UNSUPPORTED_MULTIMODAL" || c === "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE") return "CONFIG";
  if (c === "FAIL_CONFIG" || c === "FAIL_CONFIG_MODEL_CAPABILITY") return "CONFIG";
  if (c === "FAIL_PROVIDER" || c === "PROVIDER_HTTP_ERROR" || c === "PROVIDER_FAILURE") return "PROVIDER";
  if (/NEEDS_REVIEW/i.test(reason)) return "NEEDS_REVIEW";
  // Phase 3: a forbidden-phrase echo whose CONTEXT is NEGATED or
  // QUOTED would already PASS at the scorer — so this branch only
  // fires on residual prompt-induced false-fails the scorer didn't
  // catch (defensive slot, expected to be rare post-calibration).
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

  // Roleplay bundles always include the full conversational transcript
  // for the operator to inspect. We surface a compact summary in the
  // smoke report (turn count + first-fail reason + per-turn pass/fail)
  // but leave the full transcript in the bundle on disk.
  const convResults = (bundle?.conversational?.results) || [];
  // Phase 4 (Roleplay UI readability): include the user prompt text
  // per turn so the UI can render a failed-turn sub-card with both
  // the prompt context AND the model's response excerpt. The prompt
  // text comes from r.question (set by the runner from the manifest).
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
    pass: !!verdict?.completionState && verdict.completionState === "PASS",
    turnCount: convResults.length,
    turnSummary,
    firstFailReason: reasonText,
    persona: bundle?.task?.persona || null,
  };
}

async function main() {
  console.log(`Roleplay smoke · provider=${provider} model=${model} cap=$${maxCostUsd}`);
  console.log(`Tests: ${TESTS.join(", ")}\n`);
  const ts = nowStamp();
  const results = [];
  let total = 0;
  let stopped = false;
  let stopReason = null;

  for (const taskId of TESTS) {
    if (total >= maxCostUsd) {
      console.log(`  cap reached ($${total.toFixed(4)} >= $${maxCostUsd}) — stopping`);
      stopped = true; stopReason = "cost_cap"; break;
    }
    console.log(`  → ${taskId}`);
    try {
      const r = await runOneTest(taskId);
      const s = summarizeBundle(r.bundle);
      total += s.costUsd;
      console.log(`    ${s.classification} (${s.attribution}) · turns=${s.turnCount} · cost=$${s.costUsd.toFixed(4)}${s.firstFailReason ? " · reason=" + String(s.firstFailReason).slice(0, 140) : ""}`);
      results.push({ taskId, ...s });
      if (["FAIL_CONFIG", "FAIL_PROVIDER", "PROVIDER_HTTP_ERROR", "SKIPPED_UNSUPPORTED_ROLEPLAY_PROFILE"].includes(s.classification)) {
        console.log(`  classification=${s.classification} — stopping smoke early`);
        stopped = true; stopReason = s.classification; break;
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      console.log(`    ERROR · ${msg.slice(0, 200)}`);
      results.push({ taskId, classification: "FAIL_HARNESS", attribution: "CONFIG", errorMessage: msg.slice(0, 400), costUsd: 0, tokensIn: 0, tokensOut: 0, pass: false, turnCount: 0, turnSummary: [], firstFailReason: msg.slice(0, 400) });
      stopped = true; stopReason = "harness_error"; break;
    }
  }

  const counts = results.reduce((a, r) => { a[r.classification] = (a[r.classification] || 0) + 1; return a; }, {});
  const attrCounts = results.reduce((a, r) => { const k = r.attribution || "PASS"; a[k] = (a[k] || 0) + 1; return a; }, {});
  console.log(`\nSummary: ${JSON.stringify(counts)} · attribution: ${JSON.stringify(attrCounts)} · total cost $${total.toFixed(4)}`);

  if (writeReport) {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = {
      schema: "crucible.roleplay-smoke.v1",
      timestamp: ts,
      commit: commitHash(),
      dirtyTree: dirtyTree(),
      provider,
      model,
      maxCostUsd,
      tests: TESTS,
      explicitTests: explicitTestsArg || null,
      phase1Only,
      totalCostUsd: total,
      classifications: counts,
      attributionCounts: attrCounts,
      stopped,
      stopReason,
      affectsLeaderboard: false,
      affectsCertification: false,
      experimental: true,
      results,
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
  return `# Roleplay smoke report

- **Timestamp (UTC):** ${j.timestamp}
- **Commit:** ${j.commit}${j.dirtyTree ? " (dirty tree)" : ""}
- **Provider/Model:** ${j.provider}/${j.model}
- **Cost cap:** $${j.maxCostUsd} · **actual:** $${j.totalCostUsd.toFixed(4)}
- **Tests:** ${j.tests.join(", ")}
- **Stopped early:** ${j.stopped ? "yes (" + j.stopReason + ")" : "no"}
- **Affects leaderboard:** ${j.affectsLeaderboard}
- **Affects certification:** ${j.affectsCertification}
- **Experimental:** ${j.experimental}

## Per-test results

| Task | Class | Attribution | Turns | Cost | Tokens in/out | Bundle id |
|---|---|---|---:|---:|---|---|
${j.results.map((r) => `| ${r.taskId} | ${r.classification} | ${r.attribution || "—"} | ${r.turnCount || 0} | $${(r.costUsd || 0).toFixed(4)} | ${(r.tokensIn || 0)}/${(r.tokensOut || 0)} | ${r.bundleId || "—"} |`).join("\n")}

## Per-turn detail

${j.results.map((r) => {
  const head = `### ${r.taskId} — ${r.classification} (${r.attribution || "—"})`;
  if (!r.turnSummary || r.turnSummary.length === 0) return `${head}\n\n_No turn detail available (${r.firstFailReason || "no transcript"})._`;
  const lines = r.turnSummary.map((t, i) => {
    const mark = t.passed ? "✓ PASS" : "✗ FAIL";
    const reason = t.failureReason ? `\n      reason: ${String(t.failureReason).slice(0, 240)}` : "";
    const preview = t.responsePreview ? `\n      preview: ${t.responsePreview.replace(/\n+/g, " ").slice(0, 200)}` : "";
    return `  ${i + 1}. ${t.questionId} — ${mark}${reason}${preview}`;
  }).join("\n");
  return `${head}\n\n${lines}`;
}).join("\n\n")}

## Classification counts

${Object.entries(j.classifications).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}

## Failure attribution counts

${Object.entries(j.attributionCounts || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}
`;
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
