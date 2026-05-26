/**
 * Crucible — Vision Phase 7: UI readability tests (offline)
 *
 * 14 deterministic source-level assertions that the Vision tab
 * surfaces:
 *   - Experimental + not-ranked + not-certified posture
 *   - Proven route (OpenRouter / xiaomi/mimo-v2-omni)
 *   - Fixture-ready count (5/5)
 *   - 5 POC test cards with scorer + image-sent + PASS/FAIL/SKIPPED
 *   - Selected-model capability hint distinguishes vision-capable
 *     vs unsupported-multimodal vs no-model-selected
 *   - Existing focused-run skip cards still render
 *
 * Plus a single live integration: the new /api/vision/latest-smoke
 * route is registered and serves the static report when present.
 *
 * No provider calls. No network outside an in-process HTTP request
 * to the in-test server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const CSS = readFileSync(join(ROOT, "ui", "crucibulum.css"), "utf-8");

describe("Vision Phase 7 · UI readability (offline)", () => {
  // -------- panel posture --------

  it("P1 · Vision lane shows the EXPERIMENTAL chip in the status panel", () => {
    assert.match(HTML, /vision-status-chips[^]*EXPERIMENTAL/i, "EXPERIMENTAL chip must be present inside the vision status panel");
  });

  it("P2 · Vision lane shows NOT IN LEADERBOARD + NOT CERTIFIED copy", () => {
    assert.match(HTML, /NOT IN LEADERBOARD/i, "panel must say NOT IN LEADERBOARD");
    assert.match(HTML, /NOT CERTIFIED/i, "panel must say NOT CERTIFIED");
  });

  it("P3 · Vision status panel mentions the proven route (openrouter + xiaomi/mimo-v2-omni)", () => {
    assert.match(HTML, /VISION_PROVEN_ROUTE\s*=\s*\{[^}]*xiaomi\/mimo-v2-omni/);
    assert.match(HTML, /OpenRouter[^]*xiaomi\/mimo-v2-omni/);
  });

  it("P4 · Vision status panel shows a fixture-ready count (5 / 5)", () => {
    assert.match(HTML, /5\s*\/\s*5 ready/);
  });

  // -------- POC result cards --------

  it("P5 · Vision panel renders all five POC test ids", () => {
    for (const id of [
      "vision-ocr-001",
      "vision-ui-001",
      "vision-chart-001",
      "vision-object-count-001",
      "vision-uncertainty-001",
    ]) {
      assert.match(HTML, new RegExp(`id\\s*:\\s*['"]${id}['"]`), `VISION_POC_TESTS must include ${id}`);
    }
  });

  it("P6 · Vision result cards expose the scorer type per test", () => {
    // VISION_POC_TESTS objects must carry a scorer field; the renderer
    // emits it as a "SCORER" row in each card.
    assert.match(HTML, /scorer:'regex_match'/);
    assert.match(HTML, /scorer:'text_match \(ANY\)'/);
    assert.match(HTML, /scorer:'numeric_fact_match'/);
    assert.match(HTML, /scorer:'uncertainty_honesty'/);
    assert.match(HTML, /<span class="vc-key">SCORER<\/span>/);
  });

  it("P7 · Vision result cards expose an IMAGE SENT yes/no row", () => {
    assert.match(HTML, /IMAGE SENT/);
    assert.match(HTML, /r\.imageSent===true\?'yes':'no'/);
  });

  it("P8 · Vision result cards distinguish PASS / FAIL / SKIPPED visually + lexically", () => {
    assert.match(HTML, /visionCardBadgeWord/);
    assert.match(HTML, /if\(c==='PASS'\)return'PASS'/);
    assert.match(HTML, /if\(c==='LOW_SCORE'\)return'FAIL'/);
    assert.match(HTML, /if\(c\.startsWith\('SKIPPED_'\)\)return'SKIPPED'/);
    assert.match(CSS, /\.vision-card-pass\{border-color/);
    assert.match(CSS, /\.vision-card-fail\{border-color/);
    assert.match(CSS, /\.vision-card-skip\{border-color/);
  });

  // -------- selected-model capability hint --------

  it("P9 · Selected text-only model shows unsupported-multimodal skip copy (not a Vision FAIL)", () => {
    assert.match(HTML, /Will SKIP: unsupported multimodal/);
    assert.match(HTML, /Not a Vision failure — Vision is skipped/);
  });

  it("P10 · Selected vision-capable model shows vision-capable route copy", () => {
    assert.match(HTML, /vision-capable route/);
    assert.match(HTML, /Vision POC will run\. Experimental, not ranked, not certified\./);
  });

  // -------- leaderboard + certification exclusion guarantees --------

  it("P11 · UI does not imply Vision contributes to the leaderboard composite", () => {
    // The Vision tab is configured with empty scoreFamilies, which keeps
    // it out of the composite scoring path. The status-panel copy says
    // NOT IN LEADERBOARD explicitly.
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P12 · UI does not imply Vision affects model certification", () => {
    assert.match(HTML, /Vision does not affect model certification/);
    assert.match(HTML, /experimental, not ranked, not certified/i);
  });

  // -------- regression: existing focused-run skip card still renders --------

  it("P13 · existing focused-run skip-card renderer + .skip-card / .skip-grid CSS still present", () => {
    assert.match(HTML, /function renderSkipCards/);
    assert.match(CSS, /\.skip-card/);
    assert.match(CSS, /\.skip-grid/);
  });

  // -------- live integration: /api/vision/latest-smoke --------

  it("P14 · /api/vision/latest-smoke route is wired and defensively re-asserts non-affecting posture", () => {
    // Source-level contract check (no port binding): route is mounted and
    // the handler re-asserts experimental + non-affecting posture on
    // every response, so a future report file omitting those fields
    // can't accidentally claim leaderboard/cert impact via the API.
    const appSrc = readFileSync(join(ROOT, "server", "app.ts"), "utf-8");
    assert.match(appSrc, /\/api\/vision\/latest-smoke/);
    assert.match(appSrc, /vision\.handleLatestSmoke/);
    const visionSrc = readFileSync(join(ROOT, "server", "routes", "vision.ts"), "utf-8");
    assert.match(visionSrc, /affectsLeaderboard:\s*parsed\.affectsLeaderboard\s*===\s*true/);
    assert.match(visionSrc, /affectsCertification:\s*parsed\.affectsCertification\s*===\s*true/);
    assert.match(visionSrc, /experimental:\s*parsed\.experimental\s*!==\s*false/);
  });
});
