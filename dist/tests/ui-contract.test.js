import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
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
    it("has provider as primary selection control", () => {
        assert.match(ui, /id="run-provider"/);
        assert.match(ui, /providerKindLabel/);
    });
});
//# sourceMappingURL=ui-contract.test.js.map