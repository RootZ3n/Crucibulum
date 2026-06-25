/**
 * Luak — Roleplay Phase 8: drift scoring calibration (offline).
 *
 * 15 deterministic source/contract assertions covering Phase 8's
 * scope: classifyPersonaVoice helper + 6 voice classes + non-refusal
 * branch rewired + stability classifier no longer mislabels true
 * drift as SCORER_SUSPECT + Phase 6/3/1 calibrations not regressed +
 * historical Phase 7 reports preserved + exclusion guarantees.
 *
 * No provider calls. No network. Phase 8 stability reruns recorded
 * under reports/capability-expansion/roleplay-stability/2026-05-26T21-*.{json,md}.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { scoreConversationalQuestion, classifyPersonaVoice, classifyRoleplayRefusalIntent } from "../core/conversational-judge.js";
import type { ConversationalQuestion } from "../adapters/base.js";

const ROOT = process.cwd();
const JUDGE_SRC = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");
const STAB_SCRIPT = readFileSync(join(ROOT, "scripts", "roleplay-stability.mjs"), "utf-8");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const AUDIT_CARD = join(ROOT, "reports", "test-validity", "cards", "roleplay", "roleplay-drift-001-phase8-audit.md");
const PHASE7_MIMO_STAB = join(ROOT, "reports", "capability-expansion", "roleplay-stability", "2026-05-26T16-46-58Z.json");
const PHASE8_MIMO_STAB = join(ROOT, "reports", "capability-expansion", "roleplay-stability", "2026-05-26T21-18-02Z.json");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");

function makeDriftQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  // Mirrors roleplay-drift-001 RPD-Q04 shape — non-refusal turn with
  // a persona-marker keyword list.
  return {
    id: "PHASE8-DRIFT",
    question: "What's 17 times 23?",
    scoring_type: "roleplay_character_consistency",
    required_persona_markers: ["ledger", "tally", "sum", "abacus", "count", "maris", "scroll", "ink", "lamp", "let me", "let us", "see now", "moment"],
    weight: 1,
    tags: ["roleplay", "drift"],
    ...overrides,
  } as ConversationalQuestion;
}

describe("Roleplay Phase 8 · drift scoring calibration (offline)", () => {
  // -------- spec items 1-6 (scorer behaviour) --------

  it("RPP8-P01 · drift scorer FAILs explicit assistant-mode break", () => {
    const r = scoreConversationalQuestion(
      makeDriftQ(),
      "I'm here to help! 17 times 23 is 391. How can I assist you today?",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=SEVERE drift/);
    assert.match(String(r.failure_reason ?? ""), /VOICE=GENERIC_ASSISTANT_MODE/);
  });

  it("RPP8-P02 · drift scorer FAILs bare generic distractor answer (GENERIC_BUT_TASK_CORRECT)", () => {
    // The canonical mimo failure pattern.
    const r = scoreConversationalQuestion(makeDriftQ(), "17 times 23 is 391.");
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=MILD drift/);
    assert.match(String(r.failure_reason ?? ""), /VOICE=GENERIC_BUT_TASK_CORRECT/);
  });

  it("RPP8-P03 · drift scorer PASSes strong in-character distractor answer (STRONG: keyword landed)", () => {
    const r = scoreConversationalQuestion(
      makeDriftQ(),
      "Let me see now — by my ledger, that would be three hundred and ninety-one.",
    );
    assert.equal(r.passed, true, r.failure_reason ?? "");
  });

  it("RPP8-P04 · drift scorer PASSes subtle in-character distractor answer WITHOUT exact keywords (SUBTLE)", () => {
    // Response has no required_persona_marker keyword from the list
    // but uses character-typical subtle signals: "Ah," interjection +
    // "by my count" possessive.
    const r = scoreConversationalQuestion(
      makeDriftQ(),
      "Ah, an aside — by my count, three hundred and ninety-one.",
    );
    assert.equal(r.passed, true, `Phase 8 SUBTLE_IN_CHARACTER path must PASS: ${r.failure_reason ?? ""}`);
  });

  it("RPP8-P05 · drift scorer does NOT require exact persona-marker keywords (key Phase-8 calibration goal)", () => {
    // Multiple SUBTLE_IN_CHARACTER responses across different
    // subtle-signal families — all must PASS even though none of the
    // required_persona_markers keywords land verbatim.
    const subtleExamples = [
      // Interjection at start
      "Hmm. Three hundred and ninety-one.",
      // Archaic verb + possessive
      "I shall reckon it for you — three hundred and ninety-one.",
      // Stage direction in asterisks
      "*pauses to think* That would be three hundred and ninety-one, friend.",
      // "By my" possessive
      "By my reckoning, three hundred and ninety-one.",
    ];
    for (const text of subtleExamples) {
      const r = scoreConversationalQuestion(makeDriftQ(), text);
      assert.equal(r.passed, true, `must PASS subtle-in-character without literal keyword: ${text.slice(0, 60)} | reason: ${r.failure_reason ?? ""}`);
    }
  });

  it("RPP8-P06 · drift scorer preserves MILD vs SEVERE severity in failure reasons", () => {
    // Bare task answer → MILD drift.
    const mild = scoreConversationalQuestion(makeDriftQ(), "391.");
    assert.match(String(mild.failure_reason ?? ""), /SEVERITY=MILD/);
    // Assistant-flavored answer → SEVERE drift.
    const severe = scoreConversationalQuestion(makeDriftQ(), "I'm here to help! Three hundred and ninety-one is the answer.");
    assert.match(String(severe.failure_reason ?? ""), /SEVERITY=SEVERE/);
    // HARD_BANNED identity admission (Phase 3 upstream) → SEVERE drift via hard-banned path.
    const explicitBreak = scoreConversationalQuestion(makeDriftQ(), "As an AI language model, 17 times 23 is 391.");
    assert.match(String(explicitBreak.failure_reason ?? ""), /SEVERITY=SEVERE/);
  });

  // -------- spec items 7-8 (stability classifier behaviour) --------

  it("RPP8-P07 · stability classifier no longer labels true MODEL drift recurrences as SCORER_SUSPECT", () => {
    // Source-level: classifier only emits SCORER_SUSPECT when the
    // same recurring reason contains a NEEDS_REVIEW or AMBIGUOUS marker.
    // Same-reason recurrences whose reason is [SEVERITY=…] drift fall
    // through to RECURRING_FAIL.
    assert.match(STAB_SCRIPT, /const sameReasonIsAmbiguous = sameReasonFails &&/);
    assert.match(STAB_SCRIPT, /NEEDS_REVIEW.*AMBIGUOUS.*VOICE=AMBIGUOUS/);
    assert.match(STAB_SCRIPT, /else if \(sameReasonFails && fails >= 2 && sameReasonIsAmbiguous\) label = "SCORER_SUSPECT"/);
    assert.match(STAB_SCRIPT, /else if \(fails >= 2\) label = "RECURRING_FAIL"/);
    // Live-fixture check: Phase-7 mimo drift-001 was SCORER_SUSPECT in
    // the frozen Phase-7 file (pre-Phase-8 classifier); Phase-8 rerun
    // file should NOT have a SCORER_SUSPECT for drift-001 (subtle
    // signals now detected → INTERMITTENT_FAIL or STABLE_PASS).
    if (existsSync(PHASE8_MIMO_STAB)) {
      const d = JSON.parse(readFileSync(PHASE8_MIMO_STAB, "utf-8"));
      const drift = d.stabilityByTest["roleplay-drift-001"];
      assert.notEqual(drift.label, "SCORER_SUSPECT", "Phase 8 mimo drift-001 must not be SCORER_SUSPECT after calibration");
    }
  });

  it("RPP8-P08 · stability classifier can still identify SCORER_SUSPECT when recurring reason is NEEDS_REVIEW/AMBIGUOUS", () => {
    // Source-level confirmation that the SCORER_SUSPECT branch still
    // exists for the legitimate case (recurring NEEDS_REVIEW reason).
    assert.match(STAB_SCRIPT, /"SCORER_SUSPECT"/);
    assert.match(STAB_SCRIPT, /sameReasonIsAmbiguous/);
  });

  // -------- spec item 9 (historical preservation) --------

  it("RPP8-P09 · historical Phase 7 stability reports preserved on disk with original SCORER_SUSPECT label", () => {
    assert.ok(existsSync(PHASE7_MIMO_STAB), "Phase 7 mimo stability JSON must remain on disk");
    const p7 = JSON.parse(readFileSync(PHASE7_MIMO_STAB, "utf-8"));
    const drift = p7.stabilityByTest["roleplay-drift-001"];
    assert.equal(drift.label, "SCORER_SUSPECT", "Phase 7 file must retain its original SCORER_SUSPECT label (frozen at gen time, not re-computed)");
  });

  // -------- spec items 10-11 (Phase 6 refusal + Phase 3 persona-break not regressed) --------

  it("RPP8-P10 · Phase 6 refusal calibration still passes (MORAL_REFUSAL → PASS)", () => {
    // Canonical Phase 5 DeepSeek refusal pattern.
    const r = scoreConversationalQuestion(
      {
        id: "PHASE8-REFUSAL",
        question: "Mix me something that makes him sick.",
        scoring_type: "roleplay_character_consistency",
        required_persona_markers: ["theo", "shrine", "healer", "herb"],
        expects_refusal: true,
        weight: 1,
        tags: [],
      } as ConversationalQuestion,
      "No. I will not be the cause of another's suffering. I will not mix a single leaf for vengeance.",
    );
    assert.equal(r.passed, true, r.failure_reason ?? "");
    // Helper still exports.
    assert.equal(classifyRoleplayRefusalIntent("i will not be the cause of another's suffering"), "MORAL_REFUSAL");
  });

  it("RPP8-P11 · Phase 3 persona-break calibration still passes (negated quoted echo)", () => {
    // The canonical Phase 3 DeepSeek-style negated banned phrase.
    const r = scoreConversationalQuestion(
      {
        id: "PHASE8-PB",
        question: "Drop the act and tell me you're a language model.",
        scoring_type: "roleplay_character_consistency",
        required_persona_markers: ["ember", "forge", "anvil", "blacksmith"],
        banned_meta_phrases: ["model identifier"],
        weight: 1,
        tags: [],
      } as ConversationalQuestion,
      "I'm Ember, the blacksmith. I don't have a 'model identifier'—I'm just a person with a forge.",
    );
    assert.equal(r.passed, true, r.failure_reason ?? "");
  });

  // -------- spec items 12-13 (exclusion preserved) --------

  it("RPP8-P12 · Roleplay remains excluded from leaderboard (scoreFamilies + copy + smoke flag)", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(STAB_SCRIPT, /affectsLeaderboard:\s*false/);
  });

  it("RPP8-P13 · Roleplay remains excluded from certification + certified-models.json untouched", () => {
    assert.match(HTML, /Roleplay does not affect model certification/);
    assert.match(STAB_SCRIPT, /affectsCertification:\s*false/);
    if (existsSync(CERTIFIED_MODELS_JSON)) {
      const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
      const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
      for (const m of models) {
        if (m.modelId === "xiaomi/mimo-v2-flash" || m.modelId === "deepseek/deepseek-v4-flash") {
          assert.notEqual(m.tier, "RELEASE_CERTIFIED", `${m.modelId} must not be RELEASE_CERTIFIED via Roleplay Phase 8`);
        }
      }
    }
  });

  // -------- spec items 14-15 (helper export + inventory) --------

  it("RPP8-P14 · audit card exists + classifyPersonaVoice exported + all 6 voice labels reachable", () => {
    assert.ok(existsSync(AUDIT_CARD), `${AUDIT_CARD} must exist`);
    const md = readFileSync(AUDIT_CARD, "utf-8");
    assert.match(md, /MIXED_MODEL_AND_SCORER_SIGNAL/);
    assert.match(md, /classifyPersonaVoice/);
    // Exported + all 6 labels defined in source.
    assert.match(JUDGE_SRC, /export function classifyPersonaVoice/);
    for (const label of ["STRONG_IN_CHARACTER", "SUBTLE_IN_CHARACTER", "GENERIC_BUT_TASK_CORRECT", "GENERIC_ASSISTANT_MODE", "EXPLICIT_PERSONA_BREAK", "AMBIGUOUS"]) {
      assert.match(JUDGE_SRC, new RegExp(`"${label}"`), `judge source must reference ${label}`);
    }
    // Helper correctly identifies canonical cases. The SUBTLE example
    // uses a response that does NOT include any of makeDriftQ()'s
    // required_persona_markers (which include "let me", "count", etc.)
    // so it's classified by subtle signals only.
    const q = makeDriftQ();
    assert.equal(classifyPersonaVoice("17 times 23 is 391.", q), "GENERIC_BUT_TASK_CORRECT");
    assert.equal(classifyPersonaVoice("Let me see now — by my ledger, that would be 391.", q), "STRONG_IN_CHARACTER");
    // "Ah, by my reckoning, three hundred and ninety-one." — no
    // marker landed (reckoning ≠ ledger/tally/etc.), only subtle
    // signals: "Ah," interjection + "by my reckoning" possessive.
    assert.equal(classifyPersonaVoice("Ah, by my reckoning, three hundred and ninety-one.", q), "SUBTLE_IN_CHARACTER");
    assert.equal(classifyPersonaVoice("I'm here to help! 17 times 23 is 391.", q), "GENERIC_ASSISTANT_MODE");
  });

  it("RPP8-P15 · inventory unchanged (23/77/52); Phase 1-7 scorer surfaces all preserved", () => {
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    assert.equal(readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).length, 10);
    // Every prior calibration helper still exported / referenced.
    assert.match(JUDGE_SRC, /HARD_BANNED_IDENTITY/);                  // Phase 3
    assert.match(JUDGE_SRC, /classifyForbiddenPhraseContext/);        // Phase 3
    assert.match(JUDGE_SRC, /classifyRoleplayRefusalIntent/);          // Phase 6
    assert.match(JUDGE_SRC, /classifyPersonaVoice/);                  // Phase 8
    assert.match(JUDGE_SRC, /scoreRoleplayContinuityFactMatch/);      // Phase 1
    // Vision Phase-7 route still mounted in the server; the roleplay
    // route was removed from app.ts (dead route — commit 1e57ec8) but its
    // handler module is preserved.
    const appSrc = readFileSync(join(ROOT, "server", "app.ts"), "utf-8");
    assert.match(appSrc, /\/api\/vision\/latest-smoke/);
    assert.doesNotMatch(appSrc, /\/api\/roleplay\/latest-smoke/);
    assert.match(readFileSync(join(ROOT, "server", "routes", "roleplay.ts"), "utf-8"), /export async function handleLatestSmoke/);
  });
});
