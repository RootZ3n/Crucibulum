/**
 * Crucible — UI clarity (operator-trust) tests
 *
 * Pins the scope/verdict/live-status/sparse-state cues added during the
 * "UI truthfulness + operator clarity" pass. The goal these tests protect:
 * an operator should, at a glance, be able to answer
 *   - what tab/lane am I on?
 *   - is this view scoped or global?
 *   - did the model fail, or did infra/test/judge fail?
 *   - are these numbers trustworthy, or provisional from a tiny sample?
 *
 * Approach: load ui/index.html's inline script in a sandboxed vm context,
 * stub window/fetch, seed state.tabData with known shapes, and assert on
 * the rendered markup. The helpers (laneScopeDescriptor, verdictOriginMeta,
 * verdictBadge) are exported so we can also unit-test them directly.
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

type Verdict = {
  completionState: "PASS" | "FAIL" | "NC";
  failureOrigin?: string | null;
  failureReasonSummary?: string;
  evidence?: { providerError?: { origin?: string; kind?: string; statusCode?: number } };
};

type LoadedUi = {
  state: {
    tabData: Record<string, {
      stats?: Record<string, unknown>;
      runs?: unknown[];
      leaderboard?: Array<{ modelId: string; sample_adequate?: boolean; totalRuns?: number }>;
      leaderboardMeta?: Record<string, unknown>;
      dataError?: Record<string, unknown> | null;
      selectedTasks?: string[];
      selectedModels?: string[];
    }>;
    focusedResult: Record<string, unknown>;
    activeTab: string;
    health?: { summary?: string; net?: { ok?: boolean | null } };
    runState?: Record<string, unknown>;
  };
  TAB_CONFIG: Record<string, { taskFamilies: string[]; label: string }>;
  laneScopeDescriptor: (tabKey: string) => {
    kind: "lane" | "global" | "settings";
    tabLabel: string;
    scopeLabel: string;
    families: string[];
    familiesLabel: string;
    sampleSize: number;
    provisional: boolean;
  };
  verdictBadge: (verdict: Verdict | null, overall: number) => {
    cls: string;
    originCls: string;
    glyph: string;
    label: string;
    state: string;
    origin: string;
    isModelFailure: boolean;
    isInfra: boolean;
    isTestOrJudgeIssue?: boolean;
    isTestOrJudge: boolean;
  };
  renderHero: () => string;
  renderDashboard: () => string;
  renderLane: (tabKey: string) => string;
  renderLiveStatus: (tabKey: string) => string;
  renderRuns: (tabKey: string) => string;
  renderLeaderboard: (tabKey: string) => string;
  renderComparisonBars: (tabKey: string, title: string, entries: Array<Record<string, unknown>>, metricKey?: string) => string;
  bootErrorMarkup: (err: unknown) => string;
};

function loadUi(): LoadedUi {
  const script = extractScript();
  const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
  const windowStub: Record<string, unknown> = { location: locationStub };
  const sandbox: Record<string, unknown> = {
    console,
    window: windowStub,
    document: { addEventListener: () => {}, body: { className: "" }, getElementById: () => null },
    navigator: { userAgent: "node-test" },
    location: locationStub,
    history: { replaceState: () => {} },
    localStorage: (() => {
      const s = new Map<string, string>();
      return {
        getItem: (k: string) => s.get(k) ?? null,
        setItem: (k: string, v: string) => { s.set(k, String(v)); },
        removeItem: (k: string) => { s.delete(k); },
      };
    })(),
    fetch: () => Promise.reject(new Error("fetch not stubbed")),
    EventSource: class {},
    setTimeout,
    clearTimeout,
    URL,
    URLSearchParams,
    Headers: class { _h = new Map<string, string>(); constructor(init?: Record<string, string>) { if (init) for (const k of Object.keys(init)) this._h.set(k.toLowerCase(), init[k]!); } has(k: string) { return this._h.has(k.toLowerCase()); } set(k: string, v: string) { this._h.set(k.toLowerCase(), v); } get(k: string) { return this._h.get(k.toLowerCase()); } },
  };
  sandbox.globalThis = sandbox;
  const prelude = "function render(){}\n";
  const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
  const exporter = "\n;globalThis.__ui={state,TAB_CONFIG,laneScopeDescriptor,verdictBadge,renderHero,renderDashboard,renderLane,renderLiveStatus,renderRuns,renderLeaderboard,renderComparisonBars,bootErrorMarkup};\n";
  const context = vm.createContext(sandbox);
  vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
  return (sandbox as { __ui: LoadedUi }).__ui;
}

// ── scope descriptor ───────────────────────────────────────────────────────

describe("laneScopeDescriptor: the single source of truth for scope labels", () => {
  it("marks the dashboard tab as GLOBAL and spells out that it aggregates every lane", () => {
    const ui = loadUi();
    const d = ui.laneScopeDescriptor("dashboard");
    assert.equal(d.kind, "global", "dashboard is the one intentional global surface");
    assert.match(d.scopeLabel, /GLOBAL/);
    assert.match(d.familiesLabel.toLowerCase(), /every configured lane|every lane/);
  });

  it("marks every lane tab as LANE with its specific task families", () => {
    const ui = loadUi();
    const build = ui.laneScopeDescriptor("build");
    assert.equal(build.kind, "lane");
    assert.match(build.scopeLabel, /LANE · BUILD/i);
    assert.deepEqual(build.families, ui.TAB_CONFIG.build!.taskFamilies);

    const safety = ui.laneScopeDescriptor("safety");
    assert.equal(safety.kind, "lane");
    assert.match(safety.scopeLabel, /LANE · SAFETY/i);

    const personality = ui.laneScopeDescriptor("personality");
    assert.equal(personality.kind, "lane");
    // personality includes identity — the familiesLabel must mention it so
    // the operator can verify the scope from the tooltip alone.
    assert.match(personality.familiesLabel, /identity/i);
  });

  it("flags a lane with sparse data as provisional", () => {
    const ui = loadUi();
    // Two runs, one leaderboard entry that hasn't crossed the sample threshold.
    ui.state.tabData = {
      build: {
        runs: [{ bundle_id: "a" }, { bundle_id: "b" }],
        leaderboard: [{ modelId: "m", sample_adequate: false, totalRuns: 2 }],
      },
    };
    const d = ui.laneScopeDescriptor("build");
    assert.equal(d.provisional, true, "<3 runs and no sample_adequate entry ⇒ provisional");
    assert.equal(d.sampleSize, 2);
  });

  it("clears provisional when at least one leaderboard entry is sample_adequate", () => {
    const ui = loadUi();
    ui.state.tabData = {
      build: {
        runs: Array.from({ length: 5 }, (_, i) => ({ bundle_id: `r${i}` })),
        leaderboard: [{ modelId: "m", sample_adequate: true, totalRuns: 5 }],
      },
    };
    const d = ui.laneScopeDescriptor("build");
    assert.equal(d.provisional, false, "adequate sample ⇒ not provisional");
  });
});

// ── verdict origin taxonomy ────────────────────────────────────────────────

describe("verdictBadge: distinct visual identity per origin", () => {
  it("distinguishes FAIL·MODEL from NC·PROVIDER — both used to look alike, now must not", () => {
    const ui = loadUi();
    const modelFail = ui.verdictBadge(
      { completionState: "FAIL", failureOrigin: "MODEL", failureReasonSummary: "low score" },
      30,
    );
    const ncProvider = ui.verdictBadge(
      { completionState: "NC", failureOrigin: "PROVIDER", failureReasonSummary: "502 bad gateway" },
      0,
    );

    assert.equal(modelFail.label, "FAIL · MODEL");
    assert.equal(ncProvider.label, "NC · PROVIDER");
    // Must NOT collapse onto the same origin-specific class.
    assert.notEqual(modelFail.originCls, ncProvider.originCls, "MODEL fail and PROVIDER NC must render with distinct origin classes");
    assert.equal(modelFail.originCls, "vx-fail-model");
    assert.equal(ncProvider.originCls, "vx-nc-provider");
    // Route flags for downstream consumers.
    assert.equal(modelFail.isModelFailure, true);
    assert.equal(ncProvider.isInfra, true);
    assert.equal(ncProvider.isModelFailure, false);
  });

  it("gives every NC origin (NETWORK / TEST / JUDGE / HARNESS / UNKNOWN) its own class and label", () => {
    const ui = loadUi();
    const cases: Array<[string, string, string]> = [
      ["NETWORK", "vx-nc-network", "NC · NETWORK"],
      ["HARNESS", "vx-nc-harness", "NC · HARNESS"],
      ["TEST",    "vx-nc-test",    "NC · TEST"],
      ["JUDGE",   "vx-nc-judge",   "NC · JUDGE"],
      ["UNKNOWN", "vx-nc-unknown", "NC · UNKNOWN"],
    ];
    const seen = new Set<string>();
    for (const [origin, expectedCls, expectedLabel] of cases) {
      const badge = ui.verdictBadge({ completionState: "NC", failureOrigin: origin }, 0);
      assert.equal(badge.originCls, expectedCls, `NC · ${origin} must use ${expectedCls}`);
      assert.equal(badge.label, expectedLabel);
      seen.add(badge.originCls);
    }
    assert.equal(seen.size, cases.length, "each NC origin must be visually distinct");
  });

  it("PASS carries a pass-specific class — never the same as any failure origin", () => {
    const ui = loadUi();
    const pass = ui.verdictBadge({ completionState: "PASS" }, 95);
    assert.equal(pass.originCls, "vx-pass");
    assert.equal(pass.state, "PASS");
    assert.equal(pass.isModelFailure, false);
  });
});

// ── hero scope chip ────────────────────────────────────────────────────────

describe("hero: scope is visible on every tab", () => {
  it("dashboard hero carries a SCOPE · GLOBAL chip and never a LANE chip", () => {
    const ui = loadUi();
    ui.state.activeTab = "dashboard";
    ui.state.tabData.dashboard = { runs: [] };
    const html = ui.renderHero();
    assert.match(html, /SCOPE · GLOBAL/);
    assert.doesNotMatch(html, /SCOPE · LANE/);
    assert.match(html, /data-scope-kind="global"/);
  });

  it("lane hero carries a SCOPE · LANE · <label> chip for the active tab", () => {
    const ui = loadUi();
    ui.state.activeTab = "safety";
    ui.state.tabData.safety = { runs: [{ bundle_id: "s1" }] };
    const html = ui.renderHero();
    assert.match(html, /SCOPE · LANE · SAFETY/i);
    assert.match(html, /data-scope-kind="lane"/);
    assert.match(html, /data-scope-tab="safety"/);
  });

  it("hero surfaces a PROVISIONAL chip when the active lane has <3 runs and none are sample-adequate", () => {
    const ui = loadUi();
    ui.state.activeTab = "build";
    ui.state.tabData.build = {
      runs: [{ bundle_id: "only-one" }],
      leaderboard: [{ modelId: "m", sample_adequate: false, totalRuns: 1 }],
    };
    const html = ui.renderHero();
    assert.match(html, /PROVISIONAL · n=1/);
  });

  it("hero does NOT show provisional when sample is adequate", () => {
    const ui = loadUi();
    ui.state.activeTab = "build";
    ui.state.tabData.build = {
      runs: Array.from({ length: 12 }, (_, i) => ({ bundle_id: `r${i}` })),
      leaderboard: [{ modelId: "m", sample_adequate: true, totalRuns: 12 }],
    };
    const html = ui.renderHero();
    assert.doesNotMatch(html, /PROVISIONAL/);
  });
});

// ── live status scope + health ─────────────────────────────────────────────

describe("live status: explicit scope + health on every render", () => {
  it("idle lane live status names the lane — not a generic 'IDLE'", () => {
    const ui = loadUi();
    ui.state.tabData.safety = { runs: [], selectedTasks: [], selectedModels: [] };
    const html = ui.renderLiveStatus("safety");
    assert.match(html, /SCOPE · LANE · SAFETY/i, "idle live panel must identify its lane");
    assert.match(html, /Safety lane idle/i);
  });

  it("dashboard idle status identifies as global", () => {
    const ui = loadUi();
    ui.state.tabData.dashboard = { runs: [], selectedTasks: [], selectedModels: [] };
    const html = ui.renderLiveStatus("dashboard");
    assert.match(html, /SCOPE · GLOBAL/i);
    assert.match(html, /Dashboard idle/i);
  });

  it("health summary chip is present so the operator sees degraded/offline state at a glance", () => {
    const ui = loadUi();
    ui.state.health = { summary: "degraded", net: { ok: false } };
    ui.state.tabData.build = { runs: [], selectedTasks: [], selectedModels: [] };
    const html = ui.renderLiveStatus("build");
    assert.match(html, /SYS · DEGRADED/i, "live status must expose overall system health");
  });
});

// ── archive: scope header + honest empty copy ──────────────────────────────

describe("archive (renderRuns): scope + origin glyphs + honest empty", () => {
  it("shows a lane-aware empty message — not a bare 'NO SIGNAL'", () => {
    const ui = loadUi();
    ui.state.tabData.safety = { runs: [], selectedTasks: [] };
    const html = ui.renderRuns("safety");
    assert.match(html, /No Safety runs in this scope yet/i);
    assert.match(html, /NO SIGNAL · LANE · SAFETY/i);
  });

  it("populated archive carries a scope header naming the lane + filtered count", () => {
    const ui = loadUi();
    const passRun = { bundle_id: "p1", task_id: "t-p", family: "orchestration", model: "m1", score: 92, pass: true, verdict: { completionState: "PASS" } };
    const modelFailRun = { bundle_id: "f1", task_id: "t-f", family: "orchestration", model: "m2", score: 18, pass: false, verdict: { completionState: "FAIL", failureOrigin: "MODEL", failureReasonSummary: "wrong answer" } };
    const ncProviderRun = { bundle_id: "n1", task_id: "t-n", family: "orchestration", model: "m3", score: 0, pass: false, verdict: { completionState: "NC", failureOrigin: "PROVIDER", failureReasonSummary: "502 upstream" } };
    ui.state.tabData.build = { runs: [passRun, modelFailRun, ncProviderRun] };
    const html = ui.renderRuns("build");
    assert.match(html, /SCOPE · LANE · BUILD/i, "archive scope header must identify the lane");
    assert.match(html, /3 of 3 run/i, "archive scope header must show filtered-of-total counts");
  });

  it("archive rows visibly distinguish MODEL fail from PROVIDER NC via origin classes", () => {
    const ui = loadUi();
    const modelFailRun = { bundle_id: "f1", task_id: "t-f", family: "orchestration", model: "m-model-fail", score: 18, pass: false, verdict: { completionState: "FAIL", failureOrigin: "MODEL", failureReasonSummary: "wrong answer" } };
    const ncProviderRun = { bundle_id: "n1", task_id: "t-n", family: "orchestration", model: "m-nc-provider", score: 0, pass: false, verdict: { completionState: "NC", failureOrigin: "PROVIDER", failureReasonSummary: "502 upstream" } };
    ui.state.tabData.build = { runs: [modelFailRun, ncProviderRun] };
    const html = ui.renderRuns("build");
    // Each row must receive its origin-specific class so CSS can tint it.
    assert.match(html, /run-strip [^"]*vx-fail-model/);
    assert.match(html, /run-strip [^"]*vx-nc-provider/);
    // Badges must be labelled with the origin, not a generic "FAIL"/"NC".
    assert.match(html, /FAIL · MODEL/);
    assert.match(html, /NC · PROVIDER/);
  });

  it("archive rows label ineligible local evidence as not ranked", () => {
    const ui = loadUi();
    const legacyRun = {
      bundle_id: "legacy1",
      task_id: "t-legacy",
      family: "orchestration",
      model: "old-local",
      score: 90,
      pass: true,
      verdict: { completionState: "PASS" },
      trust: { bundle_verified: false, bundle_authenticated: false, bundle_signature_status: "legacy_unverified" },
    };
    const eligibleRun = {
      bundle_id: "eligible1",
      task_id: "t-good",
      family: "orchestration",
      model: "signed-local",
      score: 91,
      pass: true,
      verdict: { completionState: "PASS" },
      trust: { bundle_verified: true, bundle_authenticated: true, bundle_signature_status: "valid" },
    };
    ui.state.tabData.build = { runs: [legacyRun, eligibleRun] };
    const html = ui.renderRuns("build");
    assert.match(html, /LEGACY · UNVERIFIED · NOT RANKED/);
    assert.match(html, /ELIGIBLE FOR PUBLIC RANKING/);
    assert.doesNotMatch(html, /class="tag teal">BEST/);
    assert.doesNotMatch(html, />TOP</);
  });
});

// ── leaderboard: provisional banner + BEST suppression ─────────────────────

describe("leaderboard: provisional warning, BEST suppressed on tiny N", () => {
  it("emits a PROVISIONAL banner when the scope is sparse", () => {
    const ui = loadUi();
    ui.state.tabData.build = {
      runs: [{ bundle_id: "r1" }],
      leaderboard: [{ modelId: "only-one", sample_adequate: false, totalRuns: 1 }],
    };
    const html = ui.renderComparisonBars("build", "Build Leaderboard", [
      { model: "only-one", avgOverall: 92, passRate: 100, runs: 1, costAvg: 0, durationAvg: 0 },
    ], "avgOverall");
    assert.match(html, /PROVISIONAL/);
    assert.match(html, /run in scope/);
    // BEST badge must NOT be crowned on n=1.
    assert.doesNotMatch(html, /class="tag teal">BEST/);
    // And a 'TOP · n=1' dim tag replaces it so the rank is still visible.
    assert.match(html, /TOP · n=1/);
  });

  it("crowns BEST only when the leading row has >=3 runs AND the scope is not provisional", () => {
    const ui = loadUi();
    ui.state.tabData.build = {
      runs: Array.from({ length: 8 }, (_, i) => ({ bundle_id: `r${i}` })),
      leaderboard: [{ modelId: "winner", sample_adequate: true, totalRuns: 8 }],
    };
    const html = ui.renderComparisonBars("build", "Build Leaderboard", [
      { model: "winner", avgOverall: 94, passRate: 100, runs: 8, costAvg: 0, durationAvg: 0 },
      { model: "runner-up", avgOverall: 70, passRate: 80, runs: 6, costAvg: 0, durationAvg: 0 },
    ], "avgOverall");
    assert.match(html, /class="tag teal">BEST/);
    assert.doesNotMatch(html, /PROVISIONAL/);
  });

  it("an empty lane leaderboard renders a lane-aware 'no evaluable runs' copy", () => {
    const ui = loadUi();
    ui.state.tabData.memory = { runs: [], leaderboard: [], leaderboardMeta: { ranking_mode: "public_verified", eligible_count: 0, quarantined_count: 2 } };
    const html = ui.renderComparisonBars("memory", "Memory Leaderboard", [], "avgOverall");
    assert.match(html, /SCOPE · LANE · MEMORY/i);
    assert.match(html, /No verified eligible memory runs are available/i);
    assert.match(html, /2 runs are quarantined/i);
    assert.doesNotMatch(html, /class="tag teal">BEST/);
  });

  it("leaderboard quarantine panel shows reason buckets without ranking badges", () => {
    const ui = loadUi();
    ui.state.tabData.safety = {
      runs: [],
      leaderboard: [],
      leaderboardMeta: {
        ranking_mode: "public_verified",
        eligible_count: 0,
        quarantined_count: 3,
        malformed_count_unknown_scope: 1,
        reason_buckets: { legacy_unverified: 1, mock_or_demo: 1, malformed: 1 },
      },
    };
    const html = ui.renderComparisonBars("safety", "Safety Leaderboard", [{ model: "verified", runs: 3, avgOverall: 88, passRate: 100 }], "avgOverall");
    assert.match(html, /NOT RANKED/);
    assert.match(html, /LEGACY UNVERIFIED 1/);
    assert.match(html, /MOCK OR DEMO 1/);
    assert.match(html, /MALFORMED 1/);
    assert.doesNotMatch(html, /MOCK\/DEMO[^<]*BEST/);
  });

  it("legacy compact leaderboard does not crown BEST for ineligible or undersampled rows", () => {
    const ui = loadUi();
    ui.state.tabData.safety = {
      runs: [],
      leaderboard: [
        { modelId: "demo-model", sample_adequate: false, totalRuns: 9 },
      ],
      leaderboardMeta: { ranking_mode: "public_verified", eligible_count: 0, quarantined_count: 1 },
    };
    const html = ui.renderLeaderboard("safety");
    assert.doesNotMatch(html, /class="tag teal">BEST/);
    assert.match(html, /TOP · NOT VERIFIED/);
  });

  it("rate-limited leaderboard state is a soft incomplete-data message, not BOOT FAILURE", () => {
    const ui = loadUi();
    ui.state.tabData.benchmark = {
      runs: [],
      leaderboard: [],
      leaderboardMeta: { ranking_mode: "public_verified", eligible_count: 0, quarantined_count: 0, rankings_incomplete: true },
      dataError: { kind: "rate_limited", status: 429, message: "RATE_LIMITED" },
    };
    const html = ui.renderComparisonBars("benchmark", "Benchmark Leaderboard", [], "avgOverall");
    assert.match(html, /RANKINGS INCOMPLETE/i);
    assert.match(html, /RATE-LIMITED/i);
    assert.match(html, /Wait a moment/i);
    assert.doesNotMatch(html, /BOOT FAILURE/i);
  });

  it("boot rate limit renders STARTUP LIMITED with retry guidance", () => {
    const ui = loadUi();
    const err = Object.assign(new Error("RATE_LIMITED"), { status: 429 });
    const html = ui.bootErrorMarkup(err);
    assert.match(html, /STARTUP LIMITED/);
    assert.match(html, /RATE_LIMITED/);
    assert.match(html, /RETRY LOAD/);
    assert.doesNotMatch(html, /BOOT FAILURE/);
  });
});

describe("offline-first UI shell", () => {
  it("does not depend on remote Google Fonts", () => {
    assert.doesNotMatch(uiHtml, /fonts\.googleapis|fonts\.gstatic|Space Grotesk|DM Mono/);
  });

  it("dashboard vitals do not label local historical data as LAB SCORE", () => {
    const ui = loadUi();
    ui.state.activeTab = "dashboard";
    ui.state.tabData.dashboard = {
      runs: [{ bundle_id: "local", model: "local historical model", score: 91, pass: true }],
      leaderboard: [],
      leaderboardMeta: { ranking_mode: "public_verified", eligible_count: 0, quarantined_count: 1 },
    };
    const html = ui.renderDashboard();
    assert.doesNotMatch(html, /LAB SCORE/);
    assert.match(html, /OBSERVED SCORE|PUBLIC SCORE/);
  });
});

// ── dashboard global scope banner ──────────────────────────────────────────

describe("dashboard identifies itself as the one global surface", () => {
  it("renderDashboard emits a SCOPE · GLOBAL banner and a 'Current Run (All Lanes)' heading", () => {
    const ui = loadUi();
    ui.state.activeTab = "dashboard";
    ui.state.tabData.dashboard = { runs: [], selectedTasks: [], selectedModels: [] };
    const html = ui.renderDashboard();
    assert.match(html, /SCOPE · GLOBAL/);
    assert.match(html, /All Lanes/);
    assert.match(html, /data-scope-kind="global"/);
  });
});

// ── end-to-end: lane banner on renderLane ──────────────────────────────────

describe("lane: renderLane surfaces scope + provisional state up top", () => {
  it("renderLane emits a scope banner and a 'MISSION CONTROL · LANE-SCOPED' live header", () => {
    const ui = loadUi();
    ui.state.tabData.build = {
      runs: [{ bundle_id: "r1" }],
      leaderboard: [{ modelId: "m", sample_adequate: false, totalRuns: 1 }],
      selectedTasks: [],
      selectedModels: [],
      stats: { total_runs: 1, pass_rate: 100, avg_score: 91, model_failure_rate: 0, nc_rate: 0, infra_issue_rate: 0 },
    };
    const html = ui.renderLane("build");
    assert.match(html, /SCOPE · LANE · BUILD/i);
    assert.match(html, /MISSION CONTROL · LANE-SCOPED/i);
    assert.match(html, /Live Run Panel \(Build\)/i);
    // And because only one run is in scope, the provisional chip must ride
    // along with the scope banner — not hidden in a sub-panel.
    assert.match(html, /PROVISIONAL · n=1/);
    // Rail also surfaces runs-in-scope explicitly.
    assert.match(html, /RUNS IN SCOPE/i);
  });
});
