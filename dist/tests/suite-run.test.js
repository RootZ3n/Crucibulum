/**
 * Current lane-batch and backend suite contract.
 *
 * The UI currently exposes lane-level batch actions rather than a dedicated
 * full-suite button, while the backend still provides /api/run-suite for
 * downstream and future UI callers.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
const apiSrc = readFileSync(join(process.cwd(), "server", "api.ts"), "utf-8");
describe("lane batch runs and suite backend", () => {
    describe("current UI batch controls", () => {
        it("renders lane batch actions instead of the retired suite button UI", () => {
            assert.match(ui, /Run selected task/);
            assert.match(ui, /Run every task here/);
            assert.match(ui, /Run local models/);
            assert.match(ui, /Run cloud models/);
            assert.doesNotMatch(ui, /run-suite-btn/);
        });
        it("implements lane and model-kind batch handlers", () => {
            assert.match(ui, /async function runBatch/);
            assert.match(ui, /async function handleRunAll/);
            assert.match(ui, /async function handleRunKind/);
        });
        it("requires a task set and model set before batch execution", () => {
            assert.match(ui, /No tasks in this lane/);
            assert.match(ui, /Select one or more models first/);
        });
        it("updates the live log while batch runs execute", () => {
            assert.match(ui, /Queued \$\{taskId\} on \$\{modelId\}/);
            assert.match(ui, /Batch complete\./);
            assert.match(ui, /Live progress/);
        });
    });
    describe("backend suite endpoint", () => {
        it("still exposes /api/run-suite for downstream callers", () => {
            assert.match(apiSrc, /\/api\/run-suite.*POST/);
            assert.match(apiSrc, /\/api\/run-suite\/.*\/status/);
        });
        it("uses the discovered task list to execute the whole benchmark", () => {
            assert.match(apiSrc, /const allTasks = listTaskDetails\(\)/);
            assert.match(apiSrc, /for \(const task of allTasks\)/);
        });
        it("stores each resulting bundle and computes a suite summary", () => {
            assert.match(apiSrc, /storeBundle\(result\.bundle\)/);
            assert.match(apiSrc, /suite\.summary = \{/);
            assert.match(apiSrc, /pass_rate:/);
            assert.match(apiSrc, /avg_score:/);
            assert.match(apiSrc, /total_tokens:/);
            assert.match(apiSrc, /total_cost_usd:/);
        });
        it("preserves adapter and provider identity through suite execution", () => {
            assert.match(apiSrc, /const adapterId = body\.adapter \|\| body\.providerId \|\| ""/);
            assert.match(apiSrc, /adapter: adapterId/);
            assert.match(apiSrc, /provider: body\.provider \?\? null/);
        });
    });
});
//# sourceMappingURL=suite-run.test.js.map