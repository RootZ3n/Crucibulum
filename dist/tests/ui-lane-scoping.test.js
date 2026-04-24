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
    return match[1].replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "");
}
function makeJsonResponse(body) {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
        clone() { return this; },
    };
}
function buildRun(model, family, score) {
    return {
        bundle_id: `${family}-${model}`,
        task_id: `${family}-task`,
        family,
        model,
        provider: "test",
        score,
        pass: score >= 80,
        timestamp: "2026-04-20T00:00:00Z",
    };
}
function loadUi() {
    const script = extractScript();
    const fetchCalls = [];
    const windowStub = {};
    const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
    const sandbox = {
        console,
        window: windowStub,
        document: { addEventListener: () => { }, body: { className: "" }, getElementById: () => null },
        navigator: { userAgent: "node-test" },
        location: locationStub,
        history: { replaceState: () => { } },
        localStorage: (() => {
            const s = new Map();
            return {
                getItem: (k) => s.get(k) ?? null,
                setItem: (k, v) => { s.set(k, String(v)); },
                removeItem: (k) => { s.delete(k); },
            };
        })(),
        fetch: async (url) => {
            fetchCalls.push(String(url));
            const parsed = new URL(String(url), "http://localhost");
            const scope = parsed.searchParams.get("task_families") ?? "";
            if (parsed.pathname === "/api/stats") {
                if (scope === "orchestration")
                    return makeJsonResponse({ total_runs: 1, pass_rate: 91, avg_score: 91, total_cost_usd: 0.02 });
                if (scope === "personality,identity")
                    return makeJsonResponse({ total_runs: 1, pass_rate: 44, avg_score: 44, total_cost_usd: 0.01 });
                return makeJsonResponse({ total_runs: 2, pass_rate: 68, avg_score: 68, total_cost_usd: 0.03 });
            }
            if (parsed.pathname === "/api/leaderboard") {
                if (scope === "orchestration")
                    return makeJsonResponse({ leaderboard: [{ modelId: "build-model", composite: 91, totalRuns: 1, lastRun: "2026-04-20T00:00:00Z", source: "crucibulum" }] });
                if (scope === "personality,identity")
                    return makeJsonResponse({ leaderboard: [{ modelId: "persona-model", composite: 44, totalRuns: 1, lastRun: "2026-04-20T00:00:00Z", source: "crucibulum" }] });
                return makeJsonResponse({ leaderboard: [] });
            }
            if (parsed.pathname === "/api/runs") {
                if (scope === "orchestration")
                    return makeJsonResponse({ runs: [buildRun("build-model", "orchestration", 91)] });
                if (scope === "personality,identity")
                    return makeJsonResponse({ runs: [buildRun("persona-model", "personality", 44)] });
                return makeJsonResponse({ runs: [] });
            }
            return makeJsonResponse({});
        },
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
    windowStub.location = locationStub;
    sandbox.globalThis = sandbox;
    const prelude = "function render(){}\n";
    const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
    const exporter = "\n;globalThis.__ui={refreshTabData,reviewSummary,renderOverviewCards,renderLaneLeaderboardGraph,renderFocusedRun,renderLiveStatus,state,TAB_CONFIG,__fetchCalls:globalThis.__fetchCalls};\n";
    sandbox.__fetchCalls = fetchCalls;
    const context = vm.createContext(sandbox);
    vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
    return sandbox.__ui;
}
describe("ui lane scoping", () => {
    it("passes task_families for lane fetches and keeps tab datasets isolated", async () => {
        const ui = loadUi();
        await ui.refreshTabData("build");
        await ui.refreshTabData("personality");
        assert.ok(ui.__fetchCalls.some((url) => url.includes("/api/runs?task_families=orchestration")));
        assert.ok(ui.__fetchCalls.some((url) => url.includes("/api/leaderboard?task_families=orchestration")));
        assert.ok(ui.__fetchCalls.some((url) => url.includes("/api/runs?task_families=personality%2Cidentity")));
        assert.ok(ui.__fetchCalls.some((url) => url.includes("/api/stats?task_families=personality%2Cidentity")));
        const buildSummary = ui.reviewSummary("build");
        const personalitySummary = ui.reviewSummary("personality");
        assert.equal(buildSummary.best?.model, "build-model");
        assert.equal(personalitySummary.best?.model, "persona-model");
    });
    it("renders lane-specific leaderboard and overview content after tab switches", async () => {
        const ui = loadUi();
        await ui.refreshTabData("build");
        await ui.refreshTabData("personality");
        const buildLeaderboard = ui.renderLaneLeaderboardGraph("build");
        const personalityLeaderboard = ui.renderLaneLeaderboardGraph("personality");
        const buildOverview = ui.renderOverviewCards("build");
        const personalityOverview = ui.renderOverviewCards("personality");
        assert.match(buildLeaderboard, /build-model/i);
        assert.doesNotMatch(buildLeaderboard, /persona-model/i);
        assert.match(personalityLeaderboard, /persona-model/i);
        assert.doesNotMatch(personalityLeaderboard, /build-model/i);
        assert.match(buildOverview, /build-model/i);
        assert.doesNotMatch(buildOverview, /persona-model/i);
        assert.match(personalityOverview, /persona-model/i);
        assert.doesNotMatch(personalityOverview, /build-model/i);
    });
    it("does not leak dashboard-focused detail blocks into a lane tab", async () => {
        const ui = loadUi();
        ui.state.focusedResult = {
            dashboard: {
                model: "dashboard-only",
                provider: "test",
                task: "dashboard-task",
                family: "spec_discipline",
                categories: [],
                details: [],
                overall: 88,
                overallKnown: true,
            },
            build: null,
        };
        const buildFocused = ui.renderFocusedRun("build");
        const buildLive = ui.renderLiveStatus("build");
        assert.match(buildFocused, /SELECT A RUN/i);
        assert.doesNotMatch(buildFocused, /dashboard-only/i);
        assert.doesNotMatch(buildLive, /dashboard-only/i);
    });
    it("keeps lane taskFamilies mutually disjoint so no run can belong to two tabs", () => {
        const ui = loadUi();
        // Dashboard is intentionally global and providers is a settings screen
        // with no lane data; everything else must be disjoint, otherwise one
        // run shows up in two places and the per-tab metrics lie.
        const seen = new Map();
        for (const [key, cfg] of Object.entries(ui.TAB_CONFIG)) {
            if (key === "dashboard" || key === "providers")
                continue;
            for (const family of cfg.taskFamilies) {
                const prior = seen.get(family);
                assert.equal(prior, undefined, `task family ${family} appears in both ${prior} and ${key} — the same runs will render in two tabs`);
                seen.set(family, key);
            }
        }
        // Sanity: identity must live in exactly one lane tab.
        const identityOwners = Object.entries(ui.TAB_CONFIG)
            .filter(([k, cfg]) => k !== "dashboard" && k !== "providers" && cfg.taskFamilies.includes("identity"))
            .map(([k]) => k);
        assert.equal(identityOwners.length, 1, `identity must belong to exactly one tab, found: ${identityOwners.join(",")}`);
    });
});
// ── verdict metrics surfaced per lane ───────────────────────────────────────
//
// The core truth-and-scope requirement: every lane tab must render the
// backend-computed verdict metrics (pass / model_failure_rate / nc_rate /
// infra_issue_rate). Without these on-screen, a reader has no way to detect
// a scope leak — the pass rate alone looks the same whether it was computed
// over the lane's bundles or over the global population.
describe("lane verdict vitals", () => {
    function loadUiWithVerdictStats() {
        const script = extractScript();
        const fetchCalls = [];
        const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
        const windowStub = { location: locationStub };
        const sandbox = {
            console,
            window: windowStub,
            document: { addEventListener: () => { }, body: { className: "" }, getElementById: () => null },
            navigator: { userAgent: "node-test" },
            location: locationStub,
            history: { replaceState: () => { } },
            localStorage: (() => {
                const s = new Map();
                return { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => { s.set(k, String(v)); }, removeItem: (k) => { s.delete(k); } };
            })(),
            fetch: async (url) => {
                fetchCalls.push(String(url));
                const parsed = new URL(String(url), "http://localhost");
                const scope = parsed.searchParams.get("task_families") ?? "";
                // Build-lane stats — 4 runs: 2 pass, 1 FAIL:MODEL (critical), 1 NC:PROVIDER
                // The server-side getStats produces these exact fields; the UI must
                // surface them without re-deriving (deriving would let the UI silently
                // mis-count NCs as model failures, which is the bug class this pins).
                if (parsed.pathname === "/api/stats" && scope === "orchestration") {
                    return { ok: true, status: 200, clone() { return this; }, json: async () => ({
                            total_runs: 4, pass_rate: 50, avg_score: 64,
                            model_fail_runs: 1, model_failure_rate: 25,
                            infra_issue_runs: 1, infra_issue_rate: 25,
                            not_complete_runs: 1, nc_rate: 25,
                            completion_rate: 75, total_cost_usd: 0.03, scored_runs: 3, avg_score_runs: 3,
                            task_families: ["orchestration"], scope_key: "orchestration",
                        }), text: async () => "" };
                }
                if (parsed.pathname === "/api/stats" && scope === "safety") {
                    return { ok: true, status: 200, clone() { return this; }, json: async () => ({
                            total_runs: 3, pass_rate: 100, avg_score: 92,
                            model_fail_runs: 0, model_failure_rate: 0,
                            infra_issue_runs: 0, infra_issue_rate: 0,
                            not_complete_runs: 0, nc_rate: 0,
                            completion_rate: 100, total_cost_usd: 0.01,
                            task_families: ["safety"], scope_key: "safety",
                        }), text: async () => "" };
                }
                return { ok: true, status: 200, clone() { return this; }, json: async () => ({ runs: [], leaderboard: [], total_runs: 0, task_families: scope ? scope.split(",") : null, scope_key: scope || "all" }), text: async () => "" };
            },
            EventSource: class {
            },
            setTimeout, clearTimeout, URL, URLSearchParams,
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
        const prelude = "function render(){}\n";
        const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
        const exporter = "\n;globalThis.__ui={refreshTabData,renderLane,state,TAB_CONFIG};\n";
        const context = vm.createContext(sandbox);
        vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
        return sandbox.__ui;
    }
    it("renders backend-supplied model_failure_rate, nc_rate, infra_issue_rate in lane vitals (NC never counted as a model failure)", async () => {
        const ui = loadUiWithVerdictStats();
        await ui.refreshTabData("build");
        const html = ui.renderLane("build");
        assert.match(html, /MODEL FAIL/i, "MODEL FAIL vital must render on every lane tab");
        assert.match(html, /NC RATE/i, "NC RATE vital must render on every lane tab");
        assert.match(html, /INFRA/i, "INFRA vital must render on every lane tab");
        // The seeded build stats: 1 model fail (25%), 1 infra NC (25%).
        // The NC run MUST NOT be counted into MODEL FAIL — they are distinct
        // lines. Finding 25% against both labels confirms they're read from
        // different fields (model_failure_rate vs nc_rate), not doubled up.
        const rendered = html.replace(/\s+/g, " ");
        assert.match(rendered, /MODEL FAIL<\/div><div class="v-readout[^"]*">25</, "model_failure_rate must bind the MODEL FAIL readout");
        assert.match(rendered, /NC RATE<\/div><div class="v-readout[^"]*">25</, "nc_rate must bind the NC RATE readout");
        assert.match(rendered, /INFRA<\/div><div class="v-readout[^"]*">25</, "infra_issue_rate must bind the INFRA readout");
    });
    it("switching tabs swaps every verdict metric — no cross-tab carryover", async () => {
        const ui = loadUiWithVerdictStats();
        await ui.refreshTabData("build");
        await ui.refreshTabData("safety");
        const buildHtml = ui.renderLane("build");
        const safetyHtml = ui.renderLane("safety");
        // Build: 25% model fail / 25% NC. Safety: 0% / 0%.
        const buildMf = buildHtml.replace(/\s+/g, " ").match(/MODEL FAIL<\/div><div class="v-readout[^"]*">(\d+)</);
        const safetyMf = safetyHtml.replace(/\s+/g, " ").match(/MODEL FAIL<\/div><div class="v-readout[^"]*">(\d+)</);
        assert.equal(buildMf?.[1], "25");
        assert.equal(safetyMf?.[1], "0");
        const buildNc = buildHtml.replace(/\s+/g, " ").match(/NC RATE<\/div><div class="v-readout[^"]*">(\d+)</);
        const safetyNc = safetyHtml.replace(/\s+/g, " ").match(/NC RATE<\/div><div class="v-readout[^"]*">(\d+)</);
        assert.equal(buildNc?.[1], "25");
        assert.equal(safetyNc?.[1], "0");
    });
    it("empty tab renders cleanly (no zero-division, no leaked values)", async () => {
        const ui = loadUiWithVerdictStats();
        await ui.refreshTabData("memory"); // mock returns empty stats + runs
        const html = ui.renderLane("memory");
        // An empty scope must produce neutral readouts, not borrowed numbers
        // from another lane. We assert the run-count readout is 0 and the
        // archive section explicitly says NO SIGNAL.
        assert.match(html, /RUNS<\/div><div class="v-readout[^"]*">0</);
        assert.match(html, /NO SIGNAL/i);
    });
    it("refuses to commit a response whose echoed scope does not match the request", async () => {
        // Simulate a server that mis-routes safety's scoped response under the
        // build tab's request. The scope integrity check must refuse to write
        // the payload into state.tabData.build — the tab stays empty rather
        // than silently display safety's numbers labeled 'Build'.
        const script = extractScript();
        let calls = 0;
        const locationStub = { pathname: "/", hash: "", search: "", origin: "http://localhost" };
        const windowStub = { location: locationStub };
        const sandbox = {
            console: { ...console, warn: () => { } },
            window: windowStub, document: { addEventListener: () => { }, body: { className: "" }, getElementById: () => null },
            navigator: { userAgent: "node-test" },
            location: locationStub,
            history: { replaceState: () => { } },
            localStorage: (() => { const s = new Map(); return { getItem: (k) => s.get(k) ?? null, setItem: (k, v) => { s.set(k, String(v)); }, removeItem: (k) => { s.delete(k); } }; })(),
            fetch: async () => {
                calls += 1;
                return { ok: true, status: 200, clone() { return this; }, json: async () => ({
                        // Wrong scope echoed back — the UI must reject this write.
                        runs: [{ bundle_id: "leak", task_id: "safety-1", family: "safety", model: "wrong-lane", score: 99, pass: true, timestamp: "2026-04-20T00:00:00Z" }],
                        leaderboard: [{ modelId: "wrong-lane", composite: 99, totalRuns: 1, lastRun: "2026-04-20T00:00:00Z", source: "crucibulum" }],
                        total_runs: 1, pass_rate: 99, avg_score: 99,
                        task_families: ["safety"],
                        scope_key: "safety",
                    }), text: async () => "" };
            },
            EventSource: class {
            }, setTimeout, clearTimeout, URL, URLSearchParams,
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
        const prelude = "function render(){}\n";
        const withoutRender = script.replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n");
        const exporter = "\n;globalThis.__ui={refreshTabData,state};\n";
        const context = vm.createContext(sandbox);
        vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
        const ui = sandbox.__ui;
        await ui.refreshTabData("build");
        assert.ok(calls > 0, "fetch must have been called");
        // Integrity win looks like: the write was refused and the tab was not
        // populated with the wrong-scope payload. Both "no entry written yet"
        // (undefined) and "empty arrays" satisfy that — the forbidden state is
        // seeing the leaked 'wrong-lane' row/leaderboard.
        const build = ui.state.tabData.build;
        const runs = build?.runs ?? [];
        const board = build?.leaderboard ?? [];
        assert.ok(runs.every((r) => r.model !== "wrong-lane"), "build tab must not accept the safety-scoped row");
        assert.ok(board.every((e) => e.modelId !== "wrong-lane"), "build tab must not accept the safety-scoped leaderboard entry");
    });
});
//# sourceMappingURL=ui-lane-scoping.test.js.map