import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
const apiSrc = readFileSync(join(process.cwd(), "server", "api.ts"), "utf-8");
describe("ui integration contract", () => {
    it("loads provider truth from backend", () => {
        assert.match(ui, /\/api\/providers/);
        assert.match(ui, /providerCatalog/);
    });
    it("surfaces judge and pipeline metadata in the run screen", () => {
        assert.match(ui, /Evaluation Pipeline/);
        assert.match(ui, /id="judge-summary"/);
        assert.match(ui, /id="run-provider"/);
        assert.match(ui, /Judge:/);
    });
    it("renders a dedicated verdict chamber", () => {
        assert.match(ui, /id="verdict-chamber"/);
        assert.match(ui, /VERDICT|Verdict/);
    });
    it("result panel includes provider model adapter and review fields", () => {
        assert.match(ui, /Model Under Test/);
        assert.match(ui, /Deterministic Judge/);
        assert.match(ui, /Second Opinion/);
        assert.match(ui, /QC Review/);
        assert.match(ui, /Estimated Cost/);
        assert.match(ui, /Token Usage/);
    });
    it("has provider as primary selection control", () => {
        assert.match(ui, /id="run-provider"/);
        assert.match(ui, /providerKindLabel/);
    });
    it("sends requested run count and renders repeated-run summaries", () => {
        assert.match(ui, /count:\s*count/);
        assert.match(ui, /PASS@1/);
        assert.match(ui, /PASS@3/);
        assert.match(ui, /Repeated runs complete/);
        assert.doesNotMatch(ui, /Multi-run API batching is not available yet/);
    });
    it("api exposes compare and task metadata needed by downstream consumers", () => {
        assert.match(apiSrc, /diagnostic_purpose/);
        assert.match(apiSrc, /tags:/);
        assert.match(apiSrc, /pass_at:\s*aggregate\.pass_at/);
        assert.match(apiSrc, /reliability:\s*aggregate\.reliability/);
        assert.match(apiSrc, /qc_disagreement_rate/);
    });
});
//# sourceMappingURL=ui-contract.test.js.map