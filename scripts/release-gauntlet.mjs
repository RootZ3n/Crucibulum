#!/usr/bin/env node
/**
 * Crucible release-readiness gauntlet
 * =====================================
 *
 * Drives the real HTTP server through a deterministic matrix of failure
 * modes and captures durable evidence + classification for each. The
 * output is a release-decision report: PASS / FAIL_PRODUCT / FAIL_PROVIDER
 * / FAIL_CONFIG / SKIPPED_EXPLAINED / BLOCKED.
 *
 * Default invocation runs in `--mock-only` mode against an injected test
 * adapter, so it never burns provider credit unless `--real-provider` is
 * passed with a cost cap.
 *
 * Usage examples
 *   node scripts/release-gauntlet.mjs --dry-run-inventory
 *   node scripts/release-gauntlet.mjs --mock-only --all-families --write-report
 *   node scripts/release-gauntlet.mjs --provider openrouter --model deepseek/deepseek-v4-pro \
 *       --family personality --real-provider --max-cost-usd 1.00 --write-report
 *
 * Reports
 *   reports/release-gauntlet/latest.json
 *   reports/release-gauntlet/latest.md
 *   reports/release-gauntlet/<timestamp>.json
 *   reports/release-gauntlet/<timestamp>.md
 */

import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readdirSync, statSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(new URL("..", import.meta.url).pathname);

// ── CLI parsing ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const flags = {
  dryRunInventory: argv.includes("--dry-run-inventory"),
  mockOnly: argv.includes("--mock-only") || (!argv.includes("--real-provider") && !argv.includes("--dry-run-inventory")),
  realProvider: argv.includes("--real-provider"),
  allFamilies: argv.includes("--all-families"),
  allProviders: argv.includes("--all-providers"),
  uiShape: argv.includes("--ui-shape"),
  stopOnProductFailure: argv.includes("--stop-on-product-failure"),
  writeReport: argv.includes("--write-report") || argv.includes("--write"),
};
function readArg(name, def = null) {
  const idx = argv.indexOf(name);
  if (idx === -1) return def;
  return argv[idx + 1] ?? def;
}
const opts = {
  provider: readArg("--provider"),
  model: readArg("--model"),
  family: readArg("--family"),
  maxCostUsd: Number(readArg("--max-cost-usd", "0")) || 0,
  reportDir: readArg("--report-dir", join(REPO_ROOT, "reports", "release-gauntlet")),
};

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(`Crucible release-readiness gauntlet.

Modes:
  --dry-run-inventory          Walk tasks/ and adapters and print the inventory only.
  --mock-only                  (default) Drive deterministic test adapter scenarios; no provider cost.
  --real-provider              Hit a real provider (requires --provider, --model, --max-cost-usd).

Scope:
  --all-families               Run a dispatch sweep across every conversational task.
  --all-providers              Run the inventory against every registered adapter.
  --family <name>              Restrict to a single task family.
  --provider <id>              Restrict to a single adapter id (only meaningful with --real-provider).
  --model <id>                 Restrict to a specific model id.

Safety:
  --max-cost-usd <n>           Hard ceiling for real-provider runs.
  --stop-on-product-failure    Exit non-zero on the first FAIL_PRODUCT classification.

Output:
  --write-report               Persist JSON + Markdown reports under reports/release-gauntlet/.
  --report-dir <path>          Override the report directory.
`);
  process.exit(0);
}

// ── Inventory walker ────────────────────────────────────────────────────────

