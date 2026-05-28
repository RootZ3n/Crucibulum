/**
 * UI HEALTH / RATE-LIMIT REGRESSION — pins the 2026-05-24 broad browser
 * sweep finding where /api/health returned 429 (Luak's own RATE_READ),
 * the UI silently flipped to "offline", every cloud preset was marked
 * `down`, and `gateSelectedModels()` blocked dispatch with NO operator-
 * visible signal. The remaining lanes silently no-op'd.
 *
 * Pins:
 *   1. /api/health 429 does NOT permanently mark cloud providers offline —
 *      while a recent last-known-good snapshot exists, cloud dispatch
 *      remains allowed.
 *   2. The "fresh last-known-good" window is bounded; outside the window
 *      health degrades to `unknown` (NOT `false`) with an explicit reason.
 *   3. Rate-limited health is visible in the operator UI — `state.health
 *      .summary === 'rate_limited'`, `state.health.net.error` cites
 *      "rate-limited" and the SYS chip renders the `RATE-LIMITED · LKG`
 *      label.
 *   4. Run attempted while rate-limited + fresh LKG is allowed (gate
 *      returns the full model list, gate records `allowed`).
 *   5. Run attempted while rate-limited + stale LKG is BLOCKED with a
 *      structured reason (gate records `blocked_no_prompt` / records a
 *      reason string mentioning "rate-limited" + "stale").
 *   6. Multiple back-to-back runHealthChecks() calls inside
 *      HEALTH_MIN_INTERVAL_MS dedupe into a single /api/health fetch.
 *   7. While inside the Retry-After window, runHealthChecks() skips the
 *      fetch entirely.
 *   8. Source pin: `gateSelectedModels` and `handleRun`/`handleRunAll`
 *      surface a blocked dispatch via `state.lastDispatchGate` and the
 *      lane activity feed — they never return silently with no record.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const UI_PATH = join(process.cwd(), "ui", "index.html");
const uiHtml = readFileSync(UI_PATH, "utf-8");

function extractScript(): string {
  const match = uiHtml.match(/^<script>\n([\s\S]*?)\n<\/script>/m);
  assert.ok(match, "ui/index.html must contain a real <script> block");
  return match![1]!.replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "");
}

interface HealthUi {
  state: {
    health: {
      net: { ok: boolean | null; lastCheckedAt: number; error: string | null; latencyMs: number; rateLimited: boolean };
      providers: Record<string, { status: string; reason: string | null; kind: string; lastTestedAt: number }>;
      summary: string;
      checking: boolean;
      lastSummaryAt: number;
      lastSuccessAt: number;
      lastSuccessProviders: Record<string, unknown> | null;
      lastRequestAt: number;
      rateLimit: { until: number; retryAfterSec: number; lastHit: number } | null;
    };
    registry: { presets: unknown[]; providers: unknown[]; models: unknown[]; catalog: unknown[] };
    adapters: { id: string; label: string }[];
    liveModels: unknown[];
    tabData: Record<string, unknown>;
    runState: Record<string, { lines?: string[]; events?: unknown[]; status?: string }>;
    lastDispatchGate: { result: string; blocked: { modelId: string; reason: string }[]; selectedModels: string[] } | null;
  };
  runHealthChecks: (opts?: { force?: boolean }) => Promise<void>;
  computeHealthSummary: () => string;
  canRunModel: (modelId: string) => boolean;
  blockedRunReasons: (modelIds: string[]) => { modelId: string; reason: string; kind: string }[];
  gateSelectedModels: (modelIds: string[]) => string[] | null;
  surfaceBlockedDispatch: (tabKey: string, label: string) => void;
  healthLastKnownGoodFresh: (now: number) => boolean;
  healthIsRateLimited: (now: number) => boolean;
  HEALTH_MIN_INTERVAL_MS: number;
  HEALTH_LAST_KNOWN_TTL_MS: number;
  defaultTabState: () => unknown;
  TAB_CONFIG: Record<string, unknown>;
  __setFetch: (fn: (url: string, init?: RequestInit) => Promise<unknown>) => void;
  __callsByPath: () => Record<string, number>;
  __resetCalls: () => void;
}

function loadUi(): HealthUi {
  const script = extractScript();
  const callCounts: Record<string, number> = {};
  let fetchImpl: (url: string, init?: RequestInit) => Promise<unknown> = async (url: string) => {
    const parsed = new URL(String(url), "http://localhost");
    callCounts[parsed.pathname] = (callCounts[parsed.pathname] ?? 0) + 1;
    return { ok: true, status: 200, json: async () => ({}), text: async () => "{}", clone() { return this; }, headers: { get: () => null } };
  };
  const wrappedFetch = async (url: string, init?: RequestInit) => fetchImpl(url, init);
  const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
  const windowStub: Record<string, unknown> = { location: locationStub, addEventListener: () => {} };
  const sandbox: Record<string, unknown> = {
    console,
    window: windowStub,
    document: { addEventListener: () => {}, body: { className: "" }, getElementById: () => null, hidden: false },
    navigator: { userAgent: "node-test", onLine: true },
    location: locationStub,
    history: { replaceState: () => {} },
    localStorage: (() => { const s = new Map<string, string>(); return { getItem: (k: string) => s.get(k) ?? null, setItem: (k: string, v: string) => { s.set(k, String(v)); }, removeItem: (k: string) => { s.delete(k); } }; })(),
    fetch: wrappedFetch,
    EventSource: class {},
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {}, URL, URLSearchParams,
    AbortController: class { signal = {}; abort() {} },
  };
  sandbox.globalThis = sandbox;
  const prelude = "function render(){}\n";
  const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
  const exporter = `;globalThis.__ui={
    state, runHealthChecks, computeHealthSummary, canRunModel, blockedRunReasons,
    gateSelectedModels, surfaceBlockedDispatch, healthLastKnownGoodFresh, healthIsRateLimited,
    HEALTH_MIN_INTERVAL_MS, HEALTH_LAST_KNOWN_TTL_MS, defaultTabState, TAB_CONFIG,
    __setFetch:(fn)=>{globalThis.fetch=fn},
    __callsByPath:()=>(globalThis.__callCounts||{}),
    __resetCalls:()=>{globalThis.__callCounts={}}
  };`;
  const context = vm.createContext(sandbox);
  vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
  const ui = (sandbox as { __ui: HealthUi }).__ui;
  ui.__setFetch = (fn) => {
    fetchImpl = async (url: string, init?: RequestInit) => {
      const parsed = new URL(String(url), "http://localhost");
      callCounts[parsed.pathname] = (callCounts[parsed.pathname] ?? 0) + 1;
      return fn(url, init);
    };
  };
  ui.__callsByPath = () => ({ ...callCounts });
  ui.__resetCalls = () => { for (const k of Object.keys(callCounts)) delete callCounts[k]; };
  ui.state.registry = JSON.parse(JSON.stringify(SEED_REGISTRY));
  ui.state.adapters = [{ id: "openrouter", label: "OpenRouter" }, { id: "ollama", label: "Ollama" }];
  ui.state.liveModels = [];
  for (const key of Object.keys(ui.TAB_CONFIG)) ui.state.tabData[key] = ui.defaultTabState();
  return ui;
}

function makeHealthProbeCounter(ui: HealthUi) {
  let probes = 0;
  let responder: () => unknown = () => ok200();
  ui.__setFetch(async (url: string) => {
    const parsed = new URL(String(url), "http://localhost");
    if (parsed.pathname === "/api/health") probes++;
    return responder();
  });
  return {
    get value() { return probes; },
    reset() { probes = 0; },
    setResponder(fn: () => unknown) { responder = fn; },
  };
}

function ok200(body: Record<string, unknown> = {}) {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; }, headers: { get: () => null } };
}

function rateLimited429(opts: { retryAfterHeader?: string | null; retryAfterBodySec?: number } = {}) {
  const body = { error: "rate_limited", rule: "read", retry_after_sec: opts.retryAfterBodySec ?? 5 };
  return {
    ok: false,
    status: 429,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
    headers: { get: (name: string) => name.toLowerCase() === "retry-after" ? (opts.retryAfterHeader ?? null) : null },
  };
}

function err500() {
  return { ok: false, status: 500, json: async () => ({}), text: async () => "{}", clone() { return this; }, headers: { get: () => null } };
}

const SEED_REGISTRY = {
  presets: [],
  providers: [{ id: "p1", presetId: "openrouter", enabled: true, lastTestedOk: true, lastTestedAt: Date.now() }],
  models: [],
  catalog: [{
    providerConfigId: "p1",
    providerLabel: "OpenRouter",
    presetId: "openrouter",
    presetLabel: "OpenRouter",
    adapter: "openrouter",
    kind: "cloud",
    modelEntryId: "m1",
    modelId: "deepseek/deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    enabled: true,
    providerEnabled: true,
  }],
};

function seededOk200(url: string) {
  const parsed = new URL(String(url), "http://localhost");
  if (parsed.pathname === "/api/registry/state") return ok200(SEED_REGISTRY);
  return ok200();
}

async function primeLastKnownGood(ui: HealthUi) {
  ui.__setFetch(async (url: string) => seededOk200(url));
  await ui.runHealthChecks({ force: true });
  assert.equal(ui.state.health.net.ok, true);
  assert.ok(ui.state.health.lastSuccessAt > 0, "lastSuccessAt must be recorded after successful probe");
}

describe("ui /api/health rate-limit + stale-offline regression", () => {
  it("1. /api/health 429 with fresh LKG does NOT mark cloud providers offline", async () => {
    const ui = loadUi();
    await primeLastKnownGood(ui);
    // Force-flip to 429 immediately. With a fresh LKG snapshot, net.ok must
    // stay truthy so cloud dispatch keeps working — anything else is the
    // regression this test pins.
    ui.__setFetch(async () => rateLimited429({ retryAfterBodySec: 5 }));
    await ui.runHealthChecks({ force: true });
    assert.equal(ui.state.health.net.rateLimited, true, "net.rateLimited must flip true on 429");
    assert.equal(ui.state.health.net.ok, true, "net.ok must remain true when LKG is fresh");
    assert.equal(ui.state.health.summary, "rate_limited", "summary must be 'rate_limited', not 'offline'");
    // canRunModel for a configured cloud preset must still return true.
    ui.state.health.providers = { openrouter: { status: "ok", reason: null, kind: "cloud", lastTestedAt: Date.now() } };
    assert.equal(ui.canRunModel("openrouter/some-model"), true, "cloud dispatch must remain allowed when LKG is fresh");
  });

  it("2. /api/health 429 with STALE LKG degrades to unknown, not false", async () => {
    const ui = loadUi();
    await primeLastKnownGood(ui);
    // Backdate lastSuccessAt to outside the TTL window.
    ui.state.health.lastSuccessAt = Date.now() - (ui.HEALTH_LAST_KNOWN_TTL_MS + 1000);
    ui.__setFetch(async () => rateLimited429({ retryAfterBodySec: 7 }));
    await ui.runHealthChecks({ force: true });
    assert.equal(ui.state.health.net.rateLimited, true);
    assert.equal(ui.state.health.net.ok, null, "stale LKG must degrade net.ok to null (unknown), NOT false");
    assert.match(String(ui.state.health.net.error || ""), /rate-limited/i);
  });

  it("3. rate-limited health is visible — summary + chip-rendering surface it", async () => {
    const ui = loadUi();
    await primeLastKnownGood(ui);
    ui.__setFetch(async () => rateLimited429({ retryAfterBodySec: 6 }));
    await ui.runHealthChecks({ force: true });
    assert.equal(ui.state.health.summary, "rate_limited");
    assert.match(String(ui.state.health.net.error || ""), /rate-limited/i);
    assert.match(uiHtml, /RATE-LIMITED · LKG/, "ui/index.html must render the 'RATE-LIMITED · LKG' chip label");
  });

  it("4. run while rate-limited + fresh LKG is ALLOWED with structured gate record", async () => {
    const ui = loadUi();
    await primeLastKnownGood(ui);
    ui.__setFetch(async () => rateLimited429({ retryAfterBodySec: 5 }));
    await ui.runHealthChecks({ force: true });
    ui.state.health.providers = { openrouter: { status: "ok", reason: null, kind: "cloud", lastTestedAt: Date.now() } };
    const result = ui.gateSelectedModels(["deepseek/deepseek-v4-pro"]);
    assert.deepEqual(result, ["deepseek/deepseek-v4-pro"], "fresh LKG + rate-limited must NOT block dispatch");
    assert.equal(ui.state.lastDispatchGate?.result, "allowed");
  });

  it("5. run while rate-limited + STALE LKG is BLOCKED with explicit reason — never silent", async () => {
    const ui = loadUi();
    await primeLastKnownGood(ui);
    ui.state.health.lastSuccessAt = Date.now() - (ui.HEALTH_LAST_KNOWN_TTL_MS + 1000);
    ui.__setFetch(async () => rateLimited429({ retryAfterBodySec: 5 }));
    await ui.runHealthChecks({ force: true });
    // After 429 with stale LKG, net.ok must be null (unknown) so the gate
    // refuses to dispatch — preserving providers from the test would still
    // satisfy aggregateProviderHealth, but the canRunModel cloud check
    // explicitly requires net.ok === true (or rateLimited + fresh LKG).
    ui.state.health.providers = { openrouter: { status: "ok", reason: null, kind: "cloud", lastTestedAt: Date.now() } };
    assert.equal(ui.state.health.net.ok, null, `precondition: net.ok must be null after 429+stale, got ${ui.state.health.net.ok}`);
    assert.equal(ui.canRunModel("deepseek/deepseek-v4-pro"), false, `canRunModel must refuse stale+rate-limited cloud; net=${JSON.stringify(ui.state.health.net)}, lastSuccessAt=${ui.state.health.lastSuccessAt}`);
    const result = ui.gateSelectedModels(["deepseek/deepseek-v4-pro"]);
    assert.equal(result, null, `stale LKG + rate-limited must block dispatch; gate=${JSON.stringify(ui.state.lastDispatchGate)}`);
    const gate = ui.state.lastDispatchGate;
    assert.ok(gate, "gate record must be present — silent no-op is the regression");
    assert.ok(/blocked|partial/.test(gate.result), `gate.result must record block-shape, got ${gate.result}`);
    const reasons = (gate.blocked || []).map((b) => b.reason).join(" | ");
    assert.match(reasons, /rate-limited/i, `block reason must cite rate-limited: ${reasons}`);
    assert.match(reasons, /stale/i, `block reason must mention stale baseline: ${reasons}`);
  });

  it("6. back-to-back runHealthChecks within HEALTH_MIN_INTERVAL_MS dedupe to ONE fetch", async () => {
    const ui = loadUi();
    const probes = makeHealthProbeCounter(ui);
    await ui.runHealthChecks({ force: true }); // primes
    probes.reset();
    // Non-forced calls inside the throttle window must dedupe.
    await ui.runHealthChecks();
    await ui.runHealthChecks();
    await ui.runHealthChecks();
    assert.equal(probes.value, 0, "throttle must collapse bursts; expected zero new probes inside HEALTH_MIN_INTERVAL_MS window");
  });

  it("7. Retry-After window suppresses non-forced /api/health requests", async () => {
    const ui = loadUi();
    await primeLastKnownGood(ui);
    const probes = makeHealthProbeCounter(ui);
    probes.setResponder(() => rateLimited429({ retryAfterBodySec: 30 }));
    await ui.runHealthChecks({ force: true });
    assert.equal(probes.value, 1, "force should issue exactly one probe");
    // Within the Retry-After window, a non-forced call must skip the fetch.
    probes.reset();
    // Reset throttle so it's the retry-after gate (not the min-interval gate)
    // that we're asserting here.
    ui.state.health.lastRequestAt = 0;
    await ui.runHealthChecks();
    assert.equal(probes.value, 0, "Retry-After must block non-forced refresh until window expires");
  });

  it("8. source pin — no silent no-op branch in gate/handleRun path", () => {
    // The previously-broken behavior was `handleRun(...) → gate returns null → return;`
    // with no visible side-effect. The fix MUST route through
    // surfaceBlockedDispatch and populate state.lastDispatchGate.
    assert.match(uiHtml, /surfaceBlockedDispatch\(tabKey,label\)/, "handleRun must call surfaceBlockedDispatch on block");
    assert.match(uiHtml, /surfaceBlockedDispatch\(tabKey,'Lane batch run'\)/, "handleRunAll must call surfaceBlockedDispatch on block");
    assert.match(uiHtml, /state\.lastDispatchGate=\{result:'allowed'/, "gate must record 'allowed' decisions");
    assert.match(uiHtml, /'blocked_no_prompt'/, "gate must record 'blocked_no_prompt' decisions");
  });

  it("9. surfaceBlockedDispatch writes a visible activity-feed entry", () => {
    const ui = loadUi();
    ui.state.lastDispatchGate = {
      result: "blocked_no_prompt",
      blocked: [{ modelId: "openrouter/foo", reason: "Health check rate-limited and last-known-good is stale — cannot confirm provider availability" }],
      selectedModels: ["openrouter/foo"],
    };
    ui.surfaceBlockedDispatch("benchmark", "Run all 1 selected");
    const run = ui.state.runState.benchmark;
    assert.ok(run, "runState entry must exist for blocked dispatch");
    const lines = run?.lines || [];
    assert.ok(lines.some((l) => /Dispatch blocked/.test(l) && /rate-limited/i.test(l)), `activity feed must explain the block: ${JSON.stringify(lines)}`);
  });
});
