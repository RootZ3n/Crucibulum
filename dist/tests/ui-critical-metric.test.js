/**
 * Crucible — Critical Failure Rate banner guards
 *
 * Pins the product-integrity fix where the top-level strip was showing an
 * ambiguous "CRITICAL 15%" that fused a verdict-band word with an unrelated
 * overall-score percentage. The banner is now an honest metric:
 *
 *   CRITICAL_FAILURE_RATE =
 *     (# runs in scope with resolved score < 55) / (# runs in scope with resolved score)
 *
 * These tests cover:
 *   1. Label — the strip is explicitly labeled "CRITICAL FAILURE RATE", not
 *      a bare "CRITICAL" verdict.
 *   2. Derivation — the rate is computed from real bundle scores, not a
 *      placeholder.
 *   3. Empty state — no scored runs yields an honest neutral banner with
 *      "—" and an explanatory hint, not a fake 0%.
 *   4. Zero state — a clean 0% renders as the PASS band with a CLEAN hint
 *      so it's intentional, not absent.
 *   5. Non-zero state — real failed runs produce the correct numerator and
 *      denominator.
 *   6. Refresh — updating state.tabData with new runs yields a new rate
 *      immediately (no stale cache).
 *   7. Scope — dashboard pulls from every lane; per-tab pulls only from that
 *      tab's runs.
 *   8. Evidence link — the banner is a button pointing at the
 *      #crit-evidence-anchor so users can jump to contributing runs, and
 *      the archive panels carry that id on both dashboard and lane views.
 *
 * The tests load the UI's inline <script> into a vm sandbox (same harness
 * as ui-benchmark-bindings.test.ts) and exercise the real functions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
const UI_PATH = join(process.cwd(), "ui", "index.html");
const uiHtml = readFileSync(UI_PATH, "utf-8");
function extractScript() {
    const match = uiHtml.match(/^<script>\n([\s\S]*?)\n<\/script>/m);
    assert.ok(match, "ui/index.html must contain a real <script> block");
    let src = match[1];
    src = src.replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "");
    return src;
}
function loadUi() {
    const script = extractScript();
    const sandbox = {
        console,
        window: {},
        document: { addEventListener: () => { }, body: { className: "" }, getElementById: () => null },
        navigator: { userAgent: "node-test" },
        location: { pathname: "/", hash: "", search: "" },
        history: { replaceState: () => { } },
        localStorage: (() => {
            const s = new Map();
            return {
                getItem: (k) => s.get(k) ?? null,
                setItem: (k, v) => { s.set(k, String(v)); },
                removeItem: (k) => { s.delete(k); },
            };
        })(),
        fetch: () => Promise.reject(new Error("fetch is not stubbed in this test")),
        EventSource: class {
        },
        setTimeout,
        clearTimeout,
        URL,
        URLSearchParams,
        Headers: class {
            _h = new Map();
            constructor(init) { if (init)
                for (const k of Object.keys(init))
                    this._h.set(k.toLowerCase(), init[k]); }
            has(k) { return this._h.has(k.toLowerCase()); }
            set(k, v) { this._h.set(k.toLowerCase(), v); }
            get(k) { return this._h.get(k.toLowerCase()); }
        },
    };
    sandbox.globalThis = sandbox;
    const prelude = `function render(){}\nasync function runBatch(){}\n`;
    const neutralized = script
        .replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n")
        .replace(/async function runBatch\(tabKey,taskIds,modelIds,label\)\{[\s\S]*?\n\}\n/, "/* runBatch stubbed */\n");
    const exporter = `
;globalThis.__ui={
  CRITICAL_THRESHOLD,
  criticalFailureStats,
  renderCriticalBanner,
  renderVerdictBanner,
  state,
  allRuns,
  normalizeRunForDisplay
};
`;
    const context = vm.createContext(sandbox);
    vm.runInContext(prelude + neutralized + exporter, context, { filename: "ui/index.html::script" });
    const ui = sandbox.__ui;
    assert.ok(ui, "UI script must expose test hooks");
    return ui;
}
/** Helper: a minimal run bundle that normalizeRunForDisplay will accept. */
function run(score, opts = {}) {
    const base = {
        bundle_id: `b_${Math.random().toString(36).slice(2, 8)}`,
        task_id: "t",
        model: "m",
        provider: "p",
        pass: score !== null && score >= 80,
        timestamp: "2026-04-15T00:00:00Z",
        ...opts,
    };
    if (score !== null)
        base["score"] = score;
    return base;
}
describe("critical failure rate: metric definition and label", () => {
    it("banner label says 'CRITICAL FAILURE RATE' — never just 'CRITICAL'", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        ui.state.tabData["personality"] = { runs: [run(30)] };
        const html = ui.renderCriticalBanner();
        assert.match(html, /CRITICAL FAILURE RATE/, "banner must spell out the full metric name");
        // The old "CRITICAL / UNSTABLE / NOMINAL" verdict words must not appear
        // as the featured ss-mid text — those fused a band label with a score.
        assert.doesNotMatch(html, /class="ss-mid">(CRITICAL|UNSTABLE|NOMINAL)</, "regression: the ss-mid slot must not revert to a bare verdict word");
    });
    it("exposes CRITICAL_THRESHOLD = 55 as the single source of truth", () => {
        const ui = loadUi();
        assert.equal(ui.CRITICAL_THRESHOLD, 55, "threshold must match the UI's existing red-band cutoff");
    });
    it("banner is a <button> with an explanatory aria-label and jump handler", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        ui.state.tabData["personality"] = { runs: [run(30), run(90)] };
        const html = ui.renderCriticalBanner();
        assert.match(html, /<button[^>]+class="status-strip/, "banner must be a button so it is keyboard-reachable");
        assert.match(html, /aria-label="[^"]*Critical Failure Rate[^"]*"/i, "aria-label must describe the metric");
        assert.match(html, /onclick="jumpToCriticalEvidence\(\)"/, "button must wire to the evidence-jump handler");
    });
});
describe("critical failure rate: empty / pending states are honest", () => {
    it("no runs anywhere → neutral banner with '—' and 'NO RUNS' hint (not a fake 0%)", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        // Make every lane genuinely empty.
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.total, 0);
        assert.equal(s.rate, null, "rate must be null (not 0) when there is nothing to measure");
        const html = ui.renderCriticalBanner();
        assert.match(html, /class="status-strip neutral"/, "empty state must use the neutral band, not pass/warn/fail");
        assert.match(html, /disabled/, "button must be disabled when there is nothing to jump to");
        assert.match(html, /class="ss-score">—</, "score cell must show '—' instead of '0%' when unmeasured");
        assert.match(html, /NO RUNS IN/, "hint must tell the user why the metric is absent");
    });
    it("runs present but none scored → neutral banner, PENDING hint, not a fake 0%", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        // Two runs without any resolvable score field. normalizeRunForDisplay
        // will mark overallKnown=false, so they must NOT count toward either
        // the numerator or the denominator.
        ui.state.tabData["personality"] = { runs: [run(null), run(null)] };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.total, 0, "unscored runs must not inflate the denominator");
        assert.equal(s.rawTotal, 2);
        assert.equal(s.pending, 2, "pending must count unresolved runs");
        const html = ui.renderCriticalBanner();
        assert.match(html, /PENDING SCORE/);
        assert.match(html, /class="ss-score">—</);
    });
});
describe("critical failure rate: zero state is intentional, not absent", () => {
    it("all scored runs pass the critical threshold → 0% with CLEAN hint in the pass band", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        ui.state.tabData["personality"] = { runs: [run(90), run(85), run(72)] };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.total, 3);
        assert.equal(s.critical, 0);
        assert.equal(s.rate, 0);
        const html = ui.renderCriticalBanner();
        assert.match(html, /class="status-strip pass"/, "a genuine 0% must render in the pass band");
        assert.match(html, /class="ss-score">0%</);
        assert.match(html, /0\/3 BELOW 55% · CLEAN/, "CLEAN suffix must mark a real zero rate as intentional");
    });
});
describe("critical failure rate: non-zero state reflects real failed runs", () => {
    it("half the runs are critical → 50% with correct numerator and denominator", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        ui.state.tabData["personality"] = {
            runs: [run(90), run(10), run(20), run(80)],
        };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.total, 4);
        assert.equal(s.critical, 2);
        assert.equal(s.rate, 50);
        const html = ui.renderCriticalBanner();
        assert.match(html, /class="status-strip fail"/, ">10% critical must land in the fail band");
        assert.match(html, /class="ss-score">50%</);
        assert.match(html, /2\/4 BELOW 55%/, "subtitle must show numerator/denominator, not just the percent");
    });
    it("the exact threshold (55) counts as NOT critical — strict inequality below 55", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        // scorePct rounds, so 54.9 would bucket to 55 and miss the threshold. Use
        // an integer one below the cutoff to prove strict inequality honestly.
        ui.state.tabData["personality"] = { runs: [run(55), run(54)] };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.total, 2);
        assert.equal(s.critical, 1, "55 must pass the threshold; 54 must be critical");
    });
    it("1–10% rate lands in the warn band (intentional sub-band distinct from fail)", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        // 1 critical of 20 = 5% → warn.
        const runs = [run(10)];
        for (let i = 0; i < 19; i++)
            runs.push(run(90));
        ui.state.tabData["personality"] = { runs };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.critical, 1);
        assert.equal(s.total, 20);
        assert.equal(s.rate, 5);
        const html = ui.renderCriticalBanner();
        assert.match(html, /class="status-strip warn"/);
    });
});
describe("critical failure rate: refresh behavior", () => {
    it("appending a new critical run updates the rate immediately (no stale cache)", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        ui.state.tabData["personality"] = { runs: [run(90), run(80)] };
        const before = ui.criticalFailureStats("dashboard");
        assert.equal(before.rate, 0);
        // Simulate refreshTabData landing a freshly-failed run.
        ui.state.tabData["personality"] = { runs: [run(90), run(80), run(10)] };
        const after = ui.criticalFailureStats("dashboard");
        // rate is the raw percentage; the banner rounds for display. Assert on
        // both so a silent cache issue can't hide.
        assert.ok(Math.abs(after.rate - (100 / 3)) < 1e-9, "new critical run must move the rate on the next read");
        assert.equal(after.critical, 1);
        assert.equal(after.total, 3);
        // And the banner markup reflects it without any reconciliation step.
        const html = ui.renderCriticalBanner();
        assert.match(html, /1\/3 BELOW 55%/);
        assert.match(html, /class="ss-score">33%</, "display must show the rounded 33%");
    });
    it("clearing all runs returns the banner to the honest empty state", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        ui.state.tabData["personality"] = { runs: [run(10)] };
        assert.equal(ui.criticalFailureStats("dashboard").rate, 100);
        ui.state.tabData["personality"] = { runs: [] };
        const after = ui.criticalFailureStats("dashboard");
        assert.equal(after.total, 0);
        assert.equal(after.rate, null);
        assert.match(ui.renderCriticalBanner(), /class="status-strip neutral"/);
    });
});
describe("critical failure rate: scope honors the active tab", () => {
    it("dashboard aggregates across every non-settings lane; per-tab only sees that lane", () => {
        const ui = loadUi();
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        // One clean lane, one dirty lane.
        ui.state.tabData["personality"] = { runs: [run(90), run(95)] };
        ui.state.tabData["benchmark"] = { runs: [run(10), run(20), run(30)] };
        ui.state.activeTab = "dashboard";
        const all = ui.criticalFailureStats("dashboard");
        assert.equal(all.total, 5);
        assert.equal(all.critical, 3);
        assert.equal(all.rate, 60);
        ui.state.activeTab = "personality";
        const p = ui.criticalFailureStats("personality");
        assert.equal(p.total, 2);
        assert.equal(p.critical, 0);
        assert.equal(p.rate, 0, "a clean lane must show 0% even while the dashboard is hot");
        ui.state.activeTab = "benchmark";
        const b = ui.criticalFailureStats("benchmark");
        assert.equal(b.total, 3);
        assert.equal(b.critical, 3);
        assert.equal(b.rate, 100);
    });
    it("banner subtitle includes the scope label so the user always knows what's measured", () => {
        const ui = loadUi();
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        ui.state.tabData["personality"] = { runs: [run(90)] };
        ui.state.activeTab = "personality";
        const html = ui.renderCriticalBanner();
        assert.match(html, /CRITICAL FAILURE RATE · PERSONALITY/);
        ui.state.activeTab = "dashboard";
        assert.match(ui.renderCriticalBanner(), /CRITICAL FAILURE RATE · ALL LANES/);
    });
});
describe("critical failure rate: evidence linkage", () => {
    it("dashboard renders an element with id='crit-evidence-anchor' as the jump target", () => {
        // This is a static source-level check — the anchor must exist on both
        // the dashboard's Signal Queue and every lane's Signal Archive, so the
        // banner's jump handler always has somewhere to land.
        assert.match(uiHtml, /id="crit-evidence-anchor"[^>]*>[\s\S]*?SIGNAL QUEUE/, "dashboard Signal Queue must carry the anchor id");
        assert.match(uiHtml, /id="crit-evidence-anchor"[^>]*>[\s\S]*?RUN HISTORY/, "lane Signal Archive must carry the anchor id");
    });
    it("jumpToCriticalEvidence is exposed on window for the inline onclick handler", () => {
        assert.match(uiHtml, /window\.jumpToCriticalEvidence\s*=\s*jumpToCriticalEvidence/);
    });
    it("criticalFailureStats returns the contributing runs so an inspector UI can list them", () => {
        const ui = loadUi();
        ui.state.activeTab = "dashboard";
        for (const k of Object.keys(ui.state.tabData))
            ui.state.tabData[k] = { runs: [] };
        ui.state.tabData["personality"] = { runs: [run(90, { bundle_id: "keep" }), run(10, { bundle_id: "crit-1" }), run(20, { bundle_id: "crit-2" })] };
        const s = ui.criticalFailureStats("dashboard");
        assert.equal(s.criticalRuns.length, 2);
        // vm-context arrays have a foreign Array prototype, which breaks
        // deepEqual across realms. Compare as JSON so the test asserts on
        // observable content, not identity.
        const ids = s.criticalRuns.map((r) => r.bundle_id).sort();
        assert.equal(JSON.stringify(ids), JSON.stringify(["crit-1", "crit-2"]), "criticalRuns must be the actual failing bundles, not placeholders");
    });
});
//# sourceMappingURL=ui-critical-metric.test.js.map