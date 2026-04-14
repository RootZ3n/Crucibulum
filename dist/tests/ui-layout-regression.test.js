/**
 * Crucibulum — UI layout regression guard
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
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
function findRule(selector) {
    // Match `<selector>{...}` — the UI uses a compact style block.
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "m");
    const match = ui.match(re);
    assert.ok(match, `expected CSS rule for selector "${selector}" to exist in ui/index.html`);
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
//# sourceMappingURL=ui-layout-regression.test.js.map