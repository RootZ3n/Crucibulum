#!/usr/bin/env node
/**
 * Crucible — Vision smoke runner (Phase 4)
 *
 * Runs the 2-test Vision POC against one image-capable route
 * (default OpenRouter + xiaomi/mimo-v2-omni) under a hard cost cap.
 * Vision stays Experimental and is excluded from leaderboard +
 * certification regardless of outcome.
 *
 * Usage
 *   node scripts/vision-smoke.mjs \
 *     --provider openrouter --model xiaomi/mimo-v2-omni \
 *     --max-cost-usd 0.25 --write-report
 *
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
vision-smoke — Crucible Phase 4 vision POC

  --provider <id>          (default: openrouter — only supported transport today)
  --model <id>             (default: xiaomi/mimo-v2-omni)
  --max-cost-usd <n>       Hard cap (default 0.25). Required.
  --include-uncertainty    Add the uncertainty test (3rd POC).
  --write-report           Persist JSON + Markdown reports.
  -h, --help               Show this help.
`);
  process.exit(0);
}

const provider = arg("--provider", "openrouter");
const model = arg("--model", "xiaomi/mimo-v2-omni");
const maxCostUsd = Number(arg("--max-cost-usd", "0.25")) || 0;
const writeReport = flag("--write-report") || flag("--write");
const includeUncertainty = flag("--include-uncertainty");

if (maxCostUsd <= 0) {
  console.error("error: --max-cost-usd is required (>0)");
  process.exit(2);
}
if (provider !== "openrouter") {
  console.error(`error: only --provider openrouter is supported in Phase 4 (got: ${provider})`);
  console.error("Other providers will hit SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED.");
  process.exit(2);
}

const TESTS = ["vision-ocr-001", "vision-object-count-001"];
if (includeUncertainty) TESTS.push("vision-uncertainty-001");

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
  // Build a fresh OpenRouter adapter for the call. Capabilities flag
  // imageTransportImplemented:true tells preflightSkipCheck to NOT
  // emit SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED — we're explicitly
  // proving the OpenRouter path here.
  const adapter = new OpenRouterAdapter();
  await adapter.init({ model, api_key: process.env.OPENROUTER_API_KEY });
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
  return {
    classification: String(classification).toUpperCase(),
    costUsd: Number(usage.cost_usd || usage.estimated_cost_usd || 0),
    tokensIn: Number(usage.tokens_in || 0),
    tokensOut: Number(usage.tokens_out || 0),
    runId: bundle?.run_id || null,
    bundleId: bundle?.bundle_id || null,
    imageSent,
    skipReason: verdict?.evidence?.skip_reason || verdict?.failureReasonSummary || null,
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
      console.log(`    ${s.classification} · cost=$${s.costUsd.toFixed(4)} · image_sent=${s.imageSent}${s.skipReason ? " · skip=" + s.skipReason : ""}`);
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
      includeUncertainty,
      totalCostUsd: total,
      classifications: counts,
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

| Task | Class | Cost | Tokens in/out | Image sent | Run id | Bundle id |
|---|---|---:|---|:--:|---|---|
${j.results.map((r) => `| ${r.taskId} | ${r.classification} | $${(r.costUsd || 0).toFixed(4)} | ${(r.tokensIn || 0)}/${(r.tokensOut || 0)} | ${r.imageSent ? "✓" : "·"} | ${r.runId || "—"} | ${r.bundleId || "—"} |`).join("\n")}

${j.results.some((r) => r.skipReason) ? "\n## Skip details\n\n" + j.results.filter((r) => r.skipReason).map((r) => `- **${r.taskId}** — ${r.skipReason}${r.fixturePath ? " (fixture: " + r.fixturePath + ")" : ""}`).join("\n") : ""}

## Classification counts

${Object.entries(j.classifications).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)"}
`;
}

main().catch((err) => { console.error("fatal:", err); process.exit(1); });
