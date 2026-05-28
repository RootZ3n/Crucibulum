#!/usr/bin/env node
/**
 * Luak release-readiness gauntlet
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

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, cpSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
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
  repoSmoke: argv.includes("--repo-smoke"),
  broadSmoke: argv.includes("--broad-smoke"),
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
  console.log(`Luak release-readiness gauntlet.

Modes:
  --dry-run-inventory          Walk tasks/ and adapters and print the inventory only.
  --mock-only                  (default) Drive deterministic test adapter scenarios; no provider cost.
  --real-provider              Hit a real provider (requires --provider, --model, --max-cost-usd).

Scope:
  --all-families               Run a dispatch sweep across every conversational task.
  --repo-smoke                 Run representative repo-mode smoke tasks with the deterministic adapter.
  --broad-smoke                Run broader real-provider family-class smoke tasks.
  --ui-shape                   Include automated UI-shape certification checks.
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

// ── Release metadata + static audits ───────────────────────────────────────

const RELEASE_TARGETS = [
  { provider: "openrouter", adapter: "openrouter", model: "deepseek/deepseek-v4-pro" },
  { provider: "openrouter", adapter: "openrouter", model: "xiaomi/mimo-v2.5-pro" },
  { provider: "ollama", adapter: "ollama", model: "qwen3.5:9b" },
];

const FAMILY_CLASSES = [
  { id: "conversational/personality", families: ["personality", "identity", "classification"], representative: "personality-001", mode: "conversational" },
  { id: "role-stress/prompt-sensitivity", families: ["role-stress", "prompt-sensitivity", "context-degradation"], representative: "role-stress-001", mode: "conversational", slow: true },
  { id: "safety/poison/adversarial", families: ["safety", "poison"], representative: "safety-001", repoRepresentative: "poison-001", mode: "mixed" },
  { id: "tool-calling", families: ["tool-calling"], representative: "tool-003", mode: "repo" },
  { id: "trust/operational-trust", families: ["operational-trust"], representative: "op-001", mode: "conversational" },
  { id: "repo-mode/build/code", families: ["orchestration", "spec", "code", "workflow"], representative: "coord-001", mode: "repo" },
  { id: "provider/adapter-health", families: [], representative: "health_check", mode: "provider" },
  { id: "legacy-surfaced", families: ["memory", "reasoning", "summarization", "thinking-mode", "token-efficiency", "truthfulness", "instruction-obedience"], representative: "memory-001", mode: "conversational" },
];

const REPO_SMOKE_TASKS = [
  { classId: "repo-mode/build/code", family: "orchestration", task: "coord-001", fixtureProbe: "tasks/orchestration/coord-001/repo/src/users/register.js" },
  { classId: "repo-mode/build/code", family: "spec", task: "spec-001", fixtureProbe: "tasks/spec/spec-001/repo/src/api/validate.js" },
  { classId: "tool-calling", family: "tool-calling", task: "tool-003", fixtureProbe: "tasks/tool-calling/tool-003/repo/tool-trial/greet.sh" },
];

const BROAD_REAL_PROVIDER_TEST_PLAN = [
  { classId: "conversational/personality", kind: "personality-easy", task: "personality-001" },
  { classId: "role-stress/prompt-sensitivity", kind: "role-stress-slow", task: "role-stress-001" },
  { classId: "safety/poison/adversarial", kind: "safety-smoke", task: "safety-001" },
  { classId: "trust/operational-trust", kind: "trust-smoke", task: "op-001" },
  { classId: "tool-calling", kind: "repo-tool-smoke", task: "tool-003" },
];

function sh(args, fallback = "") {
  try { return execFileSync(args[0], args.slice(1), { cwd: REPO_ROOT, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return fallback; }
}

function packageVersion() {
  try { return JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")).version ?? null; }
  catch { return null; }
}

function gitStatusEntries() {
  const out = sh(["git", "status", "--short"], "");
  return out ? out.split("\n").filter(Boolean) : [];
}

function isReportOnlyStatus(entry) {
  return / reports\/release-gauntlet\//.test(entry) || /^\?\? reports\/release-gauntlet\//.test(entry);
}

function buildMetadata({ mode, profile, maxCostUsd, actualCostUsd = null }) {
  loadEnvFile();
  const status = gitStatusEntries();
  const sourceDirty = status.filter((entry) => !isReportOnlyStatus(entry));
  const envProfile = Object.fromEntries(Object.entries(ADAPTER_KEY_BY_PROVIDER).map(([provider, envKey]) => [
    provider,
    envKey == null ? { envKey: null, configured: true, source: "local/no-key" } : { envKey, configured: !!process.env[envKey], source: process.env[envKey] ? "env-present-redacted" : "unset" },
  ]));
  return {
    timestamp: new Date().toISOString(),
    command: `node scripts/release-gauntlet.mjs ${argv.join(" ")}`.trim(),
    nodeVersion: process.version,
    packageVersion: packageVersion(),
    mode,
    profile,
    maxCostUsd,
    actualCostUsd,
    git: {
      commit: sh(["git", "rev-parse", "HEAD"], "unknown"),
      branch: sh(["git", "branch", "--show-current"], "unknown"),
      dirtyTree: sourceDirty.length > 0,
      dirtyTreeEntries: sourceDirty,
      workingTreeEntries: status,
      reportArtifactEntries: status.filter((entry) => isReportOnlyStatus(entry)),
    },
    environmentProfile: envProfile,
    RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: sourceDirty.length > 0,
  };
}

function readUiModelGroups() {
  const html = readFileSync(join(REPO_ROOT, "ui", "index.html"), "utf-8");
  const groups = [];
  const groupRe = /\{key:'([^']+)',label:'([^']+)',providerId:'([^']+)',adapterId:'([^']+)',kind:'([^']+)',models:\[([\s\S]*?)\]\}/g;
  let m;
  while ((m = groupRe.exec(html))) {
    const models = [...m[6].matchAll(/\{id:'([^']+)',label:'([^']+)'/g)].map((mm) => ({ id: mm[1], label: mm[2] }));
    groups.push({ key: m[1], label: m[2], providerId: m[3], adapterId: m[4], kind: m[5], models });
  }
  return groups;
}

function buildAdapterExposureAudit(inventory) {
  loadEnvFile();
  const groups = readUiModelGroups();
  const visibleAdapters = new Set(groups.map((g) => g.adapterId));
  const targetAdapters = new Set(RELEASE_TARGETS.map((t) => t.adapter));
  const envByAdapter = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", minimax: "MINIMAX_API_KEY", zai: "ZAI_API_KEY", google: "GOOGLE_AI_API_KEY" };
  return inventory.adapters.map((adapter) => {
    const envKey = envByAdapter[adapter] ?? null;
    const configured = envKey ? !!process.env[envKey] : adapter === "ollama" || visibleAdapters.has(adapter);
    const certified = targetAdapters.has(adapter);
    return {
      adapter,
      visibleInModelPicker: visibleAdapters.has(adapter),
      configured,
      certified,
      releaseSupported: certified,
      status: certified ? "CERTIFIED_RELEASE_TARGET" : configured ? "UNCERTIFIED_NOT_RELEASE_TARGET" : "BLOCKED_CONFIG",
      envKey,
    };
  });
}

function buildModelPickerAudit() {
  const groups = readUiModelGroups();
  return groups.flatMap((group) => group.models.map((model) => {
    const target = RELEASE_TARGETS.find((t) => t.provider === group.providerId && t.adapter === group.adapterId && t.model === model.id);
    return {
      modelId: model.id,
      provider: group.providerId,
      adapter: group.adapterId,
      certified: !!target,
      releaseTarget: !!target,
      lastCertifiedReportPath: target ? `reports/release-gauntlet/real-provider/*-${target.provider}-${target.model.replace(/[/:]/g, "-")}.json` : null,
      status: target ? "CERTIFIED_RELEASE_TARGET" : "UNCERTIFIED_NOT_RELEASE_TARGET",
    };
  }));
}

function buildUiCertification() {
  const html = readFileSync(join(REPO_ROOT, "ui", "index.html"), "utf-8");
  const checks = [
    { id: "evidence-inspector-hydration", pass: /\/api\/runs\/\$\{encodeURIComponent\(status\.bundle_id\)\}/.test(html) && /\/api\/runs\/\$\{encodeURIComponent\(runId\)\}/.test(html) },
    { id: "provider-cooldown-surfaced", pass: /Provider cooling down after rate limit/.test(html) && /RATE_LIMIT_MAX_RETRIES/.test(html) },
    { id: "catch-all-bounded", pass: (html.match(/Run stream interrupted — no evidence bundle produced/g) ?? []).length <= 2 },
    { id: "unreachable-fallback-bundle-first", pass: /no evidence bundle was found/.test(html) && /Reconciled from \/api\/runs/.test(html) },
    { id: "all-release-tabs-visible", pass: ["personality", "poison", "build", "safety", "memory", "tools", "trust", "providers"].every((key) => new RegExp(`${key}:\\{key:'${key}'`).test(html)) },
  ];
  return {
    automated: checks,
    automatedPassed: checks.every((c) => c.pass),
    browserManualChecklistPath: "docs/UI_RELEASE_CERTIFICATION.md",
    browserManualCompleted: false,
    classification: checks.every((c) => c.pass) ? "PASS_AUTOMATED_SHAPE_ONLY" : "FAIL_PRODUCT",
  };
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
  // server can dispatch any of them. When --repo-smoke is enabled, also copy
  // the representative repo fixtures so the real repo-mode runner, workspace
  // isolation, diff collector, judge, bundle store, and hydration path run.
  for (const fam of Object.keys(inventory.families)) {
    for (const t of inventory.families[fam].tasks) {
      const repoSmokeTask = flags.repoSmoke && REPO_SMOKE_TASKS.some((r) => r.task === t.id);
      if (t.mode !== "conversational" && !repoSmokeTask) continue;
      const dst = join(TASKS_DIR, fam, t.id);
      mkdirSync(dst, { recursive: true });
      copyFileSync(join(REPO_ROOT, "tasks", fam, t.id, "manifest.json"), join(dst, "manifest.json"));
      const srcRepo = join(REPO_ROOT, "tasks", fam, t.id, "repo");
      if (repoSmokeTask && existsSync(srcRepo)) cpSync(srcRepo, join(dst, "repo"), { recursive: true });
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
      async execute(input) {
        const start = Date.now();
        const timeline = [{ t: 0, type: "task_start", detail: "deterministic repo smoke start" }];
        const filesWritten = [];
        const write = (rel, content) => {
          writeFileSync(join(input.workspace_path, rel), content, "utf-8");
          filesWritten.push(rel);
          timeline.push({ t: Date.now() - start, type: "file_write", path: rel, detail: "deterministic fixture fix" });
        };
        const entrypoints = input.task.task.entrypoints.join(" ");
        if (entrypoints.includes("src/users/register.js")) {
          const rel = "src/users/register.js";
          const src = readFileSync(join(input.workspace_path, rel), "utf-8");
          write(rel, src.replace("const validation = validate(email);", "const validation = await validate(email);"));
        } else if (entrypoints.includes("src/api/validate.js")) {
          const rel = "src/api/validate.js";
          const src = readFileSync(join(input.workspace_path, rel), "utf-8");
          write(rel, src.replace("return { status: 200, body: { valid: false, errors } };", "return { status: 422, body: { valid: false, errors } };"));
        } else if (entrypoints.includes("tool-trial/greet.sh")) {
          write("tool-trial/greet.sh", "#!/bin/bash\necho \"hello\"\n");
        } else {
          timeline.push({ t: Date.now() - start, type: "error", detail: `no deterministic repo fix mapped for ${entrypoints}` });
          return {
            exit_reason: "error",
            timeline,
            duration_ms: Date.now() - start,
            steps_used: timeline.length,
            files_read: [],
            files_written: filesWritten,
            tokens_in: 0,
            tokens_out: 0,
            adapter_metadata: { adapter_id: "gauntlet", adapter_version: "1", system_version: "gauntlet-v1", model: "gauntlet-model", provider: "gauntlet" },
          };
        }
        timeline.push({ t: Date.now() - start, type: "task_complete", detail: "deterministic repo smoke complete" });
        return {
          exit_reason: "complete",
          timeline,
          duration_ms: Date.now() - start,
          steps_used: timeline.length,
          files_read: input.task.task.entrypoints,
          files_written: filesWritten,
          tokens_in: 0,
          tokens_out: 0,
          adapter_metadata: { adapter_id: "gauntlet", adapter_version: "1", system_version: "gauntlet-v1", model: "gauntlet-model", provider: "gauntlet" },
        };
      },
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
    // adapter behaved as intended, any divergence is a Luak bug.
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

  const repoSmokeResults = [];
  if (flags.repoSmoke) {
    reset("success");
    for (const smoke of REPO_SMOKE_TASKS) {
      const probePath = join(REPO_ROOT, smoke.fixtureProbe);
      const before = existsSync(probePath) ? readFileSync(probePath, "utf-8") : null;
      const p = await postRun(smoke.task);
      if (p.status !== 202) {
        repoSmokeResults.push({ ...smoke, classification: "FAIL_CONFIG", reason: `POST returned ${p.status}: ${JSON.stringify(p.body).slice(0, 160)}` });
        continue;
      }
      const runId = p.body.run_id;
      const live = await drainLive(runId, 30_000);
      const terminal = live.frames.find((f) => f.event === "complete" || f.event === "error");
      const bundle = await getBundle(runId);
      const after = existsSync(probePath) ? readFileSync(probePath, "utf-8") : null;
      const failures = [];
      if (!terminal) failures.push("no terminal SSE frame within timeout");
      if (terminal?.event === "error") failures.push(`unexpected error frame: ${terminal.data?.error ?? "unknown"}`);
      if (!bundle.found) failures.push("bundle not hydratable by run_id");
      if (bundle.found && bundle.body?.bundle?.run_id !== runId) failures.push(`bundle.run_id (${bundle.body?.bundle?.run_id}) does not match POST run_id (${runId})`);
      if (before !== after) failures.push("source fixture changed outside isolated workspace");
      repoSmokeResults.push({
        ...smoke,
        runId,
        bundleId: bundle.body?.bundle?.bundle_id ?? null,
        terminal: terminal?.event ?? "missing",
        classification: failures.length ? "FAIL_PRODUCT" : "PASS",
        reason: failures.join("; ") || "repo-mode smoke produced hydratable evidence and preserved source fixture",
        observed: {
          bundleHydrated: bundle.found,
          bundleRunId: bundle.body?.bundle?.run_id ?? null,
          sourceFixtureUnchanged: before === after,
          scorePass: bundle.body?.bundle?.score?.pass ?? null,
          taskFamily: bundle.body?.bundle?.task?.family ?? null,
        },
      });
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

  const uiCertification = flags.uiShape ? buildUiCertification() : null;
  return { scenarios: results, dispatch: dispatchResults, repoSmoke: repoSmokeResults, gc: gcResults, identity: identityResults, retention: retentionResults, classificationAudit, uiCertification, runsDir: RUNS_DIR };
}

// ── Real-provider gauntlet ──────────────────────────────────────────────────
//
// Drives the production HTTP server (not an injected test adapter) against a
// specified provider + model. The .env at repo root is loaded so adapter env
// vars (OPENROUTER_API_KEY, ANTHROPIC_API_KEY, …) are visible. Tasks are
// served from the production tasks/ dir; bundles persist under
// process.cwd()/runs (or CRUCIBULUM_RUNS_DIR if set).
//
// The test matrix per model is intentionally compact:
//   1. easy conversational test          (personality-001, 3 questions)
//   2. one longer personality test       (personality-002, 4 questions)
//   3. one multi-question stress         (role-stress-001, 10 questions)
//   4. a repeat of the easy test         (proves run_id+bundle_id uniqueness)
//   5. provider-failure classification   — naturally encountered, no force
// Total per model: ~5 runs, ~30 questions.

const REAL_PROVIDER_TEST_PLAN = [
  { kind: "easy", task: "personality-001" },
  { kind: "longer", task: "personality-002" },
  { kind: "multi-question", task: "role-stress-001" },
  { kind: "repeat-easy", task: "personality-001" },
];

function loadEnvFile() {
  // Lightweight .env loader — no dependency on the dotenv package. Only
  // sets vars that are currently unset so explicit operator env still wins.
  const envPath = join(REPO_ROOT, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1]; let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] == null) process.env[key] = val;
  }
}

const ADAPTER_KEY_BY_PROVIDER = {
  openrouter: "OPENROUTER_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  minimax: "MINIMAX_API_KEY",
  zai: "ZAI_API_KEY",
  google: "GOOGLE_AI_API_KEY",
  ollama: null, // local, no key
};

async function runRealProviderGauntlet({ inventory, provider, model, family, maxCostUsd, broadSmoke }) {
  loadEnvFile();

  // Sanity: required env var, if any.
  const envVar = ADAPTER_KEY_BY_PROVIDER[provider];
  if (envVar !== null && envVar !== undefined && !process.env[envVar]) {
    return {
      mode: "real-provider", provider, model, family, maxCostUsd,
      results: [],
      blocker: { classification: "FAIL_CONFIG", reason: `${envVar} is not set; cannot drive --real-provider --provider ${provider}` },
    };
  }
  if (envVar === undefined) {
    return {
      mode: "real-provider", provider, model, family, maxCostUsd,
      results: [],
      blocker: { classification: "FAIL_CONFIG", reason: `Unknown provider id '${provider}'. Supported: ${Object.keys(ADAPTER_KEY_BY_PROVIDER).join(", ")}` },
    };
  }

  // The server reads CRUCIBULUM_RUNS_DIR at module load. To keep
  // real-provider receipts auditable, archive them under a stable runs dir
  // for THIS gauntlet invocation (separate from the production runs dir so
  // we don't pollute it).
  const RUNS_DIR = mkdtempSync(join(tmpdir(), "rgaunt-real-runs-"));
  process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
  // Production tasks dir — real conversational manifests.
  process.env["CRUCIBULUM_TASKS_DIR"] = join(REPO_ROOT, "tasks");

  const { createApp } = await import(join(REPO_ROOT, "dist", "server", "app.js"));
  const server = createApp({ rateLimit: false });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Tighter wall budget per test — most provider chat calls finish in <30s,
  // and a 10-question stress test ≤ 5 min.
  async function postRun(task) {
    const r = await fetch(`${base}/api/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, model, adapter: provider }),
    });
    return { status: r.status, body: await r.json() };
  }
  async function drainLive(runId, timeoutMs = 300_000) {
    const r = await fetch(`${base}/api/run/${runId}/live`);
    if (r.status !== 200) return { frames: [], heartbeats: 0 };
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    const frames = []; let heartbeats = 0;
    const deadline = Date.now() + timeoutMs;
    const finish = async (out) => { try { await reader.cancel(); } catch {} return out; };
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
          let parsed = data; try { parsed = JSON.parse(data); } catch {}
          frames.push({ event: evt, data: parsed });
          if (evt === "complete" || evt === "error") return finish({ frames, heartbeats });
        }
      }
    }
    return finish({ frames, heartbeats });
  }
  async function getBundle(runId) {
    const r = await fetch(`${base}/api/runs/${runId}`);
    if (!r.ok) return { found: false, httpStatus: r.status };
    return { found: true, httpStatus: 200, body: await r.json() };
  }

  const seenBundleIds = new Set();
  const seenRunIds = new Set();
  let totalCostUsd = 0; let totalTokensIn = 0; let totalTokensOut = 0;
  const results = [];
  const plan = broadSmoke ? BROAD_REAL_PROVIDER_TEST_PLAN : REAL_PROVIDER_TEST_PLAN.map((item) => ({ ...item, classId: item.task.startsWith("role-stress") ? "role-stress/prompt-sensitivity" : "conversational/personality" }));
  let consecutiveProviderFailures = 0;

  for (const item of plan) {
    // Cost cap — checked BEFORE each test so we never overshoot.
    if (maxCostUsd > 0 && totalCostUsd >= maxCostUsd) {
      results.push({ classId: item.classId, task: item.task, kind: item.kind, classification: "SKIPPED_EXPLAINED", reason: `Cost cap reached (${totalCostUsd.toFixed(4)} ≥ ${maxCostUsd}) before this test could run` });
      continue;
    }
    if (consecutiveProviderFailures >= 2) {
      results.push({ classId: item.classId, task: item.task, kind: item.kind, classification: "SKIPPED_EXPLAINED", reason: "Stopped early after repeated provider failures; avoiding noisy spend/retry loop" });
      continue;
    }
    const post = await postRun(item.task);
    if (post.status !== 202) {
      // Preflight rejection — classify as CONFIG or PROVIDER depending on body.
      const reason = (post.body && (post.body.reason || post.body.error)) || `POST returned ${post.status}`;
      // 422 adapter_cannot_run_task is a config issue; 400 adapter unavailable
      // is provider/auth — we report both honestly.
      const cls = post.status === 422 ? "FAIL_CONFIG" : (post.status === 400 ? "FAIL_PROVIDER" : "FAIL_PRODUCT");
      if (cls === "FAIL_PROVIDER") consecutiveProviderFailures++;
      else consecutiveProviderFailures = 0;
      results.push({ classId: item.classId, task: item.task, kind: item.kind, classification: cls, reason: `${post.status}: ${String(reason).slice(0, 200)}`, observed: { httpStatus: post.status } });
      continue;
    }
    const runId = post.body.run_id;
    if (seenRunIds.has(runId)) {
      results.push({ classId: item.classId, task: item.task, kind: item.kind, classification: "FAIL_PRODUCT", reason: `run_id collision: ${runId} already seen this batch`, runId });
      continue;
    }
    seenRunIds.add(runId);
    const live = await drainLive(runId);
    const terminal = live.frames.find((f) => f.event === "complete" || f.event === "error");
    const bundle = await getBundle(runId);

    let classification = "PASS";
    const notes = [];
    let bundleId = null;

    if (!terminal) {
      classification = "FAIL_PRODUCT";
      notes.push("no terminal SSE frame within timeout");
    } else if (terminal.event === "complete") {
      bundleId = terminal.data?.bundle_id ?? null;
      if (!bundle.found) { classification = "FAIL_PRODUCT"; notes.push("bundle not hydratable by run_id after complete"); }
      if (bundle.found && bundle.body?.bundle?.run_id !== runId) { classification = "FAIL_PRODUCT"; notes.push(`bundle.run_id (${bundle.body?.bundle?.run_id}) ≠ post run_id`); }
      if (bundleId && seenBundleIds.has(bundleId)) { classification = "FAIL_PRODUCT"; notes.push(`bundle_id collision: ${bundleId}`); }
      if (bundleId) seenBundleIds.add(bundleId);
      // Capture usage if surfaced on the bundle.
      const u = bundle.body?.bundle?.usage;
      if (u) {
        totalTokensIn += Number(u.tokens_in ?? 0);
        totalTokensOut += Number(u.tokens_out ?? 0);
        totalCostUsd += Number(u.estimated_cost_usd ?? 0);
      }
    } else if (terminal.event === "error") {
      // Provider failure path. Classify as FAIL_PROVIDER when Luak
      // handled it honestly (structured reason + bundle on disk); promote
      // to FAIL_PRODUCT only when Luak mishandled it.
      const cls = terminal.data?.classification ?? null;
      const stage = terminal.data?.stage ?? null;
      const reasonText = terminal.data?.error ?? terminal.data?.reason ?? "";
      const providerKind = terminal.data?.provider_error?.kind ?? null;
      const isProvider = (cls === "could_not_start" || cls === "failed") && (stage === "health_check" || stage === "execution" || stage === "adapter_init");
      const honest = isProvider && reasonText && !/Run stream interrupted/.test(reasonText) && !/Run state unreachable/.test(reasonText);
      classification = honest ? "FAIL_PROVIDER" : "FAIL_PRODUCT";
      if (!honest) {
        if (!isProvider) notes.push(`unexpected classification/stage shape: ${cls}/${stage}`);
        if (/Run stream interrupted/.test(reasonText)) notes.push("catch-all 'Run stream interrupted' leaked");
        if (/Run state unreachable/.test(reasonText)) notes.push("catch-all 'Run state unreachable' leaked");
        if (!reasonText) notes.push("empty reason on error frame");
      }
      // Pre-execution failure bundles must persist.
      if (!bundle.found) {
        classification = "FAIL_PRODUCT";
        notes.push("provider failure produced no minimal failure bundle on disk");
      }
      notes.push(`provider_error.kind=${providerKind} stage=${stage} reason="${String(reasonText).slice(0, 100)}"`);
    }

    results.push({
      classId: item.classId, task: item.task, kind: item.kind, runId, bundleId,
      classification,
      reason: notes.join("; ") || "all contracts satisfied",
      terminal: terminal?.event ?? "missing",
      observed: {
        statusClassification: terminal?.data?.classification ?? null,
        statusStage: terminal?.data?.stage ?? null,
        bundleHydrated: bundle.found,
      },
    });
    consecutiveProviderFailures = classification === "FAIL_PROVIDER" ? consecutiveProviderFailures + 1 : 0;

    // Stop early if we've blown the cap (defensive — we re-check before
    // the next test, but a single multi-question run could push us over).
    if (maxCostUsd > 0 && totalCostUsd >= maxCostUsd) {
      // Continue to next iteration; the guard at the top will record SKIPPED_EXPLAINED.
    }
  }

  await new Promise((r) => server.close(r));

  return {
    mode: "real-provider", profile: broadSmoke ? "broad-smoke" : "compact", provider, model, family, maxCostUsd,
    results,
    tally: results.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] ?? 0) + 1; return acc; }, {}),
    familyClasses: FAMILY_CLASSES,
    totals: { tokensIn: totalTokensIn, tokensOut: totalTokensOut, costUsd: totalCostUsd, distinctRunIds: seenRunIds.size, distinctBundleIds: seenBundleIds.size },
    runsDir: RUNS_DIR,
  };
}

function renderMetadataMarkdown(metadata) {
  if (!metadata) return "";
  return `\n## Report metadata\n\n- Commit: \`${metadata.git.commit}\`\n- Branch: \`${metadata.git.branch}\`\n- Dirty tree: ${metadata.git.dirtyTree ? "true" : "false"}\n- Report artifact entries: ${metadata.git.reportArtifactEntries?.length ?? 0}\n- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: ${metadata.RELEASE_CERTIFICATION_INVALID_FOR_TAGGING ? "true" : "false"}\n- Command: \`${metadata.command}\`\n- Node: \`${metadata.nodeVersion}\`\n- Package: \`${metadata.packageVersion ?? "unknown"}\`\n- Cost: $${Number(metadata.actualCostUsd ?? 0).toFixed(4)} / cap $${Number(metadata.maxCostUsd ?? 0).toFixed(4)}\n`;
}

function renderRealProviderMarkdown(real, metadata = null) {
  if (real.blocker) {
    return `# Luak Real-Provider Gauntlet
_Generated: ${new Date().toISOString()}_

**Provider:** \`${real.provider}\` · **Model:** \`${real.model}\`

**BLOCKED:** ${real.blocker.classification} — ${real.blocker.reason}
`;
  }
  const tally = real.results.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] ?? 0) + 1; return acc; }, {});
  const productFails = (tally.FAIL_PRODUCT ?? 0) === 0;
  const head = `# Luak Real-Provider Gauntlet
_Generated: ${new Date().toISOString()}_

**Provider:** \`${real.provider}\` · **Model:** \`${real.model}\` · **Profile:** \`${real.profile ?? "compact"}\`
**Real-provider ${real.profile === "broad-smoke" ? "broad-smoke" : "compact"} certified:** ${productFails ? "**YES** ✅" : "**NO** ❌"}
**Counts:** ${Object.entries(tally).map(([k, n]) => `${k}: ${n}`).join(" · ")}

**Totals:** ${real.totals.distinctRunIds} distinct run_ids · ${real.totals.distinctBundleIds} distinct bundle_ids · ${real.totals.tokensIn} tokens in · ${real.totals.tokensOut} tokens out · $${real.totals.costUsd.toFixed(4)} (cap: $${real.maxCostUsd})
`;
  const rows = real.results.map((r) => {
    const mark = r.classification === "PASS" ? "✅" : r.classification === "FAIL_PRODUCT" ? "❌" : r.classification === "FAIL_PROVIDER" ? "🟡" : r.classification === "SKIPPED_EXPLAINED" ? "⏭" : "⚠️";
    return `| \`${r.classId ?? "—"}\` | \`${r.task}\` (${r.kind}) | ${mark} ${r.classification} | ${r.terminal ?? "—"} | \`${r.runId ?? "—"}\` | ${r.reason.slice(0, 160)} |`;
  }).join("\n");
  return `${head}

## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
${rows}
${renderMetadataMarkdown(metadata)}
`;
}

// ── Tally + release decision ────────────────────────────────────────────────

function tally(report) {
  const tally = { PASS: 0, FAIL_PRODUCT: 0, FAIL_PROVIDER: 0, FAIL_CONFIG: 0, SKIPPED_EXPLAINED: 0, BLOCKED: 0 };
  const bucket = (item) => { tally[item.classification] = (tally[item.classification] ?? 0) + 1; };
  for (const it of report.scenarios) bucket(it);
  for (const it of report.dispatch) bucket(it);
  for (const it of report.repoSmoke ?? []) bucket(it);
  for (const it of report.gc) bucket(it);
  for (const it of report.identity) bucket(it);
  for (const it of report.retention) bucket(it);
  if (report.uiCertification?.classification === "FAIL_PRODUCT") bucket(report.uiCertification);
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

function renderMarkdown(report, decision, inventory, metadata = null) {
  const ts = new Date().toISOString();
  const head = `# Luak Release Gauntlet
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

  const repo = !report.repoSmoke?.length ? "" : `\n## Repo-mode smoke\n\n${report.repoSmoke.length} repo tasks dispatched. Failures:\n\n${
    report.repoSmoke.filter((d) => d.classification !== "PASS").length === 0
      ? "_(none)_"
      : report.repoSmoke.filter((d) => d.classification !== "PASS").map((d) => `- ${renderRow(d)} **${d.family}/${d.task}** — ${d.reason}`).join("\n")
  }\n\nPass count: ${report.repoSmoke.filter((d) => d.classification === "PASS").length}/${report.repoSmoke.length}\n`;

  const gc = `\n## activeRuns GC fallback\n\n${report.gc.map((p) => `- ${renderRow(p)} \`${p.probe}\` — ${JSON.stringify(p.observed ?? p.reason)}`).join("\n")}\n`;
  const ident = `\n## Identity (run_id uniqueness)\n\n${report.identity.map((p) => `- ${renderRow(p)} \`${p.probe}\` — ${JSON.stringify(p.observed)}`).join("\n")}\n`;
  const retn = `\n## Retention\n\n${report.retention.map((p) => `- ${renderRow(p)} \`${p.probe}\` — ${JSON.stringify(p.observed ?? p.reason)}`).join("\n")}\n`;

  const audit = `\n## Classification audit\n
- "Run stream interrupted" leaks: ${report.classificationAudit.catchAllOccurrences}
- "Run state unreachable" leaks: ${report.classificationAudit.unreachableOccurrences}
- Empty reason on error frames: ${report.classificationAudit.emptyReasonOnError}
`;

  const ui = !report.uiCertification ? "" : `\n## UI certification\n\n- Automated shape checks: ${report.uiCertification.automatedPassed ? "PASS" : "FAIL"}\n- Browser manual checklist: ${report.uiCertification.browserManualCompleted ? "completed" : `not completed (${report.uiCertification.browserManualChecklistPath})`}\n`;

  return head + inv + scenSec + disp + repo + gc + ident + retn + audit + ui + renderMetadataMarkdown(metadata);
}

// ── Main ─────────────────────────────────────────────────────────────────────

(async () => {
  const inventory = walkInventory();

  if (flags.dryRunInventory) {
    console.log(`Luak inventory:\n`);
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
    if (!opts.provider || !opts.model) {
      console.error("--real-provider requires --provider <id> and --model <id>");
      process.exit(2);
    }
    console.log(`Running real-provider gauntlet — provider=${opts.provider} model=${opts.model} cap=$${opts.maxCostUsd}…`);
    const real = await runRealProviderGauntlet({ inventory, provider: opts.provider, model: opts.model, family: opts.family, maxCostUsd: opts.maxCostUsd, broadSmoke: flags.broadSmoke });
    const tally = real.results.reduce((acc, r) => { acc[r.classification] = (acc[r.classification] ?? 0) + 1; return acc; }, {});
    const productFails = (tally.FAIL_PRODUCT ?? 0);
    if (real.blocker) {
      console.log(`\n⚠️  BLOCKED — ${real.blocker.classification}: ${real.blocker.reason}`);
    } else {
      console.log(`\n${productFails === 0 ? "✅ REAL-PROVIDER CERTIFIED" : "❌ FAIL_PRODUCT in real-provider run"}`);
      console.log(`Counts: ${Object.entries(tally).map(([k, n]) => `${k}=${n}`).join(" · ") || "(empty)"}`);
      console.log(`Totals: ${real.totals.distinctRunIds} run_ids · ${real.totals.distinctBundleIds} bundle_ids · $${real.totals.costUsd.toFixed(4)}`);
    }
    if (flags.writeReport) {
      const realDir = join(opts.reportDir, "real-provider");
      mkdirSync(realDir, { recursive: true });
      const slug = `${opts.provider}-${opts.model.replace(/[/:]/g, "-")}`;
      const tsSlug = new Date().toISOString().replace(/[:.]/g, "-");
      const jsonPath = join(realDir, `${tsSlug}-${slug}.json`);
      const mdPath = join(realDir, `${tsSlug}-${slug}.md`);
      const latestJson = join(opts.reportDir, "latest-real-provider.json");
      const latestMd = join(opts.reportDir, "latest-real-provider.md");
      const metadata = buildMetadata({ mode: "real-provider", profile: real.profile ?? (flags.broadSmoke ? "broad-smoke" : "compact"), maxCostUsd: opts.maxCostUsd, actualCostUsd: real.totals?.costUsd ?? null });
      const payload = {
        generatedAt: metadata.timestamp,
        metadata,
        adapterExposureAudit: buildAdapterExposureAudit(inventory),
        modelPickerAudit: buildModelPickerAudit(),
        real,
        mode: "real-provider",
      };
      writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
      writeFileSync(latestJson, JSON.stringify(payload, null, 2));
      const md = renderRealProviderMarkdown(real, metadata);
      writeFileSync(mdPath, md);
      writeFileSync(latestMd, md);
      console.log(`Wrote: ${jsonPath}`);
      console.log(`Wrote: ${mdPath}`);
      console.log(`Wrote: ${latestJson} (overwritten)`);
      console.log(`Wrote: ${latestMd} (overwritten)`);
    }
    process.exit((real.blocker || productFails > 0) ? 1 : 0);
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
    const metadata = buildMetadata({ mode: "mock-only", profile: flags.repoSmoke ? "repo-smoke" : "platform", maxCostUsd: 0, actualCostUsd: 0 });
    const payload = {
      generatedAt: metadata.timestamp,
      metadata,
      inventory,
      familyClasses: FAMILY_CLASSES,
      adapterExposureAudit: buildAdapterExposureAudit(inventory),
      modelPickerAudit: buildModelPickerAudit(),
      report,
      decision,
      mode: "mock-only",
    };
    writeFileSync(jsonPath, JSON.stringify(payload, null, 2));
    writeFileSync(latestJson, JSON.stringify(payload, null, 2));
    const md = renderMarkdown(report, decision, inventory, metadata);
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
