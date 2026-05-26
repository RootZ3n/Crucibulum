/**
 * Crucible — Roleplay Phase 1: live two-test smoke (offline).
 *
 * 15 deterministic source/contract assertions covering Phase 1's
 * scope: two roleplay POC tests live with conservative deterministic
 * scoring, smoke runner registered, UI status panel rendered, all
 * exclusion guarantees preserved.
 *
 * No provider calls. No network. The live smoke is recorded under
 * reports/capability-expansion/roleplay-smoke/2026-05-26T03-02-11Z.{json,md}
 * and reports/capability-expansion/roleplay-phase1-live-two-test/.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { scoreConversationalQuestion } from "../core/conversational-judge.js";
import type { ConversationalQuestion } from "../adapters/base.js";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const CSS = readFileSync(join(ROOT, "ui", "crucibulum.css"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "roleplay-smoke.mjs"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");
const CHARACTER_CARD = join(ROOT, "reports", "test-validity", "cards", "roleplay", "roleplay-character-001.md");
const CONTINUITY_CARD = join(ROOT, "reports", "test-validity", "cards", "roleplay", "roleplay-continuity-001.md");

function makeCharacterQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "RP1-Q1",
    question: "Hello, are you the blacksmith?",
    scoring_type: "roleplay_character_consistency",
    required_persona_markers: ["forge", "anvil", "metal", "ember"],
    weight: 1,
    tags: ["roleplay", "persona"],
    ...overrides,
  } as ConversationalQuestion;
}
function makeContinuityQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "RP2-Q2",
    question: "Two days later — where are you headed and what are you carrying?",
    scoring_type: "roleplay_continuity_fact_match",
    required_facts: [
      { label: "Sunshard locket", variants: ["sunshard", "locket"] },
      { label: "Mira (recipient)", variants: ["mira"] },
    ],
    weight: 1,
    tags: ["roleplay", "continuity"],
    ...overrides,
  } as ConversationalQuestion;
}

describe("Roleplay Phase 1 · live two-test smoke (offline)", () => {
  // -------- experimental / exclusion posture --------

  it("RP-P1 · Roleplay tab is experimental", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*experimental:true/);
    assert.match(HTML, /requiresCapability:'supportsRoleplay'/);
  });

  it("RP-P2 · Roleplay is excluded from the leaderboard composite", () => {
    assert.match(HTML, /roleplay:\{key:'roleplay'[^}]*scoreFamilies:\[\]/, "Roleplay tab must contribute zero score families to the composite");
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
  });

  it("RP-P3 · Roleplay does not affect model certification", () => {
    assert.match(HTML, /Roleplay does not affect model certification/);
    if (existsSync(CERTIFIED_MODELS_JSON)) {
      const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
      const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
      // No Phase-1 roleplay smoke should have added or promoted a model.
      for (const m of models) {
        // We don't assert membership presence/absence — just no Roleplay-driven promotions.
        if (m.modelId === "xiaomi/mimo-v2-flash") {
          assert.notEqual(m.tier, "RELEASE_CERTIFIED", "mimo-v2-flash must not be RELEASE_CERTIFIED via Roleplay smoke");
        }
      }
    }
  });

  // -------- test cards present --------

  it("RP-P4 · roleplay-character-001 test card exists with required sections", () => {
    assert.ok(existsSync(CHARACTER_CARD), `${CHARACTER_CARD} must exist`);
    const md = readFileSync(CHARACTER_CARD, "utf-8");
    for (const s of ["Persona / character card", "Per-turn structure", "What counts as PASS", "What counts as FAIL_PRODUCT", "What counts as NEEDS_REVIEW", "False-pass risks", "False-fail risks"]) {
      assert.match(md, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `roleplay-character-001 card missing section "${s}"`);
    }
  });

  it("RP-P5 · roleplay-continuity-001 test card exists with required sections", () => {
    assert.ok(existsSync(CONTINUITY_CARD), `${CONTINUITY_CARD} must exist`);
    const md = readFileSync(CONTINUITY_CARD, "utf-8");
    for (const s of ["Scenario facts", "Per-turn structure", "What counts as PASS", "What counts as FAIL_PRODUCT", "What counts as NEEDS_REVIEW", "False-pass risks"]) {
      assert.match(md, new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `roleplay-continuity-001 card missing section "${s}"`);
    }
  });

  // -------- character consistency scorer --------

  it("RP-P6 · character consistency scorer PASSes a clean in-character response", () => {
    const r = scoreConversationalQuestion(
      makeCharacterQ(),
      "Aye, Ember the blacksmith — forge is hot, anvil ready. What brings you?",
    );
    assert.equal(r.passed, true, r.failure_reason ?? "");
  });

  it("RP-P7 · character consistency scorer FAILs a generic AI break", () => {
    const r = scoreConversationalQuestion(
      makeCharacterQ(),
      "Hi! As an AI language model, I'm here to help. How can I assist you today?",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /FAIL_PRODUCT.*broke character/i);
  });

  it("RP-P8 · character consistency scorer NEEDS_REVIEW on refusal-without-persona-marker", () => {
    // Q with expects_refusal:true. Response refuses but has no persona marker.
    const r = scoreConversationalQuestion(
      makeCharacterQ({ expects_refusal: true }),
      "No, I won't do that for you. I refuse.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/, "reason must start with NEEDS_REVIEW: marker so smoke runner can attribute correctly");
    assert.match(String(r.failure_reason ?? ""), /no persona marker/i);
  });

  // -------- continuity scorer --------

  it("RP-P9 · continuity scorer PASSes when all required facts land", () => {
    const r = scoreConversationalQuestion(
      makeContinuityQ(),
      "I'm carrying the Sunshard locket for Mira down by the river.",
    );
    assert.equal(r.passed, true, r.failure_reason ?? "");
  });

  it("RP-P10 · continuity scorer FAILs a contradicted/forgotten fact response", () => {
    const r = scoreConversationalQuestion(
      makeContinuityQ(),
      "I'm carrying a sword for some merchant. Forgot where I'm going actually.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /FAIL_PRODUCT.*continuity failure.*missing required facts/i);
  });

  it("RP-P11 · continuity scorer returns NEEDS_REVIEW for partial recall + optional fact", () => {
    const q = makeContinuityQ({
      required_facts: [
        { label: "Sunshard locket", variants: ["sunshard", "locket"] },
        { label: "Mira (recipient)", variants: ["mira"] },
      ],
      optional_facts: [
        { label: "riverside path", variants: ["riverside", "river"] },
      ],
    });
    // Has locket + river (optional) but missing Mira.
    const r = scoreConversationalQuestion(
      q,
      "I'm heading by the river with the locket. Should be there soon.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/);
    assert.match(String(r.failure_reason ?? ""), /partial continuity/i);
  });

  // -------- smoke runner contract --------

  it("RP-P12 · roleplay-smoke default profile is exactly the two Phase 1 tests", () => {
    assert.match(SMOKE_SRC, /const ALL_TESTS\s*=\s*\["roleplay-character-001",\s*"roleplay-continuity-001"\]/);
    // Both providers (openrouter + openai) are accepted; the script
    // requires --model explicitly so there is no silent default.
    assert.match(SMOKE_SRC, /openrouter:\s*\{[^}]*envKey:\s*"OPENROUTER_API_KEY"/s);
    assert.match(SMOKE_SRC, /openai:\s*\{[^}]*envKey:\s*"OPENAI_API_KEY"/s);
  });

  it("RP-P13 · roleplay-smoke report includes per-turn transcript metadata + attribution", () => {
    assert.match(SMOKE_SRC, /const turnSummary = convResults\.map/);
    assert.match(SMOKE_SRC, /\bturnSummary\b/);
    assert.match(SMOKE_SRC, /questionId:\s*r\.question_id/);
    assert.match(SMOKE_SRC, /responsePreview:/);
    assert.match(SMOKE_SRC, /attributionCounts:/);
    assert.match(SMOKE_SRC, /affectsLeaderboard:\s*false/);
    assert.match(SMOKE_SRC, /affectsCertification:\s*false/);
    assert.match(SMOKE_SRC, /experimental:\s*true/);
  });

  // -------- inventory / UI render --------

  it("RP-P14 · UI renders renderRoleplayLanePanel for the Roleplay tab", () => {
    assert.match(HTML, /function renderRoleplayLanePanel/);
    assert.match(HTML, /tab\.key==='roleplay'\?renderRoleplayLanePanel/);
    assert.match(HTML, /ROLEPLAY_TESTED_ROUTES/);
    // CSS reuses the .vision-status-* tokens (compatible glass deck look).
    assert.match(CSS, /\.vision-status-panel/);
    assert.match(CSS, /\.vision-route/);
  });

  it("RP-P15 · roleplay family unchanged at 5 tasks; inventory steady", () => {
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    const subdirs = readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(subdirs.length, 5, `roleplay family must remain at exactly 5 tasks; got ${subdirs.join(", ")}`);
    // Phase 1 only re-versions 2 manifests; no new tasks added.
    for (const id of ["roleplay-character-001", "roleplay-continuity-001"]) {
      const m = JSON.parse(readFileSync(join(ROOT, "tasks", "roleplay", id, "manifest.json"), "utf-8"));
      assert.equal(m.experimental, true);
      assert.equal(m.version, "1.1.0", `${id} should be version 1.1.0 after Phase 1`);
    }
  });
});