function walkInventory() {
  const tasksDir = join(REPO_ROOT, "tasks");
  const families = readdirSync(tasksDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
  const inv = { families: {}, totalTasks: 0, totalConversational: 0, totalRepo: 0 };
  for (const fam of families) {
    const taskDir = join(tasksDir, fam);
    const taskIds = readdirSync(taskDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    inv.families[fam] = { tasks: [], conversational: 0, repo: 0 };
    for (const t of taskIds) {
      const mp = join(taskDir, t, "manifest.json");
      if (!existsSync(mp)) continue;
      let manifest = null;
      try { manifest = JSON.parse(readFileSync(mp, "utf-8")); } catch { /* malformed */ }
      const mode = manifest?.execution_mode === "conversational" ? "conversational" : "repo";
      inv.families[fam].tasks.push({ id: t, mode, family: manifest?.family ?? fam, hasManifest: !!manifest });
      inv.totalTasks++;
      if (mode === "conversational") { inv.families[fam].conversational++; inv.totalConversational++; }
      else { inv.families[fam].repo++; inv.totalRepo++; }
    }
  }
  // Adapter inventory — parse REGISTRY directly from the source file.
  const regSrc = readFileSync(join(REPO_ROOT, "adapters", "registry.ts"), "utf-8");
  const adapterIds = [...regSrc.matchAll(/^\s{4}id:\s+"([a-z][a-z0-9-]+)",/gm)].map((m) => m[1]);
  inv.adapters = adapterIds;
  return inv;
}

// ── Gauntlet machinery (mock-only) ──────────────────────────────────────────
// Each scenario is a (name, intent, expectation) tuple. The harness sets the
// adapter's mode via a shared mutable, POSTs through the real HTTP server, and
// verifies the terminal state matches the contract.

async function runMockGauntlet({ inventory }) {
  // Filesystem isolation BEFORE dynamic imports so env vars propagate.
  const RUNS_DIR = mkdtempSync(join(tmpdir(), "rgaunt-runs-"));
  const STATE_DIR = mkdtempSync(join(tmpdir(), "rgaunt-state-"));
  const TASKS_DIR = mkdtempSync(join(tmpdir(), "rgaunt-tasks-"));
  mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
  process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
  process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
  process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
  process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

  // Mirror every conversational manifest into the temp tasks dir so the
  // server can dispatch any of them. Repo-mode tasks need workspaces that
  // we don't reproduce here; we skip them by design.
  for (const fam of Object.keys(inventory.families)) {
    for (const t of inventory.families[fam].tasks) {
      if (t.mode !== "conversational") continue;
      const dst = join(TASKS_DIR, fam, t.id);
      mkdirSync(dst, { recursive: true });
      copyFileSync(join(REPO_ROOT, "tasks", fam, t.id, "manifest.json"), join(dst, "manifest.json"));
    }
  }

  const { createApp } = await import(join(REPO_ROOT, "dist", "server", "app.js"));
  const { __registerTestAdapter, __clearTestAdapters } = await import(join(REPO_ROOT, "dist", "adapters", "registry.js"));
  const { activeRuns } = await import(join(REPO_ROOT, "dist", "server", "routes", "run.js"));

  // ── Test adapter: behaviour driven by `intent` mutable ────────────────────
  let intent = "success";
  let healthCallCount = 0;
  let chatCallCount = 0;

  function reset(nextIntent) {
    intent = nextIntent;
    healthCallCount = 0;
    chatCallCount = 0;
  }

  __registerTestAdapter({
    id: "gauntlet", name: "Gauntlet", kind: "local",
    provider_mode: "fixed", fixed_provider: "gauntlet",
    supports_custom_model: true,
    create: () => ({
      id: "gauntlet", name: "Gauntlet", version: "1",
      supports: () => true, supportsChat: () => true, supportsToolCalls: () => false,
      async init() {
        if (intent === "adapter-init-failure") throw new Error("synthesised adapter init failure");
      },
      async healthCheck() {
        healthCallCount++;
        if (intent === "rate-limit-with-retry-after") {
          return {
            ok: false, reason: "OpenRouter 429 (mock) — Retry-After: 5",
            providerError: { kind: "RATE_LIMIT", origin: "PROVIDER", provider: "gauntlet", adapter: "gauntlet",
              statusCode: 429, retryable: true, rawMessage: "rate limited", rawCode: "rate_limited",
              cause: null, attempt: null, durationMs: null, requestId: null, retryAfterSec: 5 },
          };
        }
        if (intent === "rate-limit-without-retry-after") {
          return {
            ok: false, reason: "Provider 429 (mock)",
            providerError: { kind: "RATE_LIMIT", origin: "PROVIDER", provider: "gauntlet", adapter: "gauntlet",
              statusCode: 429, retryable: true, rawMessage: "rate limited", rawCode: "rate_limited",
              cause: null, attempt: null, durationMs: null, requestId: null, retryAfterSec: null },
          };
        }
        if (intent === "provider-unavailable") {
          return {
            ok: false, reason: "Service unavailable (mock)",
            providerError: { kind: "UNAVAILABLE", origin: "PROVIDER", provider: "gauntlet", adapter: "gauntlet",
              statusCode: 503, retryable: true, rawMessage: "service unavailable", rawCode: null,
              cause: null, attempt: null, durationMs: null, requestId: null, retryAfterSec: 30 },
          };
        }
        if (intent === "timeout") {
          return {
            ok: false, reason: "Provider timeout (mock)",
            providerError: { kind: "TIMEOUT", origin: "PROVIDER", provider: "gauntlet", adapter: "gauntlet",
              statusCode: null, retryable: true, rawMessage: "request timed out", rawCode: "ETIMEDOUT",
              cause: null, attempt: null, durationMs: 30000, requestId: null, retryAfterSec: null },
          };
        }
        return { ok: true };
      },
      async teardown() {},
      async chat(messages) {
        chatCallCount++;
        if (intent === "chat-mid-run-failure" && chatCallCount > 1) {
          throw new Error("synthesised chat-mid-run failure");
        }
        if (intent === "malformed-response") {
          return { text: "", tokens_in: 0, tokens_out: 0, duration_ms: 1, cost_usd: 0 };
        }
        if (intent === "slow-multi-question") {
          await new Promise((r) => setTimeout(r, 50));
        }
        // Generic answer covering most deterministic scorers (text_match,
        // hedge_count, refusal_check, regex_match, recall, corporate_check).
        return {
          text: "Yes. Direct answer. I can't help with anything unsafe. bug feature question. Fastify. Wellington. THUNDERBIRD.",
          tokens_in: 4, tokens_out: 12, duration_ms: 1, cost_usd: 0,
        };
      },
      async execute() { throw new Error("repo-mode not implemented for the gauntlet adapter"); },
    }),
    provider_options: [{ id: "gauntlet", name: "Gauntlet", kind: "local", configurable: false }],
    listModels: async () => [{ id: "gauntlet-model", name: "gauntlet-model", provider: "gauntlet", kind: "local", available: true, reason: null }],
    makeConfig: () => ({}),
  });

  // ── Boot HTTP server ──────────────────────────────────────────────────────
  const server = createApp({ rateLimit: false });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function postRun(task) {
    const r = await fetch(`${base}/api/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, model: "gauntlet-model", adapter: "gauntlet" }),
    });
    return { status: r.status, body: await r.json() };
  }
  async function drainLive(runId, timeoutMs = 8000) {
    const r = await fetch(`${base}/api/run/${runId}/live`);
    if (r.status !== 200) return { frames: [], heartbeats: 0 };
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames = []; let heartbeats = 0;
    const deadline = Date.now() + timeoutMs;
    const finish = async (out) => {
      // Cancel the reader so the underlying socket releases. Without this,
      // every drained stream holds a connection open and the eventual
      // server.close() blocks indefinitely.
      try { await reader.cancel(); } catch {}
      return out;
    };
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
        if (raw.startsWith(":")) { heartbeats++; continue; }
        let evt = "", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) evt = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (evt) {
          let parsed = data;
          try { parsed = JSON.parse(data); } catch {}
          frames.push({ event: evt, data: parsed });
          if (evt === "complete" || evt === "error") return finish({ frames, heartbeats });
        }
      }
    }
    return finish({ frames, heartbeats });
  }
  async function getStatus(runId) {
    const r = await fetch(`${base}/api/run/${runId}/status`);
    if (!r.ok) return { status: "missing", httpStatus: r.status };
    return { ...(await r.json()), httpStatus: 200 };
  }
  async function getBundle(runId) {
    const r = await fetch(`${base}/api/runs/${runId}`);
    if (!r.ok) return { found: false, httpStatus: r.status };
    return { found: true, httpStatus: 200, body: await r.json() };
  }

  // ── Scenarios: each one is a small contract about terminal state ──────────
  // Pick one short conversational task as the scenario carrier.
  const CARRIER_TASK = inventory.families["personality"]?.tasks.find((t) => t.mode === "conversational")?.id || "personality-001";

  /** @typedef {{ name: string, intent: string, task?: string, expect: { terminal: "complete"|"error", classification?: string, stage?: string, providerErrorKind?: string|null, bundleOnDisk: boolean, hydratable: boolean, structuredReason: boolean } }} Scenario */
  /** @type {Scenario[]} */
  const SCENARIOS = [
    { name: "success",                      intent: "success",                       expect: { terminal: "complete", bundleOnDisk: true,  hydratable: true,  structuredReason: false } },
    { name: "rate-limit-with-Retry-After",  intent: "rate-limit-with-retry-after",   expect: { terminal: "error", classification: "could_not_start", stage: "health_check", providerErrorKind: "RATE_LIMIT", bundleOnDisk: true, hydratable: true, structuredReason: true } },
    { name: "rate-limit-without-Retry-After", intent: "rate-limit-without-retry-after", expect: { terminal: "error", classification: "could_not_start", stage: "health_check", providerErrorKind: "RATE_LIMIT", bundleOnDisk: true, hydratable: true, structuredReason: true } },
    { name: "provider-unavailable",          intent: "provider-unavailable",          expect: { terminal: "error", classification: "could_not_start", stage: "health_check", providerErrorKind: "UNAVAILABLE", bundleOnDisk: true, hydratable: true, structuredReason: true } },
    { name: "provider-timeout",              intent: "timeout",                       expect: { terminal: "error", classification: "could_not_start", stage: "health_check", providerErrorKind: "TIMEOUT", bundleOnDisk: true, hydratable: true, structuredReason: true } },
    // adapter-init-failure: the conversational preflight calls init() first
    // for the chat-support probe. When init throws there, handleRunPost
    // returns 400 synchronously — by design — and no run_id is ever
    // minted. This is a "preflight rejection" shape, which the UI's
    // runSingle catches and reports honestly without any SSE/bundle.
    { name: "adapter-init-failure (preflight 400)",     intent: "adapter-init-failure",     expect: { terminal: "preflight-400", classification: null, stage: null, providerErrorKind: null, bundleOnDisk: false, hydratable: false, structuredReason: false } },
    { name: "malformed-response",            intent: "malformed-response",            expect: { terminal: "complete", bundleOnDisk: true, hydratable: true, structuredReason: false } },
    { name: "chat-mid-run-failure",          intent: "chat-mid-run-failure",          expect: { terminal: "complete", bundleOnDisk: true, hydratable: true, structuredReason: false } },
    { name: "slow-multi-question",           intent: "slow-multi-question",           task: "role-stress-001", expect: { terminal: "complete", bundleOnDisk: true, hydratable: true, structuredReason: false } },
  ];

  const results = [];
  for (const sc of SCENARIOS) {
    const carrier = sc.task ?? CARRIER_TASK;
    reset(sc.intent);
    const post = await postRun(carrier);
    // Some scenarios legitimately end as a synchronous POST 400 — the
    // conversational preflight rejecting an adapter that can't init. In
    // that case the contract is "honest 400 with structured body", not
    // "202 + SSE error".
    if (sc.expect.terminal === "preflight-400") {
      const okHttp = post.status === 400;
      const reasonText = post.body && typeof post.body === "object" && typeof post.body.error === "string" ? post.body.error : "";
      const okReason = /unavailable/i.test(reasonText);
      const cls = (okHttp && okReason) ? "PASS" : "FAIL_PRODUCT";
      results.push({ scenario: sc.name, classification: cls, reason: cls === "PASS" ? "preflight rejected with structured 400" : `expected 400 with 'unavailable' reason; got ${post.status}: ${JSON.stringify(post.body)}`, expect: sc.expect, observed: { httpStatus: post.status, body: post.body, reasonText } });
      continue;
    }
    if (post.status !== 202) {
      results.push({ scenario: sc.name, classification: "FAIL_PRODUCT", reason: `POST /api/run returned ${post.status} for carrier ${carrier} — expected 202`, expect: sc.expect, observed: { httpStatus: post.status, body: post.body } });
      continue;
    }
    const runId = post.body.run_id;
    const live = await drainLive(runId);
    const status = await getStatus(runId);
    const bundle = await getBundle(runId);

    // Build a single observed record per scenario.
    const terminal = live.frames.find((f) => f.event === "complete" || f.event === "error");
    const observed = {
      runId,
      terminal: terminal?.event ?? "missing",
      classification: terminal?.event === "error" ? (terminal.data?.classification ?? null) : null,
      stage: terminal?.event === "error" ? (terminal.data?.stage ?? null) : null,
      providerErrorKind: terminal?.event === "error" ? (terminal.data?.provider_error?.kind ?? null) : null,
      reasonText: terminal?.event === "error" ? (terminal.data?.error ?? terminal.data?.reason ?? "") : "",
      bundleHydrated: bundle.found,
      bundleRunId: bundle.found ? bundle.body?.bundle?.run_id ?? null : null,
      statusEndpoint: status.status,
    };

    // Classification: PASS / FAIL_PRODUCT / FAIL_PROVIDER / FAIL_CONFIG.
    // Mock-only scenarios should never produce FAIL_PROVIDER; if our test
    // adapter behaved as intended, any divergence is a Crucible bug.
    let classification = "PASS";
    const failures = [];
    if (sc.expect.terminal !== observed.terminal) { failures.push(`expected terminal '${sc.expect.terminal}', got '${observed.terminal}'`); }
    if (sc.expect.classification && observed.classification !== sc.expect.classification) failures.push(`expected classification '${sc.expect.classification}', got '${observed.classification}'`);
    if (sc.expect.stage && observed.stage !== sc.expect.stage) failures.push(`expected stage '${sc.expect.stage}', got '${observed.stage}'`);
    if (sc.expect.providerErrorKind != null && observed.providerErrorKind !== sc.expect.providerErrorKind) failures.push(`expected provider_error.kind '${sc.expect.providerErrorKind}', got '${observed.providerErrorKind}'`);
    if (sc.expect.hydratable && !observed.bundleHydrated) failures.push("expected bundle hydratable via /api/runs/<runId>, but lookup 404'd — durable evidence missing");
    if (sc.expect.bundleOnDisk && !observed.bundleHydrated) failures.push("expected minimal failure bundle persisted on disk, but no file was found");
    if (sc.expect.structuredReason && /Run stream interrupted/.test(observed.reasonText)) failures.push("reason text fell back to the catch-all 'Run stream interrupted' string");
    if (sc.expect.structuredReason && /Run state unreachable/.test(observed.reasonText)) failures.push("reason text fell back to 'Run state unreachable'");
    if (sc.expect.structuredReason && (!observed.reasonText || observed.reasonText.trim() === "")) failures.push("structured cause expected but reason text was empty");
    if (observed.runId && observed.bundleHydrated && observed.bundleRunId && observed.bundleRunId !== observed.runId) failures.push(`bundle.run_id (${observed.bundleRunId}) does not match POST's run_id (${observed.runId}) — hydration mismatch`);

    if (failures.length > 0) classification = "FAIL_PRODUCT";
    results.push({ scenario: sc.name, classification, reason: failures.join("; ") || "all contracts satisfied", expect: sc.expect, observed });
    if (flags.stopOnProductFailure && classification === "FAIL_PRODUCT") break;
  }

  // ── Dispatch sweep across every conversational task ─────────────────────
  // Every conversational task that exists on disk must dispatch successfully
  // through the always-success adapter. Anything else is a manifest defect.
  const dispatchResults = [];
  if (flags.allFamilies || flags.dryRunInventory === false) {
    reset("success");
    for (const fam of Object.keys(inventory.families)) {
      for (const t of inventory.families[fam].tasks) {
        if (t.mode !== "conversational") continue;
        if (opts.family && fam !== opts.family) continue;
        const p = await postRun(t.id);
        if (p.status !== 202) {
          dispatchResults.push({ family: fam, task: t.id, classification: "FAIL_CONFIG", reason: `POST returned ${p.status}: ${JSON.stringify(p.body).slice(0, 160)}` });
          continue;
        }
        const runId = p.body.run_id;
        const live = await drainLive(runId);
        const terminal = live.frames.find((f) => f.event === "complete" || f.event === "error");
        const bundle = await getBundle(runId);
        if (!terminal) {
          dispatchResults.push({ family: fam, task: t.id, classification: "FAIL_PRODUCT", reason: "no terminal SSE frame within timeout", runId });
        } else if (terminal.event === "error") {
          dispatchResults.push({ family: fam, task: t.id, classification: "FAIL_PRODUCT", reason: `unexpected error frame: ${terminal.data?.error ?? "unknown"}`, runId });
        } else if (!bundle.found) {
          dispatchResults.push({ family: fam, task: t.id, classification: "FAIL_PRODUCT", reason: "no bundle on disk after complete", runId });
        } else {
          dispatchResults.push({ family: fam, task: t.id, classification: "PASS", runId, bundleId: bundle.body?.bundle?.bundle_id });
        }
      }
    }
  }

  // ── activeRuns GC fallback ──────────────────────────────────────────────
  // After a real failure, evicting the activeRuns entry must NOT lose the
  // failure receipt — /api/runs/<runId> must still hydrate.
  const gcResults = [];
  reset("rate-limit-with-retry-after");
  const gcPost = await postRun(CARRIER_TASK);
  const gcRunId = gcPost.body?.run_id;
  if (gcPost.status === 202 && gcRunId) {
    await drainLive(gcRunId);
    // Wait until the on-disk file matching this run_id exists. drainLive
    // returns when the SSE error frame arrives, but storeBundle runs
    // BEFORE broadcastSSE in the catch path — so the file should already
    // exist. Poll briefly to handle filesystem flush timing.
    let bundleFileFound = false;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      const filesNow = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
      bundleFileFound = filesNow.some((f) => {
        try { return JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")).run_id === gcRunId; }
        catch { return false; }
      });
      if (bundleFileFound) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    activeRuns.delete(gcRunId);
    const statusAfterGc = await getStatus(gcRunId);
    const bundleAfterGc = await getBundle(gcRunId);
    const passed = statusAfterGc.httpStatus === 200 && bundleAfterGc.found;
    gcResults.push({
      probe: "activeRuns evict → /status + /api/runs/<runId>",
      classification: passed ? "PASS" : "FAIL_PRODUCT",
      observed: { statusHttp: statusAfterGc.httpStatus, statusBody: statusAfterGc.status, bundleHttp: bundleAfterGc.httpStatus, bundleRunId: bundleAfterGc.body?.bundle?.run_id ?? null, postRunId: gcRunId, bundleFileOnDiskBeforeDelete: bundleFileFound, fileCount: readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json")).length },
    });
  } else {
    gcResults.push({ probe: "activeRuns evict probe", classification: "FAIL_PRODUCT", reason: `POST returned ${gcPost.status}` });
  }

  // ── Identity sweep: 20 rapid POSTs (frozen Date.now) must get unique ids ─
  const identityResults = [];
  {
    reset("success");
    const realNow = Date.now;
    Date.now = () => realNow.call(Date);
    try {
      const posts = await Promise.all([...Array(20)].map(() => postRun(CARRIER_TASK)));
      const ids = new Set(posts.map((p) => p.body?.run_id));
      identityResults.push({ probe: "20 concurrent POSTs at frozen Date.now → unique run_ids", classification: ids.size === posts.length ? "PASS" : "FAIL_PRODUCT", observed: { unique: ids.size, total: posts.length } });
      for (const p of posts) if (p.body?.run_id) await drainLive(p.body.run_id);
    } finally {
      Date.now = realNow;
    }
  }

  // ── Retention dry-run probe ─────────────────────────────────────────────
  const retentionResults = [];
  try {
    const { runRetention } = await import(join(REPO_ROOT, "dist", "core", "retention.js"));
    const r = runRetention({ dryRun: true, config: { enabled: true, defaultRetentionDays: 14, keepSuccessDays: 14, keepFailedDays: 7, maxRunFiles: 2000, maxBytes: 1024 * 1024 * 1024, keepPinned: true, dryRunDefault: true } });
    retentionResults.push({ probe: "retention dry-run scans runs dir, classifies entries", classification: "PASS", observed: { totalFiles: r.plan.scan.totalFiles, totalBytes: r.plan.scan.totalBytes, eligible: r.plan.toDelete.length, dryRun: r.apply.dryRun } });
  } catch (err) {
    retentionResults.push({ probe: "retention dry-run probe", classification: "FAIL_CONFIG", reason: String(err).slice(0, 240) });
  }

  // ── Classification audit: regex-grep on every observed reason text ──────
  // Any structured-cause scenario whose reason text contains the catch-all
  // or "Run state unreachable" is a release blocker. We checked this above
  // per scenario; gather a final summary here for the report.
  const classificationAudit = {
    catchAllOccurrences: results.filter((r) => /Run stream interrupted/.test(r.observed?.reasonText ?? "")).length,
    unreachableOccurrences: results.filter((r) => /Run state unreachable/.test(r.observed?.reasonText ?? "")).length,
    emptyReasonOnError: results.filter((r) => r.observed?.terminal === "error" && (!r.observed?.reasonText || r.observed.reasonText.trim() === "")).length,
  };

  __clearTestAdapters();
  await new Promise((r) => server.close(r));

  return { scenarios: results, dispatch: dispatchResults, gc: gcResults, identity: identityResults, retention: retentionResults, classificationAudit, runsDir: RUNS_DIR };
}

// ── Tally + release decision ────────────────────────────────────────────────

function tally(report) {
  const tally = { PASS: 0, FAIL_PRODUCT: 0, FAIL_PROVIDER: 0, FAIL_CONFIG: 0, SKIPPED_EXPLAINED: 0, BLOCKED: 0 };
  const bucket = (item) => { tally[item.classification] = (tally[item.classification] ?? 0) + 1; };
  for (const it of report.scenarios) bucket(it);
  for (const it of report.dispatch) bucket(it);
  for (const it of report.gc) bucket(it);
  for (const it of report.identity) bucket(it);
  for (const it of report.retention) bucket(it);
  return tally;
}

function decide(report) {
  const t = tally(report);
  const reasons = [];
  if (t.FAIL_PRODUCT > 0) reasons.push(`${t.FAIL_PRODUCT} FAIL_PRODUCT`);
  if (t.FAIL_CONFIG > 0) reasons.push(`${t.FAIL_CONFIG} FAIL_CONFIG`);
  if (t.BLOCKED > 0) reasons.push(`${t.BLOCKED} BLOCKED`);
  if (report.classificationAudit.catchAllOccurrences > 0) reasons.push(`${report.classificationAudit.catchAllOccurrences} catch-all "Run stream interrupted" leaks`);
  if (report.classificationAudit.unreachableOccurrences > 0) reasons.push(`${report.classificationAudit.unreachableOccurrences} "Run state unreachable" leaks`);
  return { ready: reasons.length === 0, blockers: reasons, tally: t };
}

// ── Markdown report renderer ────────────────────────────────────────────────

function renderMarkdown(report, decision, inventory) {
  const ts = new Date().toISOString();
  const head = `# Crucible Release Gauntlet
_Generated: ${ts}_

**Release-ready:** ${decision.ready ? "**YES** ✅" : "**NO** ❌"}
${decision.ready ? "" : `\n**Blockers:**\n${decision.blockers.map((b) => `- ${b}`).join("\n")}\n`}

**Counts:** ${Object.entries(decision.tally).filter(([, n]) => n > 0).map(([k, n]) => `${k}: ${n}`).join(" · ") || "—"}
`;

  const inv = `\n## Inventory\n
- Task families: ${Object.keys(inventory.families).length}
- Tasks total: ${inventory.totalTasks} (conversational: ${inventory.totalConversational}, repo: ${inventory.totalRepo})
- Registered adapters: ${inventory.adapters.length} (${inventory.adapters.join(", ")})
`;

  const renderRow = (it, cls = it.classification) => {
    const mark = cls === "PASS" ? "✅" : cls === "FAIL_PRODUCT" ? "❌" : cls === "FAIL_PROVIDER" ? "🟡" : cls === "FAIL_CONFIG" ? "⚠️" : "—";
    return `${mark} ${cls}`;
  };

  const scenSec = `\n## Scenario matrix (mock-only)\n\n| Scenario | Result | Carrier task | Notes |\n|---|---|---|---|\n${
    report.scenarios.map((s) => `| \`${s.scenario}\` | ${renderRow(s)} | (carrier) | ${s.reason.slice(0, 120)} |`).join("\n")
  }\n`;

  const disp = report.dispatch.length === 0 ? "" : `\n## Conversational-task dispatch sweep\n\n${report.dispatch.length} tasks dispatched. Failures:\n\n${
    report.dispatch.filter((d) => d.classification !== "PASS").length === 0
      ? "_(none)_"
      : report.dispatch.filter((d) => d.classification !== "PASS").map((d) => `- ${renderRow(d)} **${d.family}/${d.task}** — ${d.reason}`).join("\n")
  }\n\nPass count: ${report.dispatch.filter((d) => d.classification === "PASS").length}/${report.dispatch.length}\n`;

  const gc = `\n## activeRuns GC fallback\n\n${report.gc.map((p) => `- ${renderRow(p)} \`${p.probe}\` — ${JSON.stringify(p.observed ?? p.reason)}`).join("\n")}\n`;
  const ident = `\n## Identity (run_id uniqueness)\n\n${report.identity.map((p) => `- ${renderRow(p)} \`${p.probe}\` — ${JSON.stringify(p.observed)}`).join("\n")}\n`;
  const retn = `\n## Retention\n\n${report.retention.map((p) => `- ${renderRow(p)} \`${p.probe}\` — ${JSON.stringify(p.observed ?? p.reason)}`).join("\n")}\n`;

  const audit = `\n## Classification audit\n
- "Run stream interrupted" leaks: ${report.classificationAudit.catchAllOccurrences}
- "Run state unreachable" leaks: ${report.classificationAudit.unreachableOccurrences}
- Empty reason on error frames: ${report.classificationAudit.emptyReasonOnError}
`;

  return head + inv + scenSec + disp + gc + ident + retn + audit;
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const inventory = walkInventory();

  if (flags.dryRunInventory) {
    console.log(`Crucible inventory:\n`);
    console.log(`  families:            ${Object.keys(inventory.families).length}`);
    console.log(`  tasks total:         ${inventory.totalTasks}`);
    console.log(`  conversational:      ${inventory.totalConversational}`);
    console.log(`  repo:                ${inventory.totalRepo}`);
    console.log(`  registered adapters: ${inventory.adapters.length}`);
    for (const fam of Object.keys(inventory.families).sort()) {
      const v = inventory.families[fam];
      console.log(`    ${fam.padEnd(24)} ${v.tasks.length} tasks  (conv=${v.conversational}, repo=${v.repo})`);
    }
    console.log(`\n  adapters: ${inventory.adapters.join(", ")}`);
    process.exit(0);
  }

  if (flags.realProvider) {
    console.error("--real-provider is not implemented in this gauntlet revision.");
    console.error("Run real-provider profiles manually via `npm run harness -- --adapter <id> --model <id>` and capture the JSON report under reports/release-gauntlet/.");
    process.exit(2);
  }

  console.log("Running mock-only gauntlet…");
  const report = await runMockGauntlet({ inventory });
  const decision = decide(report);

  console.log(`\n${decision.ready ? "✅ RELEASE READY" : "❌ NOT RELEASE READY"}`);
  console.log(`Counts: ${Object.entries(decision.tally).filter(([, n]) => n > 0).map(([k, n]) => `${k}=${n}`).join(" · ") || "(empty)"}`);
  if (!decision.ready) for (const b of decision.blockers) console.log(`  - ${b}`);
  console.log("");

  if (flags.writeReport) {
    mkdirSync(opts.reportDir, { recursive: true });
    const tsSlug = new Date().toISOString().replace(/[:.]/g, "-");
    const jsonPath = join(opts.reportDir, `${tsSlug}.json`);
    const mdPath = join(opts.reportDir, `${tsSlug}.md`);
    const latestJson = join(opts.reportDir, "latest.json");
    const latestMd = join(opts.reportDir, "latest.md");
    const payload = { generatedAt: new Date().toISOString(), inventory, report, decision, mode: "mock-only" };
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    writeFileSync(latestJson, JSON.stringify(payload, null, 2));
    const md = renderMarkdown(report, decision, inventory);
    writeFileSync(mdPath, md);
    writeFileSync(latestMd, md);
    console.log(`Wrote: ${jsonPath}`);
    console.log(`Wrote: ${mdPath}`);
    console.log(`Wrote: ${latestJson} (overwritten)`);
    console.log(`Wrote: ${latestMd} (overwritten)`);
  }

  process.exit(decision.ready ? 0 : 1);
})().catch((err) => {
  console.error("gauntlet failed:", err);
  process.exit(2);
});
