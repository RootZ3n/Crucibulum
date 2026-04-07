/**
 * Tests for Run Full Suite feature:
 * - Button renders in UI
 * - Distinct from Run Evaluation
 * - Works without selected task
 * - Suite payload shape
 * - Suite results summary
 * - Mobile layout
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
const apiSrc = readFileSync(join(process.cwd(), "server", "api.ts"), "utf-8");
describe("Run Full Suite", () => {
    // ── Button rendering ───────────────────────────────────────────────
    describe("button rendering", () => {
        it("Run Full Suite button exists in UI", () => {
            assert.match(ui, /id="run-suite-btn"/);
        });
        it("Run Evaluation button still exists", () => {
            assert.match(ui, /id="run-btn"/);
        });
        it("both buttons are in the same container", () => {
            assert.match(ui, /run-btn-container[\s\S]*?run-btn[\s\S]*?run-suite-btn/);
        });
        it("Run Full Suite button has onclick handler", () => {
            assert.match(ui, /onclick="startSuiteRun\(\)"/);
        });
        it("Run Full Suite button has correct label", () => {
            assert.match(ui, /RUN FULL SUITE/);
        });
        it("Run Full Suite has distinct CSS class", () => {
            assert.match(ui, /run-btn-suite/);
        });
        it("action area is sticky and deliberate", () => {
            assert.match(ui, /\.run-btn-container[\s\S]*?position:\s*sticky/);
            assert.match(ui, /Action Chamber/);
        });
    });
    // ── Distinct behavior ──────────────────────────────────────────────
    describe("distinct actions", () => {
        it("startRun requires task selection", () => {
            assert.match(ui, /startRun[\s\S]*?Select a task/);
        });
        it("startSuiteRun does not require task selection", () => {
            // startSuiteRun should validate provider+model but NOT task
            const suiteFunc = ui.slice(ui.indexOf("async function startSuiteRun"), ui.indexOf("async function startSuiteRun") + 2000);
            assert.doesNotMatch(suiteFunc, /Select a task/);
            assert.match(suiteFunc, /Select a provider/);
            assert.match(suiteFunc, /Enter a model/);
        });
        it("startSuiteRun calls /api/run-suite endpoint", () => {
            assert.match(ui, /\/api\/run-suite/);
        });
        it("startRun calls /api/run endpoint", () => {
            assert.match(ui, /\/api\/run'/);
        });
        it("startRun forwards requested repeat count instead of blocking it", () => {
            assert.match(ui, /count:\s*count/);
            assert.doesNotMatch(ui, /Multi-run API batching is not available yet/);
        });
    });
    // ── Disabled states ────────────────────────────────────────────────
    describe("disabled states", () => {
        it("Run Evaluation disabled without task", () => {
            // runBtn.disabled = !hasTask || !providerReady || !hasModel
            assert.match(ui, /runBtn\.disabled\s*=\s*!hasTask/);
        });
        it("Run Full Suite enabled without task but needs provider+model", () => {
            // suiteBtn.disabled = !providerReady || !hasModel
            assert.match(ui, /suiteBtn\.disabled\s*=\s*!providerReady/);
            const suiteLine = ui.match(/suiteBtn\.disabled\s*=[^;]+/);
            assert.ok(suiteLine);
            assert.doesNotMatch(suiteLine[0], /hasTask/);
        });
    });
    // ── Backend suite endpoint ─────────────────────────────────────────
    describe("backend /api/run-suite", () => {
        it("endpoint handler exists", () => {
            assert.match(apiSrc, /\/api\/run-suite.*POST/);
        });
        it("accepts model and adapter/providerId", () => {
            assert.match(apiSrc, /body\.model/);
            assert.match(apiSrc, /body\.adapter \|\| body\.providerId/);
        });
        it("runs all tasks from listTaskDetails", () => {
            assert.match(apiSrc, /listTaskDetails\(\)/);
            assert.match(apiSrc, /for.*task.*allTasks/);
        });
        it("stores bundles for each task", () => {
            assert.match(apiSrc, /storeBundle\(result\.bundle\)/);
        });
        it("computes suite summary with pass_rate and avg_score", () => {
            assert.match(apiSrc, /pass_rate/);
            assert.match(apiSrc, /avg_score/);
        });
        it("status endpoint exists", () => {
            assert.match(apiSrc, /\/api\/run-suite\/.*\/status/);
        });
        it("returns results array and summary", () => {
            assert.match(apiSrc, /results:\s*suite\.results/);
            assert.match(apiSrc, /summary:\s*suite\.summary/);
        });
        it("preserves explicit provider identity through suite execution", () => {
            assert.match(apiSrc, /provider:\s*body\.provider \?\? null/);
        });
    });
    // ── Suite results rendering ────────────────────────────────────────
    describe("suite results rendering", () => {
        it("shows pass/fail/pass-rate summary tiles", () => {
            assert.match(ui, /PASSED[\s\S]*?FAILED[\s\S]*?PASS RATE/);
        });
        it("shows total tokens and cost", () => {
            assert.match(ui, /Total tokens/i);
            assert.match(ui, /Total cost/i);
        });
        it("shows total tasks and average score", () => {
            assert.match(ui, /Tasks:/);
            assert.match(ui, /Avg score:/);
        });
        it("shows per-task results in log", () => {
            assert.match(ui, /suite-task-result/);
        });
        it("links suite completion to a follow-up surface", () => {
            assert.match(ui, /View run history/);
        });
        it("resets buttons after suite completion", () => {
            assert.match(ui, /resetRunBtn/);
        });
    });
    // ── Mobile layout ──────────────────────────────────────────────────
    describe("mobile layout", () => {
        it("buttons stack vertically on mobile", () => {
            assert.match(ui, /\.run-btn-container[\s\S]*?flex-direction:\s*column/);
        });
        it("suite button has reduced font size on mobile", () => {
            assert.match(ui, /\.run-btn-suite[\s\S]*?font-size:\s*12px/);
        });
        it("action area stays stacked on mobile", () => {
            assert.match(ui, /\.run-action-copy/);
        });
    });
    // ── Suite payload includes review config ───────────────────────────
    describe("review config in suite", () => {
        it("suite payload can include secondOpinion config", () => {
            assert.match(ui, /startSuiteRun[\s\S]*?secondOpinion/);
        });
        it("suite payload can include qcReview config", () => {
            assert.match(ui, /startSuiteRun[\s\S]*?qcReview/);
        });
    });
});
//# sourceMappingURL=suite-run.test.js.map