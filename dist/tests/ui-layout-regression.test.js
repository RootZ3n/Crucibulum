/**
 * Crucible — UI layout regression guard
 *
 * A browser harness (Playwright / Puppeteer) would be the right tool to
 * visually assert "the Coverage card's lower content is reachable", but it
 * brings a ~150MB install and real browser binaries for a single known bug.
 * Instead, this test pins the specific CSS rules whose removal was the fix —
 * a boundary check: if someone re-introduces the exact combination of rules
 * that caused the clipping, the test fails.
 *
 * This is coarse but cheap, deterministic, and catches the regression we care
 * about (reverting the previous fix). For genuinely new layout bugs, a manual
 * desktop pass remains the test of record — see deferral note in the report.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// The shipped UI is split across two files: `ui/index.html` (markup + script)
// and `ui/crucibulum.css` (the shared design-system stylesheet, extracted so
// Auctor and any future module can consume the exact same tokens). The
// regression tests pin rules from both, so we load a combined haystack.
const uiHtml = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
const uiCss = readFileSync(join(process.cwd(), "ui", "crucibulum.css"), "utf-8");
const ui = `${uiHtml}\n${uiCss}`;
function findRule(selector) {
    // Match `<selector>{...}` — the UI uses a compact style block.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m");
    const match = ui.match(re);
    assert.ok(match, `expected CSS rule for selector "${selector}" to exist in shipped UI (index.html or crucibulum.css)`);
    return match[1];
}
describe("ui-layout-regression: control rail does not re-introduce the clipping combo", () => {
    it(".control-rail must NOT have max-height on viewport (root cause of the clipping bug)", () => {
        const body = findRule(".control-rail");
        assert.doesNotMatch(body, /max-height\s*:\s*calc\(\s*100vh/, "Regression: .control-rail should not cap at 100vh; that was the clipping root cause. Use sticky positioning without max-height instead.");
    });
    it(".control-rail must keep position:sticky so the rail stays with content flow", () => {
        const body = findRule(".control-rail");
        assert.match(body, /position\s*:\s*sticky/, "Rail must remain sticky (top-anchored) on desktop widths");
    });
    it("first rail panel must NOT have overflow:hidden (clips CONTROL DECK content)", () => {
        const body = findRule(".control-rail>.rail-panel:first-child");
        assert.doesNotMatch(body, /overflow\s*:\s*hidden/, "Regression: overflow:hidden on the first rail panel clips buttons/fields when the panel is flex-crushed");
    });
    it("multiselect inside the rail has internal scroll (bounded height, visible scrollbar)", () => {
        const body = findRule(".control-rail>.rail-panel:first-child>.field>.select[multiple]");
        assert.match(body, /max-height\s*:\s*\d+px/, "The multiselect should cap at a fixed height — it's the single legitimate internal-scroll region in the rail");
        assert.match(body, /overflow-y\s*:\s*auto/, "The multiselect itself must be the scrollable region (not the rail)");
    });
});
describe("ui-layout-regression: mobile breakpoint still neutralizes sticky positioning", () => {
    it("@media (max-width:1240px) sets .control-rail position:static", () => {
        // Grep the media rule block and confirm it still un-sticks the rail on narrow viewports.
        const mq = ui.match(/@media\s*\(\s*max-width\s*:\s*1240px\s*\)\s*\{([\s\S]*?)\n\}\s*(?:@|$)/);
        assert.ok(mq, "max-width:1240px media query must exist");
        assert.match(mq[1], /\.control-rail\s*\{[^}]*position\s*:\s*static/);
    });
});
describe("ui-layout-regression: benchmark lane — visible test picker replaces the dropdown", () => {
    it("no TASK single-select dropdown binding to selectedTask remains", () => {
        // Before: <label>TASK</label><select class="select" onchange="updateTabField('<tab>','selectedTask',this.value)">
        assert.doesNotMatch(ui, /<label>\s*TASK\s*<\/label>\s*<select[^>]*updateTabField\([^)]*selectedTask/, "Regression: the TASK single-select dropdown must be gone; test selection is now visible and toggleable.");
    });
    it("renders a visible .test-list with toggleable .test-toggle entries", () => {
        assert.match(ui, /\.test-list\s*\{/, ".test-list CSS rule must exist");
        assert.match(ui, /\.test-toggle\s*\{/, ".test-toggle CSS rule must exist");
        assert.match(ui, /class="test-list"/, "a .test-list container must be rendered in the markup");
        assert.match(ui, /class="test-toggle\s/, "a .test-toggle item must be rendered in the markup");
    });
    it("exposes Select All / Clear All + filter + only-selected handlers", () => {
        assert.match(ui, /function selectAllTasks/);
        assert.match(ui, /function clearAllTasks/);
        assert.match(ui, /function setTaskFilterFamily/);
        assert.match(ui, /function toggleTaskOnlySelected/);
        assert.match(ui, /window\.selectAllTasks\s*=/);
        assert.match(ui, /window\.clearAllTasks\s*=/);
    });
    it("renders a run-count segmented control with state setter and 'All Selected' option", () => {
        assert.match(ui, /function setRunCount/);
        assert.match(ui, /class="rc-btn/);
        assert.match(ui, /runCount:/, "runCount field must exist on tab state defaults");
        assert.match(ui, /ALL SELECTED/, "run-count control must expose an 'All Selected' option");
    });
    it("renames 'Run Lane' → 'Run All' everywhere", () => {
        assert.doesNotMatch(ui, /RUN LANE/i, "Regression: 'Run Lane' label must not appear anywhere");
        assert.match(ui, /▶▶\s*RUN ALL/, "lane-batch button must read 'Run All'");
    });
    it("renders a Live Status panel at the top of the content column, above the leaderboard", () => {
        assert.match(ui, /\.live-status\s*\{/, ".live-status CSS rule must exist");
        assert.match(ui, /function renderLiveStatus/, "renderLiveStatus must be defined");
        // Live Status must appear in renderLane BEFORE the lane leaderboard
        // panel, so the active run is visible without scrolling past it. The
        // panel previously rendered a literal `Rankings</h3>` header; today the
        // leaderboard insert point is `renderLaneLeaderboardGraph(tab.key)`.
        // This assertion targets the call site so it tracks UI refactors of
        // the panel title ("Rankings" → "Leaderboard") without regressing the
        // *spatial* contract — which is the actual thing operators care about.
        const renderLaneFn = ui.match(/function renderLane\([\s\S]*?\n\}\n/);
        assert.ok(renderLaneFn, "renderLane function must exist");
        const body = renderLaneFn[0];
        const liveIdx = body.indexOf("renderLiveStatus(tab.key)");
        const leaderboardIdx = body.indexOf("renderLaneLeaderboardGraph(tab.key)");
        assert.ok(liveIdx >= 0, "renderLane must call renderLiveStatus(tab.key)");
        assert.ok(leaderboardIdx >= 0, "renderLane must still render the lane leaderboard panel via renderLaneLeaderboardGraph(tab.key)");
        assert.ok(liveIdx < leaderboardIdx, "Live Status must appear ABOVE the leaderboard panel in the content column (no scrolling to see the active run)");
        // And it must NOT be inside the control-rail aside anymore — previous placement required users
        // to look away from the leaderboard area to find live status.
        const aside = body.match(/<aside class="control-rail">[\s\S]*?<\/aside>/);
        assert.ok(aside, "control-rail aside must still exist");
        assert.doesNotMatch(aside[0], /renderLiveStatus\(/, "Live Status must not live inside the control-rail aside anymore — it must be in the content column");
    });
    it("telemetry cells render meaningful labels (DUR / TOK IN / TOK OUT / COST), with 'pending' placeholders when unpopulated", () => {
        assert.match(ui, /\.tel-cell\s*\{/);
        assert.match(ui, /class="tel-k">DUR</);
        assert.match(ui, /class="tel-k">TOK IN</);
        assert.match(ui, /class="tel-k">TOK OUT</);
        assert.match(ui, /class="tel-k">COST</);
        assert.match(ui, /pending/, "unknown telemetry values must read 'pending' (no misleading zeros)");
    });
});
describe("ui-layout-regression: selection-to-execution integrity (count tri-state, per-test dispatch)", () => {
    // Pins the fix for the spec-only-execution bug: the UI must distinguish
    // between plan/attempted/executed/failed so "ran 16" only shows when 16
    // bundles actually came back, and it must iterate selectedTasks one-by-one
    // sending each exact id to POST /api/run (no lane/family substitution).
    it("runBatch uses a tri-state count (planned / attempted / executed / failed) — no inflated total", () => {
        // The pre-fix code seeded `batchTotal=totalRuns` and `batchDone` ticked on
        // every loop iteration regardless of whether a bundle was stored. That's
        // the 'immediate fake progress' failure mode the brief calls out.
        assert.match(ui, /batchPlanned\s*:/, "batch state must expose a 'planned' field (runs queued = tasks × models)");
        assert.match(ui, /batchAttempted\s*:/, "batch state must expose an 'attempted' field (POST returned)");
        assert.match(ui, /batchExecuted\s*:/, "batch state must expose an 'executed' field (bundle stored)");
        assert.match(ui, /batchFailed\s*:/, "batch state must expose a 'failed' field (did not run)");
        // Final batch summary must mention what actually ran, not just a total.
        assert.match(ui, /actually ran|ran\s*\$\{passed\}|\$\{executed\}\s+of\s+\$\{planned\}/, "final summary must report executed-of-planned — not total-of-total");
    });
    it("runSingle returns a structured outcome (executed + pass) and surfaces 422 reasons", () => {
        // The 422 adapter_cannot_run_task case must land as executed:false with a
        // reason string — not as a silent "done" tick.
        assert.match(ui, /executed\s*:\s*true/, "runSingle/watchRunCompletion must report executed:true on SSE complete");
        assert.match(ui, /executed\s*:\s*false/, "runSingle must report executed:false when POST or SSE fail");
        assert.match(ui, /DID NOT RUN/, "UI must label non-execution with 'DID NOT RUN' rather than 'FAILED'");
        assert.match(ui, /class\s+HTTPError/, "fetchJSON must surface structured error bodies (needed to read the 422 reason)");
        assert.match(ui, /body\.reason/, "runSingle must read the structured 422 'reason' off the HTTPError body");
    });
    it("runBatch iterates selectedTasks one-by-one and posts each exact id to /api/run", () => {
        // Pin that the client's outer loop walks the selection array and that each
        // iteration POSTs with `task:taskId` — no lane/family short-circuit.
        assert.match(ui, /for\s*\(\s*const\s+taskId\s+of\s+taskIds\s*\)/, "runBatch must iterate taskIds explicitly");
        assert.match(ui, /JSON\.stringify\s*\(\s*\{\s*task\s*:\s*taskId/, "runSingle must POST the exact selected taskId (no substitution)");
    });
    it("handleRun uses selectedTasks + runCount (not a hidden spec default)", () => {
        // Ensures "RUN" honors exactly the current selection instead of falling
        // back to a lane-wide or spec-only default.
        assert.match(ui, /selectedTasks\s*\.?\s*slice\s*\(/, "handleRun must slice selectedTasks by runCount");
        assert.match(ui, /tab\.runCount/, "handleRun must consult the user-chosen runCount");
        // No hardcoded 'spec' family or default id anywhere in the run dispatch path.
        assert.doesNotMatch(ui, /JSON\.stringify\s*\(\s*\{[^}]*task\s*:\s*['"]spec[- _]?\d+['"]/, "must not hardcode any spec task id into the run payload");
    });
    it("live status label shows executed-of-planned and 'couldn't start' count", () => {
        // Proves the UI copy itself doesn't inflate. 'X/Y ran' + '... couldn't start'
        // are the phrases wired to batchExecuted/batchFailed respectively.
        assert.match(ui, /\$\{executed\}\/\$\{planned\}\s+ran/, "progress label must read 'X/Y ran'");
        assert.match(ui, /couldn't start/, "live status must explicitly call out runs that couldn't start");
        assert.match(ui, /failed after start/, "live status must distinguish post-launch failures from launch failures");
        assert.match(ui, /skipped by preflight/, "live status must distinguish preflight skips from launch failures");
        assert.match(ui, /batchItems/, "batch state must keep per-child lifecycle entries");
        assert.match(ui, /ls-reasons/, "live status must render an explicit reasons list for failed child runs");
    });
    it("run history strip includes a family chip so mixed-family archive is obvious at a glance", () => {
        // If the archive shows only 'SPEC' chips, the user's original complaint
        // (spec-only execution) is visually undeniable; if mixed, it reflects
        // reality. Pins the family tag into the run-strip markup.
        assert.match(ui, /class="tag dim rs-family"/);
    });
});
describe("ui-layout-regression: Providers tab is wired and backed by the registry API", () => {
    it("ships a 'Providers' tab in TAB_CONFIG and routes to renderProvidersView()", () => {
        assert.match(ui, /providers:\s*\{[^}]*key:\s*'providers'/, "TAB_CONFIG must declare a providers tab");
        assert.match(ui, /isSettings:\s*true/, "the providers tab must be flagged as settings so lane-data fetches skip it");
        assert.match(ui, /state\.activeTab\s*===\s*'providers'[\s\S]{0,60}renderProvidersView\(\)/, "renderActiveTab must dispatch providers → renderProvidersView()");
    });
    it("exposes registry CRUD actions on window so inline onclicks work", () => {
        for (const name of [
            "registryAddProvider", "registryRemoveProvider", "registryToggleProvider", "registryTestProvider",
            "registryAddModel", "registryBulkSubmit", "registryToggleModel", "registryRemoveModel",
            "registryOpenBulkFor", "registryCloseBulk",
        ]) {
            assert.match(ui, new RegExp(`window\\.${name}\\s*=\\s*${name}`), `${name} must be exposed on window`);
        }
    });
    it("calls the /api/registry/state endpoint at boot and caches the response on state.registry", () => {
        assert.match(ui, /async function loadRegistry\(\)/, "loadRegistry helper must exist");
        assert.match(ui, /fetchJSON\(\s*['"]\/api\/registry\/state['"]/, "loadRegistry must GET /api/registry/state");
        assert.match(ui, /state\.registry\s*=/, "boot must hydrate state.registry");
    });
    it("builds the Local (Ollama) group from live /api/models inventory when available", () => {
        assert.match(ui, /dynamicLocalModelGroup/, "UI must derive local model options from live inventory");
        assert.match(ui, /state\.liveModels/, "local model inventory must read the live /api/models payload");
        assert.match(ui, /async function refreshModelInventory\(\)/, "UI must expose a dedicated live model refresh helper");
        assert.match(ui, /reloadLane\(tabKey\)\{await refreshModelInventory\(\)/, "lane refresh must refresh model inventory so new local installs appear without a full reload");
        assert.match(ui, /Local \(Ollama · installed\)/, "label must state that the local group reflects installed models");
        assert.match(ui, /Cloud groups remain the curated benchmark pool/, "UI must explain that cloud groups are curated rather than full provider inventories");
    });
    it("the bulk-add textarea placeholder advertises the expected OpenRouter paste format", () => {
        assert.match(ui, /openai\/gpt-5-mini[\s\S]{0,120}anthropic\/claude-sonnet-4\.5[\s\S]{0,120}qwen\/qwen3\.6-plus[\s\S]{0,120}google\/gemini-2\.5-pro/, "bulk placeholder should show the canonical OpenRouter ids");
    });
    it("provider cards reflect circuit state (open / half-open / closed) via CSS classes", () => {
        assert.match(ui, /\.provider-card\.circuit-open/);
        assert.match(ui, /\.provider-card\.circuit-half-open/);
        assert.match(ui, /circuit\.state\s*===\s*'open'/);
    });
});
describe("ui-layout-regression: auth screen presence and mobile layout", () => {
    // These don't run a real browser, but they do pin that the auth-screen
    // CSS and the auth-submit handler are present in the shipped UI. If a
    // future refactor removes them, the unauthorized boot would silently fall
    // back to the old "BOOT FAILURE" dead end on mobile/remote users.
    it("ships auth-card styles and a mobile breakpoint for the card", () => {
        assert.match(ui, /\.auth-card\s*\{/, "auth-card rule must exist");
        assert.match(ui, /@media\s*\(\s*max-width\s*:\s*480px\s*\)\s*\{[\s\S]*?\.auth-card/, "auth-card must have a narrow-screen override");
    });
    it("defines the auth submit handler and window hook", () => {
        assert.match(ui, /async function submitAuthToken/);
        assert.match(ui, /window\.submitAuthToken\s*=\s*submitAuthToken/);
    });
    it("attempts bootstrap before showing the manual-entry form", () => {
        assert.match(ui, /function tryBootstrapLocal/);
        assert.match(ui, /\/api\/auth\/bootstrap-local/);
        assert.match(ui, /\/api\/auth\/status/);
    });
    it("centralizes Bearer attachment in fetchJSON and reacts to 401", () => {
        // The minified UI calls headers.set('Authorization','Bearer '+token).
        // Pin the Bearer prefix construction and the dedicated AuthError class.
        assert.match(ui, /['"]Bearer\s+['"]\s*\+\s*token/, "fetchJSON should build a 'Bearer <token>' header");
        assert.match(ui, /class\s+AuthError/, "fetchJSON should throw a dedicated AuthError on 401");
        assert.match(ui, /res\.status\s*===\s*401/, "fetchJSON should branch explicitly on 401");
    });
});
//# sourceMappingURL=ui-layout-regression.test.js.map