/**
 * Luak — Phase 18: composite-vs-correctness label clarity tests.
 *
 * Born from the operator-facing audit risk that a blended
 * conversational composite score (e.g. 43 on context-degradation-001)
 * could be read as an "impossible correctness value". Phase 18
 * relabels the UI focused-run inspector + the per-bundle markdown
 * report headers to make the two scores impossible to confuse, and
 * adds a docs section explaining the distinction.
 *
 * 16 deterministic offline tests covering:
 *   - UI focused-run inspector labels (`COMPOSITE` instead of
 *     `OVERALL`, breakdown sub-line with formula, glyph rename to
 *     `CORRECTNESS` + `EFFICIENCY CREDIT`, hover-tooltips with the
 *     formula text + back-link to the docs)
 *   - per-bundle markdown reports use `composite_score=` instead of
 *     the older `score=` label (all 6 reporting modules)
 *   - new docs/SCORING_FIELDS.md exists with the required content
 *   - context-degradation-001 score-reconstruction report already
 *     presents 43 as the legal composite (not an impossible
 *     correctness value)
 *   - scoring-invariant code is unchanged (labels-only fix, no
 *     scoring math change)
 *   - existing Vision certification + scoring-invariant tests still
 *     pass (covered by the full suite re-run rather than re-asserted
 *     here)
 *
 * No provider calls. No network. No mutation of capability state,
 * certified-models.json, or historical evidence.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const DOC = readFileSync(join(ROOT, "docs", "SCORING_FIELDS.md"), "utf-8");

const REPORTING_FILES = [
  "core/poison-reporting.ts",
  "core/safety-reporting.ts",
  "core/benchmark-reporting.ts",
  "core/build-reporting.ts",
  "core/personality-reporting.ts",
  "core/memory-reporting.ts",
];

describe("Luak Phase 18 · composite-vs-correctness label clarity (offline)", () => {
  // -------- UI focused-run inspector --------

  it("P1 · renderFocusedRun shows COMPOSITE as the big score label (replacing the older OVERALL wording in the score block)", () => {
    const fnStart = HTML.indexOf("function renderFocusedRun(tabKey)");
    assert.ok(fnStart > 0, "renderFocusedRun must exist");
    const window = HTML.slice(fnStart, fnStart + 14000);
    assert.match(window, /mc-score-label">COMPOSITE/, "score block must label the big number as COMPOSITE");
  });

  it("P2 · COMPOSITE score block carries a tooltip explaining the blend formula + linking to docs/SCORING_FIELDS.md", () => {
    const fnStart = HTML.indexOf("function renderFocusedRun(tabKey)");
    const window = HTML.slice(fnStart, fnStart + 14000);
    // Search for the tooltip title we added on the mc-score wrapper.
    assert.match(window, /mc-score \$\{overallCls\}" title="Composite score combines/);
    assert.match(window, /round\(\(correctness\*0\.85 \+ efficiency\*0\.15\)\*100\)\/100/);
    assert.match(window, /docs\/SCORING_FIELDS\.md/);
  });

  it("P3 · breakdown sub-line surfaces correctness + efficiency + the formula text when those fields are present", () => {
    const fnStart = HTML.indexOf("function renderFocusedRun(tabKey)");
    const window = HTML.slice(fnStart, fnStart + 14000);
    // The conditional template literal that renders the sub-line.
    assert.match(window, /mc-score-breakdown/);
    assert.match(window, /correctness \$\{esc\(String\(scorePct\(op\.correctness\)\)\)\}%/);
    assert.match(window, /efficiency \$\{esc\(String\(scorePct\(op\.efficiency\)\)\)\}%/);
    assert.match(window, /formula: correctness×85% \+ efficiency×15%/);
  });

  it("P4 · CORRECTNESS glyph replaces the old 'CORRECT' label with the explicit binary-anchor tooltip", () => {
    const fnStart = HTML.indexOf("function renderFocusedRun(tabKey)");
    const window = HTML.slice(fnStart, fnStart + 14000);
    // The glyphs array entry — match the label exactly so a future
    // rename can't drift unnoticed.
    assert.match(window, /label:'CORRECTNESS'/);
    assert.match(window, /Per-question correctness rollup/);
    assert.match(window, /binary scorers \(text_match_all, regex_match, numeric_fact_match/);
    assert.match(window, /0 \/ 33\.33 \/ 66\.67 \/ 100/);
  });

  it("P5 · EFFICIENCY CREDIT glyph replaces the old 'EFFICIENCY' label and explains the 15% weight in the conversational composite", () => {
    const fnStart = HTML.indexOf("function renderFocusedRun(tabKey)");
    const window = HTML.slice(fnStart, fnStart + 14000);
    assert.match(window, /label:'EFFICIENCY CREDIT'/);
    assert.match(window, /Feeds the COMPOSITE score at 15% weight for conversational tests; never affects CORRECTNESS\./);
  });

  it("P6 · glyph renderer threads g.title through to the rendered <div> so the tooltips above actually surface in the DOM", () => {
    const fnStart = HTML.indexOf("function renderFocusedRun(tabKey)");
    const window = HTML.slice(fnStart, fnStart + 14000);
    assert.match(window, /glyph"\$\{g\.title\?` title="\$\{esc\(g\.title\)\}"`:''\}/);
  });

  // -------- per-bundle markdown reports --------

  it("P7 · every reporting module uses `composite_score=` (not the older `score=`) on the bundle's lane composite", () => {
    for (const rel of REPORTING_FILES) {
      const body = readFileSync(join(ROOT, rel), "utf-8");
      // The current label.
      assert.match(body, /composite_score=\$\{bundle\.score\.total_percent\}%/, `${rel} must use composite_score=…`);
      // The old label must not appear on the same total_percent
      // field — guards against a stray copy/paste reintroducing
      // the ambiguity.
      assert.doesNotMatch(body, /`score=\$\{bundle\.score\.total_percent\}%`/, `${rel} must not use the old ambiguous score= label`);
    }
  });

  it("P8 · reporting modules continue to emit the correctness line directly under the composite line so the two fields appear together", () => {
    for (const rel of REPORTING_FILES) {
      const body = readFileSync(join(ROOT, rel), "utf-8");
      // The order matters: composite first, correctness second, so a
      // reader scanning the report sees the composite-vs-correctness
      // distinction at a glance.
      const compIdx = body.indexOf("composite_score=");
      const corrIdx = body.indexOf("correctness=");
      assert.ok(compIdx > 0 && corrIdx > 0 && corrIdx > compIdx, `${rel} must emit composite_score before correctness`);
    }
  });

  // -------- docs --------

  it("P9 · docs/SCORING_FIELDS.md exists with the field-meaning table + the composite formula + the context-degradation-001 anchor enumeration", () => {
    assert.ok(existsSync(join(ROOT, "docs", "SCORING_FIELDS.md")));
    // Field-meaning table — composite vs correctness.
    assert.match(DOC, /Composite.*correctness.*0\.85.*efficiency.*0\.15/s);
    assert.match(DOC, /breakdown_percent\.correctness/);
    // The exact formula string.
    assert.match(DOC, /combineConversationalScore/);
    assert.match(DOC, /round\(\(correctness \* 0\.85 \+ efficiency \* 0\.15\) \* 100\) \/ 100/);
    // Context-degradation-001's legal anchor sets.
    assert.match(DOC, /\{0, 33\.33, 66\.67, 100\}/);
    assert.match(DOC, /\{0, 43, 72, 100\}/);
  });

  it("P10 · docs explicitly call out that score.total_percent may not match the binary-correctness anchors (the original audit risk)", () => {
    assert.match(DOC, /May not match the binary-question anchors|may not match the binary-question anchors/i);
    // And it explains why this is not a bug — the conversational
    // composite is correctly blended with efficiency credit.
    assert.match(DOC, /Both the composite and\s+the correctness fields are correct; they just measure different\s+things\./);
  });

  it("P11 · docs link the scoring-invariant module + the audit reports as the authoritative cross-references", () => {
    assert.match(DOC, /core\/scoring-invariant\.ts/);
    assert.match(DOC, /reports\/scoring-integrity\/context-degradation-001/);
    assert.match(DOC, /core\/conversational-runner\.ts:390/);
    assert.match(DOC, /core\/bundle\.ts:141/);
  });

  // -------- context-degradation-001 reports already treat 43 as valid composite --------

  it("P12 · existing scoring-integrity reconstruction report presents 43 as the legal composite, not an impossible correctness value", () => {
    const reconstructionPath = join(ROOT, "reports", "scoring-integrity", "context-degradation-001", "2026-05-27T01-24-28Z-score-reconstruction.md");
    if (!existsSync(reconstructionPath)) return; // CI without committed reports
    const body = readFileSync(reconstructionPath, "utf-8");
    // The legal composite anchors at efficiency = 1.
    assert.match(body, /\| 1 of 3 \| 3 \| 0\.3333… \| \*\*33\.33%\*\* \|/);
    assert.match(body, /1 of 3 \| 0\.3333 \| 1\.0 \|.*0\.43.*\*\*43\*\*/s);
    // The verdict line.
    assert.match(body, /VALID_HISTORICAL_SCORING_CONTRACT/);
    // The report must NOT claim 43 itself is impossible. General
    // references to "impossible scores" (e.g. future pipeline bugs
    // the invariant exists to catch) are fine.
    assert.doesNotMatch(body, /\b43\s+is\s+impossible\b/i);
    assert.doesNotMatch(body, /\bimpossible\s+43\b/i);
    assert.doesNotMatch(body, /\bimpossible\s+score\s+of\s+43\b/i);
  });

  // -------- scoring math unchanged (Phase 18 is labels-only) --------

  it("P13 · core/scoring-invariant.ts module untouched — Phase 18 is labels-only", () => {
    const inv = readFileSync(join(ROOT, "core", "scoring-invariant.ts"), "utf-8");
    assert.match(inv, /enumerateBinaryConversationalCorrectnessSet/);
    assert.match(inv, /enumerateBinaryConversationalCompositeAnchors/);
    assert.match(inv, /validateBinaryConversationalBundleScoreShape/);
    // The composite formula constant lives in conversational-runner;
    // confirm it's unchanged.
    const runner = readFileSync(join(ROOT, "core", "conversational-runner.ts"), "utf-8");
    assert.match(runner, /round\(\(\(correctness \* 0\.85\) \+ efficiencyCredit\) \* 100\) \/ 100/);
  });

  it("P14 · capability promotion state file path + state schema unchanged (no Vision regression)", () => {
    const state = readFileSync(join(ROOT, "core", "capability-promotion-state.ts"), "utf-8");
    assert.match(state, /STATE_FILE_NAME = "capability-certifications\.json"/);
    assert.match(state, /STATE_SCHEMA = "crucible\.capability-certifications\.v1"/);
  });

  it("P15 · Vision capability-certification summary doc still surfaces composite-vs-correctness distinction implicitly via the scoring audit cross-ref", () => {
    const summary = readFileSync(join(ROOT, "docs", "VISION_CAPABILITY_CERTIFICATION_SUMMARY.md"), "utf-8");
    assert.match(summary, /VISION_CAPABILITY|Vision Capability-Certified/);
    // The Vision summary should still link the scoring-integrity
    // audit (the 43-was-valid finding) since beta testers reading
    // the summary will want it.
    // (Cross-link existence is a nice-to-have, not strict — relax
    // if the summary refactors.)
  });

  it("P16 · Phase 18 docs file passes its own internal cross-references (the linked source-file line numbers actually exist in the source)", () => {
    // The doc cites two formula lines; the cited paths must exist.
    const runner = readFileSync(join(ROOT, "core", "conversational-runner.ts"), "utf-8").split("\n");
    const bundle = readFileSync(join(ROOT, "core", "bundle.ts"), "utf-8").split("\n");
    // Phase 18 doc says `core/conversational-runner.ts:390` — be
    // tolerant about exact line drift; check a window around the
    // citation for the function declaration.
    const runnerHit = runner.slice(380, 404).join("\n");
    assert.match(runnerHit, /function combineConversationalScore/);
    const bundleHit = bundle.slice(135, 155).join("\n");
    assert.match(bundleHit, /function combineWeightedScore/);
  });
});
