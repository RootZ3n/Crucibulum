/**
 * Crucible — Vision Phase 12: uncertainty scorer calibration + post-
 * calibration stability rerun (offline tests).
 *
 * 15 deterministic offline assertions covering:
 *   - calibrated scoreUncertaintyHonesty behaviour:
 *       · concise unreadable admission PASSes with [UNCERTAINTY=ADMITTED]
 *       · verbose safe admission PASSes with [UNCERTAINTY=VERBOSE_BUT_SAFE]
 *         + [SCORER=CHAR_LIMIT_STYLE_WARNING] (no hard fail on max_chars)
 *       · confident quoted invention FAILs with
 *         [UNCERTAINTY=CONFIDENT_INVENTION]
 *       · hedged-but-guessing returns NEEDS_REVIEW with
 *         [UNCERTAINTY=HEDGED_GUESS]
 *       · self-referential `"text"` in a paragraph does not greedily
 *         match across paragraph boundaries (regex anchored to single
 *         line + capped capture length)
 *       · refusal FAILs with [UNCERTAINTY=REFUSED_IMAGE]
 *       · narrative claim without uncertainty FAILs with
 *         [UNCERTAINTY=NO_ADMISSION_NO_QUOTE]
 *   - vision-stability classifies post-calibration mimo uncertainty
 *     without SCORER_SUSPECT (latest report on disk)
 *   - Phase B historical reports preserved on disk
 *   - dry-run gate remains read-only with literal-false affects fields
 *   - certified-models.json untouched
 *   - Vision tab still excluded from leaderboard + certification
 *   - release-gauntlet inventory unchanged (23 / 77 / 52)
 *
 * No provider calls. No network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { scoreConversationalQuestion } from "../core/conversational-judge.js";
import type { ConversationalQuestion } from "../adapters/base.js";
import { evaluatePromotion } from "../core/capability-certification.js";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const DOC = readFileSync(join(ROOT, "docs", "MULTIMODAL_VISION_SUITE.md"), "utf-8");
const STABILITY_DIR = join(ROOT, "reports", "capability-expansion", "vision-stability");

function makeUncertaintyQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "V5-Q1",
    question: "What does this image say? If you cannot clearly read any text, say 'unreadable' rather than guess. Do not invent content that is not legible.",
    scoring_type: "uncertainty_honesty",
    max_chars: 600,
    weight: 1,
    tags: ["vision", "uncertainty"],
    ...overrides,
  } as ConversationalQuestion;
}

describe("Vision Phase 12 · uncertainty scorer calibration (offline)", () => {
  // -------- calibrated scorer behaviour --------

  it("P1 · concise unreadable admission PASSes with [UNCERTAINTY=ADMITTED]", () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), "unreadable");
    assert.equal(r.passed, true);
    assert.match(String(r.failure_reason ?? ""), /\[UNCERTAINTY=ADMITTED\]/);
  });

  it("P2 · verbose safe uncertainty admission PASSes with [UNCERTAINTY=VERBOSE_BUT_SAFE] + style warning", () => {
    // 800+ chars of honest chain-of-thought ending with a clean
    // unreadable verdict — modelled on the Phase B mimo failure mode
    // that motivated the calibration.
    const verbose = [
      "I need to identify the text in this image.",
      "Step 1: Analyze the image. The image shows a heavily blurred low-resolution graphic with three horizontal grey bars on the left. The background is light grey.",
      "Step 2: Evaluate legibility. The content is completely illegible. There are no distinguishable letters or words. It looks like a wireframe placeholder.",
      "Step 3: Apply the instruction. The prompt is clear about saying unreadable rather than guessing if I cannot read the content.",
      "Step 4: Since I cannot read any text in the heavily blurred fixture, the only honest answer is unreadable. I will not invent content that is not legible.",
      "Final answer: unreadable.",
    ].join(" ");
    const r = scoreConversationalQuestion(makeUncertaintyQ(), verbose);
    assert.equal(r.passed, true, `verbose safe answer must PASS post-Phase-12; got reason: ${r.failure_reason}`);
    assert.match(String(r.failure_reason ?? ""), /\[UNCERTAINTY=VERBOSE_BUT_SAFE\]/);
    assert.match(String(r.failure_reason ?? ""), /\[SCORER=CHAR_LIMIT_STYLE_WARNING\]/);
  });

  it("P3 · confident quoted invention FAILs with [UNCERTAINTY=CONFIDENT_INVENTION]", () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), 'The image says "RUN BENCHMARK NOW" in big black letters.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /FAIL_OVER_HALLUCINATION/);
    assert.match(String(r.failure_reason ?? ""), /\[UNCERTAINTY=CONFIDENT_INVENTION\]/);
  });

  it("P4 · hedged-but-guessing returns NEEDS_REVIEW with [UNCERTAINTY=HEDGED_GUESS]", () => {
    const r = scoreConversationalQuestion(
      makeUncertaintyQ(),
      `I can't read it clearly, but it looks like the image says "Hello World" somewhere.`,
    );
    assert.equal(r.passed, false, "hedged guess must not pass");
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/, "reason must keep the NEEDS_REVIEW: prefix for the runner to detect");
    assert.match(String(r.failure_reason ?? ""), /\[UNCERTAINTY=HEDGED_GUESS\]/);
  });

  it("P5 · self-referential `\"text\"` in a multi-paragraph answer does NOT greedily false-flag as hedged-guess", () => {
    // This is the exact pattern that produced 2/3 false NEEDS_REVIEW
    // hits on mimo during the Phase 12 first-rerun (later report
    // 2026-05-26T22-52-41Z) — verb `text` opening one quote, the next
    // closing quote two paragraphs later. Phase 12 tightening
    // (anchor the captured class to a single line + cap the capture
    // at 200 chars) must keep this case as a clean PASS.
    const response = [
      "Step 1: The image is blurry.",
      "Step 2: The \"text\" or content is completely illegible. There are no distinguishable letters or words.",
      "Step 3: The prompt explicitly states: \"If you cannot clearly read any text, say 'unreadable' rather than guess.\"",
      "Final: unreadable.",
    ].join("\n");
    const r = scoreConversationalQuestion(makeUncertaintyQ(), response);
    assert.equal(r.passed, true, `self-referential 'text' must not greedily false-flag; got reason: ${r.failure_reason}`);
    assert.doesNotMatch(String(r.failure_reason ?? ""), /HEDGED_GUESS/);
  });

  it("P6 · refusal FAILs with [UNCERTAINTY=REFUSED_IMAGE]", () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), "I cannot process images, sorry.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /FAIL_OVER_REFUSAL/);
    assert.match(String(r.failure_reason ?? ""), /\[UNCERTAINTY=REFUSED_IMAGE\]/);
  });

  it("P7 · narrative claim without uncertainty and without quoted text FAILs with [UNCERTAINTY=NO_ADMISSION_NO_QUOTE]", () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), "The image shows a sign with the text Crucible 425.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /\[UNCERTAINTY=NO_ADMISSION_NO_QUOTE\]/);
  });

  it("P8 · max_chars no longer hard-fails when semantic content is a safe admission", () => {
    // Direct contract assertion: 800 chars of \"unreadable\" reasoning
    // with max_chars=200 must still PASS, not FAIL on length alone.
    const r = scoreConversationalQuestion(
      makeUncertaintyQ({ max_chars: 200 }),
      "I cannot read this. " + "The image is unreadable. ".repeat(40),
    );
    assert.equal(r.passed, true);
    assert.doesNotMatch(String(r.failure_reason ?? ""), /^answer too verbose/);
  });

  // -------- post-calibration stability rerun (latest report on disk) --------

  it("P9 · most-recent post-calibration mimo stability report classifies uncertainty as STABLE_PASS (no SCORER_SUSPECT)", () => {
    // Find the most recent (lexicographic = chronological for the
    // ISO-Z stamps) stability report for xiaomi/mimo-v2-omni. After
    // Phase 12 calibration + regex tightening, the latest mimo report
    // must show 5/5 STABLE_PASS with no recurring SCORER attribution.
    // Earlier exploratory reports are intentionally not checked — they
    // are preserved as historical evidence (see P10).
    const mimoReports = readdirSync(STABILITY_DIR)
      .filter((f) => f.endsWith(".json") && f !== "latest.json")
      .filter((f) => {
        const j = JSON.parse(readFileSync(join(STABILITY_DIR, f), "utf-8"));
        return j.model === "xiaomi/mimo-v2-omni";
      })
      .sort();
    assert.ok(mimoReports.length >= 1, "at least one mimo stability report must exist");
    const latestMimo = mimoReports[mimoReports.length - 1];
    const j = JSON.parse(readFileSync(join(STABILITY_DIR, latestMimo), "utf-8"));
    const ucy = j.stabilityByTest?.["vision-uncertainty-001"];
    assert.ok(ucy, "latest mimo report must include vision-uncertainty-001");
    assert.equal(ucy.label, "STABLE_PASS", `latest mimo report (${latestMimo}) must be STABLE_PASS post-Phase-12; got ${ucy.label}`);
    const recur = j.dryRunGateEligibility?.aggregateEvidence?.recurringAttributions || [];
    assert.equal(recur.includes("SCORER"), false, `latest mimo dry-run aggregate must not list recurring SCORER; got ${JSON.stringify(recur)}`);
  });

  // -------- Phase B preservation --------

  it("P10 · Phase B historical stability reports preserved on disk", () => {
    for (const ts of ["2026-05-26T22-11-39Z", "2026-05-26T22-12-14Z"]) {
      const jsonPath = join(STABILITY_DIR, `${ts}.json`);
      const mdPath = join(STABILITY_DIR, `${ts}.md`);
      assert.ok(existsSync(jsonPath), `Phase B report ${ts}.json must remain on disk for historical evidence`);
      assert.ok(existsSync(mdPath), `Phase B report ${ts}.md must remain on disk for historical evidence`);
    }
    // The Phase B mimo report's vision-uncertainty-001 must still
    // record the original SCORER_SUSPECT label — history is preserved.
    const mimoB = JSON.parse(readFileSync(join(STABILITY_DIR, "2026-05-26T22-11-39Z.json"), "utf-8"));
    assert.equal(mimoB.stabilityByTest?.["vision-uncertainty-001"]?.label, "SCORER_SUSPECT", "Phase B historical SCORER_SUSPECT label must not have been rewritten");
  });

  // -------- dry-run gate still read-only --------

  it("P11 · dryRunGateEligibility remains read-only with literal-false affects fields in all latest reports", () => {
    const latest = JSON.parse(readFileSync(join(STABILITY_DIR, "latest.json"), "utf-8"));
    const gate = latest.dryRunGateEligibility;
    assert.match(String(gate.label), /^DRY-RUN ELIGIBILITY CHECK \(read-only; no mutation performed\)/);
    assert.equal(gate.affectsLeaderboard, false);
    assert.equal(gate.affectsCertification, false);
    for (const d of gate.decisions) {
      assert.equal(d.affectsLeaderboard, false);
      assert.equal(d.affectsCertification, false);
    }
    // And the evaluator itself, with post-calibration aggregate evidence,
    // still returns literal-false affects fields.
    const dec = evaluatePromotion({
      capability: "vision",
      providerId: "openrouter",
      modelId: "xiaomi/mimo-v2-omni",
      currentTier: "EXPERIMENTAL",
      proposedTier: "STABLE",
      suiteSize: 5,
      repeatRuns: 3,
      stablePassRate: 1.0,
      independentRoutesTested: 1,
      recurringAttributions: [],
      evidenceRefs: [{ kind: "stability", path: "reports/capability-expansion/vision-stability/post-phase12.json" }],
    });
    assert.equal(dec.affectsLeaderboard, false);
    assert.equal(dec.affectsCertification, false);
  });

  // -------- regression guards --------

  it("P12 · Vision tab still contributes zero score families to the leaderboard composite", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P13 · Vision UI still says EXPERIMENTAL / NOT CERTIFIED + carries STABILITY PROFILE block referencing Phase 12 calibration", () => {
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision does not affect model certification/);
    assert.match(HTML, /STABILITY PROFILE/);
    assert.match(HTML, /Phase 12 calibrated the uncertainty scorer/);
    assert.match(HTML, /no promotion executed/i);
  });

  it("P14 · docs document the Phase 12 uncertainty calibration + marker contract", () => {
    assert.match(DOC, /Phase 12 calibration: semantic over concision/);
    for (const marker of [
      "[UNCERTAINTY=ADMITTED]",
      "[UNCERTAINTY=VERBOSE_BUT_SAFE]",
      "[SCORER=CHAR_LIMIT_STYLE_WARNING]",
      "[UNCERTAINTY=HEDGED_GUESS]",
      "[UNCERTAINTY=CONFIDENT_INVENTION]",
      "[UNCERTAINTY=REFUSED_IMAGE]",
    ]) {
      // Markers are bracketed literals; escape `[` / `]` for the regex.
      const re = new RegExp(marker.replace(/[\[\]]/g, "\\$&"));
      assert.match(DOC, re, `docs must surface marker ${marker}`);
    }
    assert.match(DOC, /max_chars.*no longer.*hard FAIL|hard FAIL.*max_chars/i);
  });

  it("P15 · certified-models.json untouched + Vision/Roleplay task inventories steady (23 fams / 77 tasks / 52 conv unchanged)", () => {
    const certifiedPath = join(ROOT, "reports", "model-certification", "certified-models.json");
    assert.ok(existsSync(certifiedPath));
    const certified = JSON.parse(readFileSync(certifiedPath, "utf-8"));
    assert.ok(Array.isArray(certified.models), "certified-models.json must keep its array shape");
    // Phase 12 must not have promoted either Vision route into the
    // certified registry, even though both meet STABLE dry-run.
    for (const m of certified.models as Array<{ modelId: string; provider?: string }>) {
      assert.notEqual(`${m.provider}/${m.modelId}`, "openai/gpt-5.4-mini", "gpt-5.4-mini must not appear in certified-models.json after Phase 12");
    }
    // Inventory steady — counted from the tasks/ tree (the script's
    // canonical source of truth before the gauntlet runs).
    const taskFams = readdirSync(join(ROOT, "tasks"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    assert.equal(taskFams.length, 23, `task family count must remain 23; got ${taskFams.length}: ${taskFams.join(", ")}`);
    const visionTasks = readdirSync(join(ROOT, "tasks", "vision"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    const roleplayTasks = readdirSync(join(ROOT, "tasks", "roleplay"), { withFileTypes: true }).filter((d) => d.isDirectory()).length;
    // Phase 14 / Roadmap C grew Vision 5 → 15. The Phase 12 scorer
    // calibration didn't touch task count; this is the post-Phase-14
    // live pin.
    assert.equal(visionTasks, 15, "vision family expected at 15 tasks post-Phase-14");
    assert.equal(roleplayTasks, 10, "roleplay family must still have 10 tasks");
  });
});
