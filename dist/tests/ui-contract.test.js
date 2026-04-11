import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
const apiSrc = readFileSync(join(process.cwd(), "server", "api.ts"), "utf-8");
describe("ui integration contract", () => {
    it("boots from the current backend catalog endpoints", () => {
        assert.match(ui, /\/api\/tasks/);
        assert.match(ui, /\/api\/adapters/);
        assert.match(ui, /\/api\/providers/);
        assert.match(ui, /\/api\/models/);
        assert.match(ui, /async function loadBootData/);
    });
    it("loads lane data from stats, leaderboard, and runs endpoints", () => {
        assert.match(ui, /\/api\/stats/);
        assert.match(ui, /\/api\/leaderboard/);
        assert.match(ui, /\/api\/runs/);
        assert.match(ui, /async function refreshTabData/);
    });
    it("starts single runs through the live run API and listens over SSE", () => {
        assert.match(ui, /\/api\/run'/);
        assert.match(ui, /new EventSource\(`\/api\/run\/\$\{encodeURIComponent\(runId\)\}\/live`\)/);
        assert.match(ui, /Run ID:/);
    });
    it("renders the current readable result surfaces", () => {
        assert.match(ui, /Readable Results, Not Mystery Dots/);
        assert.match(ui, /Focused run/);
        assert.match(ui, /Plain-English result cards/);
        assert.match(ui, /Score breakdown from the judge contract/);
        assert.match(ui, /What to do next/);
        assert.match(ui, /Detailed test results/);
        assert.match(ui, /Where this result came from/);
        assert.match(ui, /How this run was judged/);
    });
    it("includes dedicated safety and memory lanes", () => {
        assert.match(ui, /label:'Safety'/);
        assert.match(ui, /scoreFamilies:\['H'\]/);
        assert.match(ui, /taskFamilies:\['safety'\]/);
        assert.match(ui, /label:'Memory'/);
        assert.match(ui, /scoreFamilies:\['I'\]/);
        assert.match(ui, /taskFamilies:\['memory'\]/);
    });
    it("uses model-driven routing rather than a primary provider input", () => {
        assert.match(ui, /function deriveRoutingForModel/);
        assert.match(ui, /function syncRouting/);
        assert.match(ui, /<label>Adapter<\/label>/);
        assert.match(ui, /<label>Provider<\/label>/);
        assert.match(ui, /disabled>\$\{renderAdapterOptions/);
        assert.match(ui, /disabled>\$\{renderProviderOptions/);
    });
    it("supports current batch actions for a lane", () => {
        assert.match(ui, /Run selected task/);
        assert.match(ui, /Run every task here/);
        assert.match(ui, /Run local models/);
        assert.match(ui, /Run cloud models/);
        assert.match(ui, /Select local models/);
        assert.match(ui, /Select cloud models/);
        assert.match(ui, /Refresh data/);
    });
    it("api still exposes compare and suite capabilities for downstream consumers", () => {
        assert.match(apiSrc, /\/api\/compare/);
        assert.match(apiSrc, /\/api\/run-suite/);
        assert.match(apiSrc, /diagnostic_purpose/);
        assert.match(apiSrc, /qc_disagreement_rate/);
        assert.match(apiSrc, /reliability:\s*aggregate\.reliability/);
    });
});
//# sourceMappingURL=ui-contract.test.js.map