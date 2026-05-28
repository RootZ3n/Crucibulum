#!/usr/bin/env node
/**
 * Luak — Vision smoke runner (Phase 6: all 5 POC tests by default)
 *
 * Runs the Vision POC tests against one image-capable route
 * (default OpenRouter + xiaomi/mimo-v2-omni) under a hard cost cap.
 * Vision stays Experimental and is excluded from leaderboard +
 * certification regardless of outcome.
 *
 * Default test set (Phase 6, all 5 POC):
 *   vision-ocr-001, vision-ui-001, vision-chart-001,
 *   vision-object-count-001, vision-uncertainty-001
 *
 * Usage
 *   node scripts/vision-smoke.mjs \
 *     --provider openrouter --model xiaomi/mimo-v2-omni \
 *     --max-cost-usd 0.25 --write-report
 *
 *   # Phase-4 backcompat: run only OCR + object-count
 *   node scripts/vision-smoke.mjs ... --smoke-minimal
 *
 *   # Custom selection
 *   node scripts/vision-smoke.mjs ... --tests vision-ocr-001,vision-ui-001
 *
 *   # Phase-4 backcompat: opt-in addition (silently no-op in Phase 6 default)
 *   node scripts/vision-smoke.mjs ... --include-uncertainty
 *
 * Reports
 *   reports/capability-expansion/vision-smoke/<ts>.{json,md}
 *   reports/capability-expansion/vision-smoke/latest.{json,md}
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { runConversationalTask } from "../dist/core/conversational-runner.js";
import { OpenRouterAdapter } from "../dist/adapters/openrouter.js";
import { OpenAIAdapter } from "../dist/adapters/openai.js";

// Provider registry for vision-smoke. Each entry knows how to construct
// + init its adapter and which env var its API key lives in. Adding a
// new vision-capable provider here is the smallest change required to
// extend the smoke; the runner + skip-classifier handle the rest.
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
const OUT_DIR = join(ROOT, "reports", "capability-expansion", "vision-smoke");

// Load .env manually (no dotenv dependency) — same pattern release-gauntlet uses.
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
vision-smoke — Luak Phase 6 vision POC (all 5 by default)

  --provider <id>          openrouter | openai (default: openrouter)
  --model <id>             (default: xiaomi/mimo-v2-omni)
  --max-cost-usd <n>       Hard cap (default 0.25). Required.
  --smoke-minimal          Phase-4 backcompat: run only the 2-test set
                           (vision-ocr-001, vision-object-count-001).
  --tests <csv>            Explicit task-id list, overrides defaults.
                           Example: --tests vision-ocr-001,vision-ui-001
  --include-uncertainty    Phase-4 backcompat. In Phase 6 default already
                           includes uncertainty; ignored unless --smoke-minimal.
  --write-report           Persist JSON + Markdown reports.
  -h, --help               Show this help.
`);
  process.exit(0);
}

const provider = arg("--provider", "openrouter");
// Phase 13-B: default Vision route switched from xiaomi/mimo-v2-omni
// to xiaomi/mimo-v2.5 based on Phase 13-A evidence (5/5 stability at
// ~9× lower observed cost, no scorer caveats). v2-omni remains a
// supported value — operators can pass --model xiaomi/mimo-v2-omni
// explicitly to rerun against the legacy/proven fallback. This is an
// operational/recommendation default only; it does not certify or
// promote v2.5 and never writes to certified-models.json.
const model = arg("--model", "xiaomi/mimo-v2.5");
const maxCostUsd = Number(arg("--max-cost-usd", "0.25")) || 0;
const writeReport = flag("--write-report") || flag("--write");
const smokeMinimal = flag("--smoke-minimal");
const includeUncertainty = flag("--include-uncertainty");
const explicitTestsArg = arg("--tests", null);

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

// Phase 14 / Roadmap C — Vision suite expanded 5 → 15 tests. Original
// POC 5 are preserved first to keep historical reports comparable.
const ALL_TESTS = [
  // Phase 6 — POC 5.
  "vision-ocr-001",
  "vision-ui-001",
  "vision-chart-001",
  "vision-object-count-001",
  "vision-uncertainty-001",
  // Phase 14 — suite expansion (+10).
  "vision-small-text-001",
  "vision-noisy-text-001",
  "vision-spatial-001",
  "vision-spatial-002",
  "vision-visual-contradiction-001",
  "vision-hallucination-resistance-001",
  "vision-multi-object-compare-001",
  "vision-ui-state-001",
  "vision-chart-trend-001",
  "vision-table-001",
];
const MINIMAL_TESTS = ["vision-ocr-001", "vision-object-count-001"];

let TESTS;
if (explicitTestsArg) {
  TESTS = explicitTestsArg.split(",").map((s) => s.trim()).filter(Boolean);
  for (const t of TESTS) {
    if (!ALL_TESTS.includes(t)) {
      console.error(`error: unknown test id '${t}' (known: ${ALL_TESTS.join(", ")})`);
      process.exit(2);
    }
  }
} else if (smokeMinimal) {
  TESTS = [...MINIMAL_TESTS];
  if (includeUncertainty) TESTS.push("vision-uncertainty-001");
} else {
  // Phase 6 default: all 5 POC tests.
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
  // Build a fresh adapter for the call. Capabilities flag
  // imageTransportImplemented:true tells preflightSkipCheck to NOT
  // emit SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED — we're explicitly
  // proving the provider's image path here. The adapter id is
  // resolved from PROVIDERS at script top.
  const adapter = providerDef.build();
  await adapter.init(providerDef.initArgs(model));
  try {
    const result = await runConversationalTask({
      taskId,
      adapter,
      model,
      capabilities: {
        supportsVision: true,
        supportsImageInput: true,
        imageTransportImplemented: true,
      },
    });
    // Persist the bundle so the operator can grep / inspect later.
    // The conversational runner doesn't auto-persist on direct call,
    // only on the server's POST /api/run path.
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

// Phase 10: failure attribution. Maps a vision-smoke per-test result
// into one of six categories so the comparison report can show *who*
// is responsible for a non-PASS outcome:
//
//   PASS          — scorer accepted the answer
//   MODEL         — model received the image and answered incorrectly
//                   (LOW_SCORE without scorer/fixture caveats; wrong
//                   count, wrong fact, etc.)
//   FIXTURE       — failure traceable to fixture missing/hash drift
//                   (preflight) or scorer reason flagging fixture
//                   readability (e.g. uncertainty test that the
//                   fixture itself was too readable to challenge)
//   SCORER        — failure traceable to a scorer rule/over-strictness;
//                   used today for "answer too verbose" max_chars hits
//                   where the substantive answer was correct
//   PROVIDER      — provider returned non-2xx / timeout / network err
//   CONFIG        — auth / capability config / fixture-load problem
//   NEEDS_REVIEW  — scorer returned an explicit NEEDS_REVIEW marker
//                   (e.g. hedged-but-guessing on uncertainty test)
//
// Returns the canonical attribution label. The caller writes it
// into the per-test report entry alongside the existing
// `classification` field; the two are complementary (classification
// describes WHAT happened, attribution describes WHO is responsible).
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
  // Extract per-question detail for the report. The bundle either
  // PASSed (verdict.completionState=PASS), FAILED, or was SKIPPED by
  // preflight before any provider call.
  const score = bundle?.score || {};
  const verdict = bundle?.verdict || {};
  const usage = bundle?.usage || {};
  const skip = score.skipped === true ? (score.skip_classification || verdict.failureReasonCode || "SKIPPED") : null;
  const classification = skip
    || (verdict.completionState === "PASS" ? "PASS" : verdict.failureReasonCode || verdict.completionState || "UNKNOWN");
  // image_sent inferred from the timeline: any provider_attempt with
  // multimodal content carries it. As a robust proxy, check whether
  // bundle was for vision family and bypassed skip.
  const imageSent = bundle?.task?.family === "vision" && !skip;
  // The detailed failure reason — for LOW_SCORE this is the per-question
  // scorer message, more useful for attribution than the verdict summary.
  // Gated on r.passed === false so PASS-with-marker reasons (e.g. Phase 12
  // [UNCERTAINTY=VERBOSE_BUT_SAFE] marker) do not leak into attribution.
  const convResults = (bundle?.conversational?.results) || [];
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
    runId: bundle?.run_id || null,
    bundleId: bundle?.bundle_id || null,
    imageSent,
    skipReason,
    fixturePath: verdict?.evidence?.fixture_path || null,
    pass: !!verdict?.completionState && verdict.completionState === "PASS",
  };
}

async function main() {
  console.log(`Vision smoke · provider=${provider} model=${model} cap=$${maxCostUsd}`);
  console.log(`Tests: ${TESTS.join(", ")}\n`);
  const ts = nowStamp();
  const results = [];
  let total = 0;
  let stopped = false;
  let stopReason = null;
  for (const taskId of TESTS) {
    if (total >= maxCostUsd) {
      console.log(`  cap reached ($${total.toFixed(4)} >= $${maxCostUsd}) — stopping`);
      stopped = true;
      stopReason = "cost_cap";
      break;
    }
    console.log(`  → ${taskId}`);
    try {
      const r = await runOneTest(taskId);
      const s = summarizeBundle(r.bundle);
      total += s.costUsd;
      console.log(`    ${s.classification} (${s.attribution}) · cost=$${s.costUsd.toFixed(4)} · image_sent=${s.imageSent}${s.skipReason ? " · reason=" + String(s.skipReason).slice(0, 140) : ""}`);
      results.push({ taskId, ...s });
      if (["FAIL_CONFIG", "FAIL_PROVIDER", "SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED", "SKIPPED_UNSUPPORTED_MULTIMODAL", "SKIPPED_FIXTURE_MISSING", "SKIPPED_FIXTURE_HASH_MISMATCH"].includes(s.classification)) {
        console.log(`  classification=${s.classification} — stopping smoke early per spec`);
        stopped = true;
        stopReason = s.classification;
        break;
      }
    } catch (err) {
      const msg = String((err && err.message) || err);
      console.log(`    ERROR · ${msg.slice(0, 200)}`);
      results.push({ taskId, classification: "FAIL_HARNESS", errorMessage: msg.slice(0, 400), costUsd: 0, tokensIn: 0, tokensOut: 0, imageSent: false, pass: false });
      stopped = true;
      stopReason = "harness_error";
      break;
    }
  }

  const counts = results.reduce((a, r) => { a[r.classification] = (a[r.classification] || 0) + 1; return a; }, {});
  console.log(`\nSummary: ${JSON.stringify(counts)} · total cost $${total.toFixed(4)}`);

  if (writeReport) {
    mkdirSync(OUT_DIR, { recursive: true });
    const json = {
      schema: "crucible.vision-smoke.v1",
      timestamp: ts,
      commit: commitHash(),
      dirtyTree: dirtyTree(),
      provider,
      model,
      maxCostUsd,
      tests: TESTS,
      smokeMinimal,
      includeUncertainty,
      explicitTests: explicitTestsArg || null,
      totalCostUsd: total,
      classifications: counts,
      // Phase 10: failure attribution roll-up. Same per-test attribution
      // is on each result; the rollup makes "how many failures are model
      // vs fixture vs scorer" visible at a glance.
      attributionCounts: results.reduce((a, r) => {
        const k = r.attribution || "PASS";
        a[k] = (a[k] || 0) + 1;
        return a;
      }, {}),
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

  // Exit 0 on real results (even SKIP) so the operator's wrapper
  // scripts can keep moving; nonzero only on harness/code-level
  // errors that need investigation.
  process.exit(stopReason === "harness_error" ? 1 : 0);
}

function renderMd(j) {
  return `# Vision smoke report

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

| Task | Class | Attribution | Cost | Tokens in/out | Image sent | Bundle id |
|---|---|---|---:|---|:--:|---|
${j.results.map((r) => `| ${r.taskId} | ${r.classification} | ${r.attribution || "—"} | $${(r.costUsd || 0).toFixed(4)} | ${(r.tokensIn || 0)}/${(r.tokensOut || 0)} | ${r.imageSent ? "✓" : "·"} | ${r.bundleId || "—"} |`).join("\n")}

${j.results.some((r) => r.skipReason && r.classification !== "PASS") ? "\n## Failure detail\n\n" + j.results.filter((r) => r.skipReason && r.classification !== "PASS").map((r) => `- **${r.taskId}** (${r.attribution || "—"}) — ${String(r.skipReason).slice(0, 400)}${r.fixturePath ? " (fixture: " + r.fixturePath + ")" : ""}`).join("\n") : ""}

## Classification counts

${Object.entries(j.classifications).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}

## Failure attribution counts

${Object.entries(j.attributionCounts || {}).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}
`;
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
