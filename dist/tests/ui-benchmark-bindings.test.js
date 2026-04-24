/**
 * Crucible — benchmark screen binding guards
 *
 * Pins two previously-shipped bugs that regressed the focused run panel
 * and the Local/Cloud bulk selection buttons:
 *
 *   1. Clicking a different run result updated the category cards but
 *      left the big overall score badge stuck at 0%. Root cause: the
 *      /api/runs/:id/summary payload nests the score under outcome.score
 *      (and an SSE 'complete' event under score.total, score being an
 *      object), but normalizeRunForDisplay only picked top-level score
 *      fields. Hydration overwrote a correct result with overall:0.
 *
 *   2. The LOCAL and CLOUD buttons did not arm only local / only cloud
 *      models — they bypassed the selectedModels state entirely by
 *      calling handleRunKind, so the ARMED count in the UI diverged
 *      from the model set RUN actually used.
 *
 * The tests load ui/index.html's inline script into a sandboxed vm
 * context, stub browser globals, and exercise the real functions.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
const UI_PATH = join(process.cwd(), "ui", "index.html");
const uiHtml = readFileSync(UI_PATH, "utf-8");
function extractScript() {
    // The file's top-of-file license comment contains the literal text
    // "<script>" as prose, so a naive regex matches the wrong tag. Anchor
    // to a line-start <script> tag — which the real script block uses.
    const match = uiHtml.match(/^<script>\n([\s\S]*?)\n<\/script>/m);
    assert.ok(match, "ui/index.html must contain a real <script> block");
    let src = match[1];
    // Neutralize the bootstrap IIFE so loading doesn't fire network calls.
    src = src.replace(/\(async function bootstrap\(\)\{[\s\S]*?\}\)\(\);?\s*$/, "");
    return src;
}
function loadUi() {
    const script = extractScript();
    const sandbox = {
        console,
        // localStorage / document / navigator stubs — the script reads these at
        // runtime but the tests never invoke those code paths.
        window: {},
        document: { addEventListener: () => { }, body: { className: "" } },
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
    // Stub render() before the script defines it so render-on-state-change
    // is a no-op during tests. The real renderer touches the DOM.
    const prelude = `function render(){}\nvar __runBatchCalls=[];\nasync function runBatch(tabKey,taskIds,modelIds,label){__runBatchCalls.push({tabKey,taskIds:Array.from(taskIds||[]),modelIds:Array.from(modelIds||[]),label});}\n`;
    // Shadow the script's render/runBatch declarations so our stubs win.
    const withoutRender = script
        .replace(/function render\(\)\{[\s\S]*?\n\}\n/, "/* render stubbed */\n")
        .replace(/async function runBatch\(tabKey,taskIds,modelIds,label\)\{[\s\S]*?\n\}\n/, "/* runBatch stubbed */\n");
    const exporter = `\n;globalThis.__ui={normalizeRunForDisplay,selectModelBatch,allModelIdsByKind,setFocusedRun,handleRun,state,__runBatchCalls};\n`;
    const context = vm.createContext(sandbox);
    vm.runInContext(prelude + withoutRender + exporter, context, { filename: "ui/index.html::script" });
    const ui = sandbox.__ui;
    assert.ok(ui, "UI script must expose test hooks");
    // Seed a tab state so the selectors have somewhere to write.
    ui.state.tabData = ui.state.tabData || {};
    ui.state.tabData.benchmark = { selectedModels: [], selectedTasks: ["task-a"], selectedTask: "task-a", runCount: "all" };
    ui.state.focusedResult = ui.state.focusedResult || {};
    return ui;
}
describe("ui benchmark bindings: focused run overall score", () => {
    it("binds overall score from a flat /api/runs row (score + breakdown)", () => {
        const ui = loadUi();
        const row = {
            bundle_id: "b1",
            task_id: "truth_basic",
            model: "glm-4",
            provider: "zai",
            score: 87,
            pass: true,
            breakdown: { correctness: 90, regression: 85, integrity: 88, efficiency: 85 },
            tokens_in: 120,
            tokens_out: 340,
            cost_usd: 0.003,
            timestamp: "2026-04-15T00:00:00Z",
        };
        const r = ui.normalizeRunForDisplay(row);
        assert.equal(r.overall, 87, "overall should come from top-level score field");
        assert.equal(r.overallKnown, true);
        assert.equal(r.operationalRows[0].tokensIn, 120);
        assert.equal(r.operationalRows[0].cost, 0.003);
    });
    it("binds overall score from a /api/runs/:id/summary payload (outcome.score)", () => {
        const ui = loadUi();
        const summary = {
            bundle_id: "b2",
            task_id: "spec_lock",
            target: { adapter: "zai", provider: "zai", model: "glm-4-plus" },
            outcome: {
                pass: true,
                score: 72,
                score_breakdown: { correctness: 75, regression: 70, integrity: 80, efficiency: 65 },
            },
            usage: { tokens_in: 500, tokens_out: 900, estimated_cost_usd: 0.012 },
            timing: { started_at: "2026-04-15T00:00:00Z", duration_sec: 8 },
        };
        const r = ui.normalizeRunForDisplay(summary);
        assert.equal(r.overall, 72, "overall must fall back to outcome.score when top-level score is absent");
        assert.equal(r.overallKnown, true);
        assert.equal(r.operationalRows[0].tokensIn, 500, "tokens_in must fall back to usage.tokens_in");
        assert.equal(r.operationalRows[0].cost, 0.012, "cost must fall back to usage.estimated_cost_usd");
        assert.equal(r.pass, true, "pass must fall back to outcome.pass");
        assert.equal(r.model, "glm-4-plus", "model must fall back to target.model");
    });
    it("binds overall score from an SSE 'complete' payload where score is an object", () => {
        const ui = loadUi();
        // Mirrors the shape broadcast by server/routes/run.ts handleRunPost:
        // { score: bundle.score, pass, judge, target, ... } where bundle.score
        // is the full object {total, pass, breakdown}. If normalizeRunForDisplay
        // naively picked 'score' it would be an object and scorePct → NaN → 0.
        const sse = {
            bundle_id: "b3",
            task_id: "identity_probe",
            target: { adapter: "ollama", provider: "ollama", model: "qwen3.5:4b" },
            score: { total: 64, pass: false, breakdown: { correctness: 60, regression: 70, integrity: 65, efficiency: 60 } },
            pass: false,
        };
        const r = ui.normalizeRunForDisplay(sse);
        assert.equal(r.overall, 64, "overall must fall back to score.total when score is a {total, breakdown} object");
        assert.equal(r.overallKnown, true);
    });
    it("shows overallKnown=false when score is truly absent", () => {
        const ui = loadUi();
        const empty = { bundle_id: "b4", task_id: "t", model: "m" };
        const r = ui.normalizeRunForDisplay(empty);
        assert.equal(r.overallKnown, false, "overallKnown must be false when no score source exists");
    });
    it("setFocusedRun hydration path: re-normalizing an already-normalized result preserves overall", () => {
        const ui = loadUi();
        const row = {
            bundle_id: "b5",
            task_id: "truth_basic",
            model: "glm-4",
            score: 81,
            breakdown: { correctness: 80, regression: 82, integrity: 85, efficiency: 78 },
        };
        ui.setFocusedRun("benchmark", row);
        const first = ui.state.focusedResult.benchmark;
        assert.equal(first.overall, 81);
        assert.equal(first.overallKnown, true);
        // Simulate what hydrateFocusedRun does after the summary fetch returns:
        // {...already-normalized, ...summary payload}. The merge previously
        // produced overall:0 because neither side had a top-level 'score'.
        const summaryPatch = {
            outcome: { score: 81, score_breakdown: { correctness: 80, regression: 82, integrity: 85, efficiency: 78 } },
            trust: { bundle_hash_verified: true },
            judge: { label: "deterministic" },
        };
        const merged = ui.normalizeRunForDisplay({ ...first, ...summaryPatch });
        assert.equal(merged.overall, 81, "re-normalization after hydration must preserve overall (the core bug)");
        assert.equal(merged.overallKnown, true);
        assert.ok(Array.isArray(merged.categories) && merged.categories.length > 0, "category breakdown must also survive the merge");
    });
});
describe("ui benchmark bindings: Local/Cloud bulk selection", () => {
    it("local model ids come from live /api/models inventory when present", () => {
        const ui = loadUi();
        ui.state.liveModels = [
            { id: "ollama-live-a", provider: "ollama", adapter: "ollama", name: "Ollama Live A" },
            { id: "ollama-live-b", provider: "ollama", adapter: "ollama", name: "Ollama Live B" },
        ];
        const local = ui.allModelIdsByKind("local");
        assert.ok(local.includes("ollama-live-a"));
        assert.ok(local.includes("ollama-live-b"));
        assert.equal(local.includes("gemma4:e4b"), false, "fallback shortlist must not leak in when live inventory exists");
    });
    it("allModelIdsByKind returns strictly local ids for 'local'", () => {
        const ui = loadUi();
        const local = ui.allModelIdsByKind("local");
        const cloud = ui.allModelIdsByKind("cloud");
        assert.ok(local.length > 0, "there must be at least one local model in MODEL_GROUPS");
        assert.ok(cloud.length > 0, "there must be at least one cloud model in MODEL_GROUPS");
        const overlap = local.filter((id) => cloud.includes(id));
        // Arrays cross the vm context boundary, so compare by length+membership
        // instead of deepEqual (which trips on cross-realm prototype identity).
        assert.equal(overlap.length, 0, `local and cloud sets must be disjoint, got overlap: ${overlap.join(",")}`);
    });
    it("selectModelBatch('local') arms only local models", () => {
        const ui = loadUi();
        // Seed with a mixed selection so we can verify replacement, not union.
        const allCloud = ui.allModelIdsByKind("cloud");
        ui.state.tabData.benchmark.selectedModels = [allCloud[0]];
        ui.selectModelBatch("benchmark", "local");
        const armed = ui.state.tabData.benchmark.selectedModels;
        const localSet = new Set(ui.allModelIdsByKind("local"));
        assert.ok(armed.length > 0, "armed list must be non-empty after selectModelBatch");
        for (const id of armed) {
            assert.ok(localSet.has(id), `armed model ${id} should be local, not cloud`);
        }
        assert.equal(armed.length, localSet.size, "every local model must be armed");
    });
    it("selectModelBatch('cloud') arms only cloud models", () => {
        const ui = loadUi();
        ui.state.tabData.benchmark.selectedModels = [ui.allModelIdsByKind("local")[0]];
        ui.selectModelBatch("benchmark", "cloud");
        const armed = ui.state.tabData.benchmark.selectedModels;
        const cloudSet = new Set(ui.allModelIdsByKind("cloud"));
        const localSet = new Set(ui.allModelIdsByKind("local"));
        for (const id of armed) {
            assert.ok(cloudSet.has(id), `armed model ${id} should be cloud`);
            assert.ok(!localSet.has(id), `armed model ${id} must not be local`);
        }
        assert.equal(armed.length, cloudSet.size, "every cloud model must be armed");
    });
});
describe("ui benchmark bindings: run payload is single source of truth", () => {
    it("handleRun uses the armed selectedModels set when building the batch", async () => {
        const ui = loadUi();
        // Simulate user flow: click CLOUD to arm only cloud models, then RUN.
        ui.selectModelBatch("benchmark", "cloud");
        const armedAfterClick = [...ui.state.tabData.benchmark.selectedModels];
        await ui.handleRun("benchmark");
        assert.equal(ui.__runBatchCalls.length, 1, "handleRun should invoke runBatch exactly once");
        const call = ui.__runBatchCalls[0];
        // Compare by membership — arrays cross the vm context boundary, so
        // deepStrictEqual trips on Array prototype identity even when contents match.
        assert.equal(call.modelIds.length, armedAfterClick.length, "runBatch must receive exactly as many models as are armed");
        for (const id of armedAfterClick) {
            assert.ok(call.modelIds.includes(id), `runBatch payload is missing armed model ${id}`);
        }
        // And that set must be strictly cloud — no local contamination.
        const localSet = new Set(ui.allModelIdsByKind("local"));
        for (const id of call.modelIds) {
            assert.ok(!localSet.has(id), `run payload must not contain local model ${id} when CLOUD was armed`);
        }
    });
});
describe("ui benchmark bindings: button wiring source guard", () => {
    // These assertions lock in the structural invariants so a future refactor
    // can't silently re-introduce the handleRunKind bypass (which mutated
    // the run payload without touching selectedModels).
    it("LOCAL button calls selectModelBatch, not a direct run", () => {
        assert.match(uiHtml, />LOCAL<\/button>/);
        const localBtn = uiHtml.match(/<button[^>]*onclick="([^"]*)"[^>]*>LOCAL<\/button>/);
        assert.ok(localBtn, "LOCAL button must exist");
        assert.match(localBtn[1], /selectModelBatch\(.*,'local'\)/, "LOCAL button must call selectModelBatch('local')");
    });
    it("CLOUD button calls selectModelBatch, not a direct run", () => {
        const cloudBtn = uiHtml.match(/<button[^>]*onclick="([^"]*)"[^>]*>CLOUD<\/button>/);
        assert.ok(cloudBtn, "CLOUD button must exist");
        assert.match(cloudBtn[1], /selectModelBatch\(.*,'cloud'\)/, "CLOUD button must call selectModelBatch('cloud')");
    });
    it("handleRunKind is gone (the bypass that ran with all-of-kind without arming)", () => {
        assert.doesNotMatch(uiHtml, /\bhandleRunKind\b/, "handleRunKind must not be referenced anywhere — it was the source-of-truth divergence");
    });
});
//# sourceMappingURL=ui-benchmark-bindings.test.js.map