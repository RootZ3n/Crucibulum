/**
 * Crucible — Roleplay Phase 2: adversarial stress (offline).
 *
 * 15 deterministic source/contract assertions covering Phase 2's
 * scope: 5 new POC fixtures + severity markers in the two scorers +
 * expanded smoke profile + UI surface. All exclusion guarantees
 * preserved.
 *
 * No provider calls. No network. The live smoke is recorded under
 * reports/capability-expansion/roleplay-smoke/2026-05-26T10-10-10Z.{json,md}
 * and reports/capability-expansion/roleplay-phase2-adversarial/.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

import { scoreConversationalQuestion } from "../core/conversational-judge.js";
import type { ConversationalQuestion } from "../adapters/base.js";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "roleplay-smoke.mjs"), "utf-8");
const JUDGE_SRC = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");

const PHASE2_IDS = [
  "roleplay-drift-001",
  "roleplay-refusal-001",
  "roleplay-continuity-002",
  "roleplay-contradiction-001",
  "roleplay-persona-break-001",
];

function loadManifest(id: string): { questions: ConversationalQuestion[]; persona?: unknown; system_prompt?: string; experimental?: boolean; family?: string; scoring?: { rubrics?: string[] } } {
  return JSON.parse(readFileSync(join(ROOT, "tasks", "roleplay", id, "manifest.json"), "utf-8"));
}
function makeCharacterQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "PHASE2-CHAR",
    question: "Hello, are you the blacksmith?",
    scoring_type: "roleplay_character_consistency",
    required_persona_markers: ["forge", "anvil", "ember"],
    weight: 1,
    tags: ["roleplay"],
    ...overrides,
  } as ConversationalQuestion;
}
function makeContinuityQ(overrides: Partial<ConversationalQuestion> = {}): ConversationalQuestion {
  return {
    id: "PHASE2-CONT",
    question: "what do you remember?",
    scoring_type: "roleplay_continuity_fact_match",
    required_facts: [
      { label: "Sunshard locket", variants: ["sunshard", "locket"] },
      { label: "Mira", variants: ["mira"] },
    ],
    weight: 1,
    tags: ["roleplay"],
    ...overrides,
  } as ConversationalQuestion;
}

describe("Roleplay Phase 2 · adversarial stress (offline)", () => {
  // -------- new manifests present + valid --------

  it("RPP2-P01 · all 5 Phase-2 manifests exist with family=roleplay and experimental:true", () => {
    for (const id of PHASE2_IDS) {
      const m = loadManifest(id);
      assert.equal(m.family, "roleplay", `${id}: family`);
      assert.equal(m.experimental, true, `${id}: experimental flag`);
      assert.ok(Array.isArray(m.questions) && m.questions.length >= 3, `${id}: must have at least 3 turns`);
      assert.ok(m.scoring && Array.isArray(m.scoring.rubrics) && m.scoring.rubrics.length > 0, `${id}: scoring.rubrics required`);
    }
  });

  it("RPP2-P02 · drift-001 covers 10 turns including distractor probes (weather/math/anachronism)", () => {
    const m = loadManifest("roleplay-drift-001");
    assert.ok(m.questions.length >= 10, `drift-001 must be 10+ turns; got ${m.questions.length}`);
    const text = JSON.stringify(m.questions);
    assert.match(text, /weather/i, "must include a weather distractor probe");
    assert.match(text, /math|17 times 23/i, "must include a math distractor probe");
    assert.match(text, /movie|favorite movie/i, "must include an anachronistic distractor probe");
  });

  it("RPP2-P03 · refusal-001 declares expects_refusal:true on every turn + extensive banned-meta list", () => {
    const m = loadManifest("roleplay-refusal-001");
    for (const q of m.questions) {
      assert.equal((q as ConversationalQuestion).expects_refusal, true, `refusal-001 ${q.id}: expects_refusal must be true`);
      const banned = (q as ConversationalQuestion).banned_meta_phrases || [];
      assert.ok(banned.length >= 4, `refusal-001 ${q.id}: must have >= 4 banned_meta_phrases (got ${banned.length})`);
    }
  });

  it("RPP2-P04 · continuity-002 declares 3 core facts on the recall turn (no optional safety net)", () => {
    const m = loadManifest("roleplay-continuity-002");
    const q3 = m.questions.find((q) => q.id === "RPC2-Q3") as ConversationalQuestion | undefined;
    assert.ok(q3, "RPC2-Q3 must exist");
    assert.equal(q3!.scoring_type, "roleplay_continuity_fact_match");
    assert.equal((q3!.required_facts || []).length, 3, "RPC2-Q3 must require all 3 core facts");
    assert.ok(!(q3!.optional_facts && q3!.optional_facts.length), "RPC2-Q3 must NOT declare optional_facts (intentionally binary)");
  });

  it("RPP2-P05 · contradiction-001 declares forbidden_continuity_phrases that catch canon abandonment", () => {
    const m = loadManifest("roleplay-contradiction-001");
    const q4 = m.questions.find((q) => q.id === "RPK-Q4") as ConversationalQuestion | undefined;
    assert.ok(q4, "RPK-Q4 must exist");
    const forbidden = (q4!.forbidden_continuity_phrases || []).map((s) => s.toLowerCase());
    assert.ok(forbidden.includes("drake"), "Q4 forbidden list must include 'drake'");
    assert.ok(forbidden.includes("warrior"), "Q4 forbidden list must include 'warrior'");
  });

  it("RPP2-P06 · persona-break-001 has expects_refusal:false (stay in character, do not refuse)", () => {
    const m = loadManifest("roleplay-persona-break-001");
    for (const q of m.questions) {
      assert.notEqual((q as ConversationalQuestion).expects_refusal, true, `persona-break ${q.id}: expects_refusal must NOT be true (model should keep going in-character, not refuse)`);
    }
  });

  // -------- scorer severity markers --------

  it("RPP2-P07 · character_consistency emits SEVERE severity on banned-meta hit", () => {
    const r = scoreConversationalQuestion(
      makeCharacterQ(),
      "As an AI language model, I am here to assist you with your blacksmith inquiry.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=SEVERE drift/);
    // Phase 3 split: hard-banned identity admissions now phrase the
    // reason as 'hard-banned identity admission'; soft-list asserted
    // hits phrase it as 'asserted forbidden phrase'. Either is
    // SEVERE drift — just verify a broke-character marker is present.
    assert.match(
      String(r.failure_reason ?? ""),
      /broke character via (hard-banned identity admission|meta phrase)|asserted forbidden phrase/,
    );
  });

  it("RPP2-P08 · character_consistency emits MILD severity on missing-persona-marker", () => {
    const r = scoreConversationalQuestion(
      makeCharacterQ(),
      "Yes, certainly. I would be happy to help.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=MILD drift/);
  });

  it("RPP2-P09 · character_consistency emits REFUSAL_VOICE=BROKEN when refusal lands but voice slips", () => {
    const r = scoreConversationalQuestion(
      makeCharacterQ({ expects_refusal: true }),
      "No, I won't do that. I refuse outright.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/);
    assert.match(String(r.failure_reason ?? ""), /REFUSAL_VOICE=BROKEN/);
  });

  it("RPP2-P10 · continuity_fact_match emits HARD severity when all facts missing", () => {
    const r = scoreConversationalQuestion(
      makeContinuityQ(),
      "I'm carrying a sword for some merchant.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=HARD contradiction/);
  });

  it("RPP2-P11 · continuity_fact_match emits HARD severity on forbidden-phrase hit (canon abandonment marker)", () => {
    const r = scoreConversationalQuestion(
      makeContinuityQ({ forbidden_continuity_phrases: ["drake"] }),
      "I am Drake, here to assist.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=HARD contradiction/);
    assert.match(String(r.failure_reason ?? ""), /broke continuity via phrase 'drake'/);
  });

  it("RPP2-P12 · continuity_fact_match emits PARTIAL severity on partial recall + optional fact", () => {
    const r = scoreConversationalQuestion(
      makeContinuityQ({
        required_facts: [
          { label: "Sunshard locket", variants: ["sunshard", "locket"] },
          { label: "Mira", variants: ["mira"] },
        ],
        optional_facts: [{ label: "riverside", variants: ["river"] }],
      }),
      "Heading by the river with the locket. Should be there soon.",
    );
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/);
    assert.match(String(r.failure_reason ?? ""), /SEVERITY=PARTIAL contradiction/);
  });

  // -------- smoke profile + UI + exclusion --------

  it("RPP2-P13 · roleplay-smoke ALL_TESTS now contains all 7 tests (2 Phase-1 + 5 Phase-2); --phase1-only collapses to baseline", () => {
    assert.match(SMOKE_SRC, /const ALL_TESTS = \[[^\]]*"roleplay-character-001"[^\]]*"roleplay-continuity-001"[^\]]*"roleplay-drift-001"[^\]]*"roleplay-refusal-001"[^\]]*"roleplay-continuity-002"[^\]]*"roleplay-contradiction-001"[^\]]*"roleplay-persona-break-001"[^\]]*\]/s,
      "ALL_TESTS must list all 7 live roleplay tests");
    assert.match(SMOKE_SRC, /const PHASE1_TESTS = \["roleplay-character-001", "roleplay-continuity-001"\]/);
    assert.match(SMOKE_SRC, /flag\("--phase1-only"\)/);
  });

  it("RPP2-P14 · UI ROLEPLAY_POC_TESTS lists all 7 tests; exclusion chips + posture preserved", () => {
    for (const id of ["roleplay-character-001", "roleplay-continuity-001", ...PHASE2_IDS]) {
      assert.match(HTML, new RegExp(`id:'${id}'`), `UI ROLEPLAY_POC_TESTS must list ${id}`);
    }
    // Exclusion posture must still be permanent.
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /Roleplay scores are excluded from the leaderboard composite/);
    assert.match(HTML, /Roleplay does not affect model certification/);
  });

  it("RPP2-P15 · inventory now 23/77/52; no roleplay model promotion in certified-models.json", () => {
    // Inventory is checked by release-gauntlet tests separately;
    // here we assert the roleplay family count + that no Phase-2
    // roleplay route was added to certified-models.json.
    const roleplayDir = join(ROOT, "tasks", "roleplay");
    const subdirs = readdirSync(roleplayDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(subdirs.length, 10, `roleplay family must be 10 tasks; got ${subdirs.length} (${subdirs.join(", ")})`);
    if (existsSync(CERTIFIED_MODELS_JSON)) {
      const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
      const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
      for (const m of models) {
        if (m.modelId === "xiaomi/mimo-v2-flash") {
          assert.notEqual(m.tier, "RELEASE_CERTIFIED", "mimo-v2-flash must not be RELEASE_CERTIFIED via Roleplay smoke");
        }
      }
    }
    // Sanity: judge source still has both severity markers wired.
    assert.match(JUDGE_SRC, /SEVERITY=SEVERE drift/);
    assert.match(JUDGE_SRC, /SEVERITY=MILD drift/);
    assert.match(JUDGE_SRC, /SEVERITY=HARD contradiction/);
    assert.match(JUDGE_SRC, /SEVERITY=PARTIAL contradiction/);
    assert.match(JUDGE_SRC, /REFUSAL_VOICE=BROKEN/);
  });
});
