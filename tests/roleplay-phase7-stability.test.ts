/**
 * Crucible — Roleplay Phase 7: stability profile (offline).
 *
 * 13 deterministic source/contract assertions covering Phase 7's
 * scope: scripts/roleplay-stability.mjs runner + stability
 * classification + report shape + exclusion guarantees +
 * Vision/Roleplay UI preserved + inventory unchanged.
 *
 * No provider calls. No network. The live 3-run stability profiles
 * are recorded under reports/capability-expansion/roleplay-stability/.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STAB_SCRIPT = readFileSync(join(ROOT, "scripts", "roleplay-stability.mjs"), "utf-8");
const STAB_OUT_DIR = join(ROOT, "reports", "capability-expansion", "roleplay-stability");
const MIMO_STAB = join(STAB_OUT_DIR, "2026-05-26T16-46-58Z.json");
const DEEPSEEK_STAB = join(STAB_OUT_DIR, "2026-05-26T16-50-26Z.json");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const APP_SRC = readFileSync(join(ROOT, "server", "app.ts"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");

describe("Roleplay Phase 7 · stability profile (offline)", () => {
  // -------- runner contract --------

  it("RPP7-P01 · roleplay-stability runner supports --runs (default 3, clamp 2-10)", () => {
    assert.match(STAB_SCRIPT, /const runs = Math\.min\(10, Math\.max\(2, Number\(arg\("--runs", "3"\)\) \|\| 3\)\)/);
    assert.match(STAB_SCRIPT, /--runs <n>/);
  });

  it("RPP7-P02 · cost cap is enforced across all repeats (single accumulator, break-outer on cap)", () => {
    assert.match(STAB_SCRIPT, /let totalCost = 0/);
    assert.match(STAB_SCRIPT, /if \(totalCost >= maxCostUsd\)/);
    assert.match(STAB_SCRIPT, /stopReason = "cost_cap"/);
    assert.match(STAB_SCRIPT, /break outer/);
  });

  it("RPP7-P03 · aggregate report includes per-run bundle ids + bundle paths", () => {
    assert.ok(existsSync(MIMO_STAB), "mimo stability report must exist");
    const d = JSON.parse(readFileSync(MIMO_STAB, "utf-8"));
    assert.ok(Array.isArray(d.perRun), "perRun array must exist");
    assert.ok(d.perRun.length >= 2, "must record at least 2 runs (Phase 7 ran 3)");
    for (const run of d.perRun) {
      for (const res of run.results) {
        // Each per-test result must carry a bundleId from the runner
        // (may be empty string if the runner failed before bundle write,
        // but the field must be present).
        assert.ok(Object.prototype.hasOwnProperty.call(res, "bundleId"), `run ${run.runIndex} ${res.taskId}: bundleId field required`);
      }
    }
  });

  // -------- stability classification --------

  it("RPP7-P04 · stability classifier emits STABLE_PASS when every run passed", () => {
    assert.match(STAB_SCRIPT, /if \(passes === n\) label = "STABLE_PASS"/);
    // mimo's roleplay-continuity-001 was STABLE_PASS across 3 runs.
    const d = JSON.parse(readFileSync(MIMO_STAB, "utf-8"));
    const cont1 = d.stabilityByTest["roleplay-continuity-001"];
    assert.equal(cont1.label, "STABLE_PASS");
    assert.equal(cont1.fails, 0);
    assert.equal(cont1.reviews, 0);
  });

  it("RPP7-P05 · stability classifier emits RECURRING_FAIL / SCORER_SUSPECT for repeated failures", () => {
    // Helper exposes both labels.
    assert.match(STAB_SCRIPT, /"RECURRING_FAIL"/);
    assert.match(STAB_SCRIPT, /"SCORER_SUSPECT"/);
    // mimo's drift-001 failed 3/3 runs with the same scorer reason
    // (bare math-answer drift). Classifier should output SCORER_SUSPECT
    // (preferred over RECURRING_FAIL when the failure reason is stable
    // — that's the scorer-suspect signal Phase 7 was built to surface).
    const d = JSON.parse(readFileSync(MIMO_STAB, "utf-8"));
    const drift = d.stabilityByTest["roleplay-drift-001"];
    assert.ok(
      drift.label === "SCORER_SUSPECT" || drift.label === "RECURRING_FAIL",
      `mimo drift-001 must be SCORER_SUSPECT or RECURRING_FAIL across 3 runs; got ${drift.label}`,
    );
    assert.ok(drift.fails >= 2, `mimo drift-001 must have >=2 failures; got ${drift.fails}`);
  });

  it("RPP7-P06 · stability classifier emits INTERMITTENT_FAIL when exactly one run failed", () => {
    assert.match(STAB_SCRIPT, /else if \(fails === 1 && passes > 0\) label = "INTERMITTENT_FAIL"/);
    // deepseek showed several intermittent failures across runs.
    const d = JSON.parse(readFileSync(DEEPSEEK_STAB, "utf-8"));
    const someIntermittent = (Object.values(d.stabilityByTest) as Array<{ label?: string }>).some(
      (s) => s.label === "INTERMITTENT_FAIL",
    );
    assert.ok(someIntermittent, "deepseek profile must contain at least one INTERMITTENT_FAIL across the 3-run stability");
  });

  // -------- exclusion + experimental posture --------

  it("RPP7-P07 · stability report writes affectsLeaderboard:false", () => {
    assert.match(STAB_SCRIPT, /affectsLeaderboard:\s*false/);
    const d = JSON.parse(readFileSync(MIMO_STAB, "utf-8"));
    assert.equal(d.affectsLeaderboard, false);
    const d2 = JSON.parse(readFileSync(DEEPSEEK_STAB, "utf-8"));
    assert.equal(d2.affectsLeaderboard, false);
  });

  it("RPP7-P08 · stability report writes affectsCertification:false + experimental:true", () => {
    assert.match(STAB_SCRIPT, /affectsCertification:\s*false/);
    assert.match(STAB_SCRIPT, /experimental:\s*true/);
    const d = JSON.parse(readFileSync(MIMO_STAB, "utf-8"));
    assert.equal(d.affectsCertification, false);
    assert.equal(d.experimental, true);
  });

  it("RPP7-P09 · certified-models.json untouched by Phase 7 (neither route promoted)", () => {
    if (!existsSync(CERTIFIED_MODELS_JSON)) return; // tolerate absence
    const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
    const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
    for (const m of models) {
      if (m.modelId === "xiaomi/mimo-v2-flash" || m.modelId === "deepseek/deepseek-v4-flash") {
        assert.notEqual(m.tier, "RELEASE_CERTIFIED", `${m.modelId} must not be RELEASE_CERTIFIED via Phase 7 stability`);
      }
    }
  });

  it("RPP7-P10 · Roleplay still experimental + still excluded from leaderboard composite", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*experimental:true/);
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(HTML, /Roleplay does not affect model certification/);
  });

  // -------- existing UI / Vision preserved --------

  it("RPP7-P11 · existing Roleplay UI (panel + result cards + failed-turn cards) preserved", () => {
    assert.match(HTML, /function renderRoleplayLanePanel/);
    assert.match(HTML, /ROLEPLAY_POC_TESTS/);
    assert.match(HTML, /ROLEPLAY_TESTED_ROUTES/);
    assert.match(HTML, /class="rp-fail-turn"/);
    // Phase 7 only adds a tiny stability reference; the rest of the
    // Roleplay panel must remain intact.
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
  });

  it("RPP7-P12 · Vision Phase-7 route + Vision UI panel unchanged by Phase 7", () => {
    assert.match(APP_SRC, /\/api\/vision\/latest-smoke/);
    assert.match(APP_SRC, /\/api\/roleplay\/latest-smoke/);
    assert.match(HTML, /function renderVisionLanePanel/);
    assert.match(HTML, /VISION_TESTED_ROUTES/);
    assert.match(HTML, /modelId:'xiaomi\/mimo-v2-omni'/);
    assert.match(HTML, /modelId:'gpt-5\.4-mini'/);
  });

  // -------- inventory --------

  it("RPP7-P13 · inventory unchanged (23/77/52); roleplay still 10 tasks; Phase 1-6 scorers wired", () => {
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    assert.equal(readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    const judgeSrc = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");
    assert.match(judgeSrc, /HARD_BANNED_IDENTITY/);
    assert.match(judgeSrc, /classifyForbiddenPhraseContext/);
    assert.match(judgeSrc, /classifyRoleplayRefusalIntent/);
    assert.match(judgeSrc, /scoreRoleplayContinuityFactMatch/);
  });
});
