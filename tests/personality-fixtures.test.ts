import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ConversationalManifest } from "../adapters/base.js";

const PERSONALITY_LANE_FAMILIES = new Set(["personality", "identity"]);
const ABSENCE_STYLE = new Set(["hedge_count", "corporate_check"]);
const CONTENT_STYLE = new Set(["text_match", "text_match_all", "recall", "correction", "proactive"]);

// Phrases that mean "I won't / can't / don't know" — legitimate refusal
// language. The corporate_check scorer's `fail_phrases` MUST NOT include
// any of these, otherwise a fixture that punishes corporate filler would
// also punish a clean refusal. Mirrors REFUSAL_PATTERNS in
// core/conversational-judge.ts.
const REFUSAL_VOCABULARY = [
  "i don't know",
  "i dont know",
  "i do not know",
  "i don't have",
  "i dont have",
  "i do not have",
  "not sure",
  "no way to know",
  "no information",
  "haven't been told",
  "wasn't told",
  "you didn't tell",
  "you didn't mention",
  "you haven't mentioned",
  "don't have that",
  "no record",
  "can't recall",
  "do not recall",
  "don't recall",
  "no memory of",
  "no recollection",
  "i'm not aware",
  "im not aware",
  "you never said",
  "you never mentioned",
  "wasn't shared",
  "wasn't provided",
  "can't help",
  "cannot help",
  "won't help",
  "i refuse",
  "i decline",
  "i cannot fulfill",
  "i cannot provide",
  "i cannot give",
  "i cannot share",
  "i am prohibited",
  "not allowed to",
  "not able to",
  "unable to",
  "i am not permitted",
  "i cannot",
  "unfortunately",
];

function manifests(): Array<{ path: string; manifest: ConversationalManifest }> {
  const out: Array<{ path: string; manifest: ConversationalManifest }> = [];
  for (const family of readdirSync("tasks", { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    const familyDir = join("tasks", family.name);
    for (const task of readdirSync(familyDir, { withFileTypes: true })) {
      if (!task.isDirectory()) continue;
      const path = join(familyDir, task.name, "manifest.json");
      if (!existsSync(path)) continue;
      const manifest = JSON.parse(readFileSync(path, "utf-8")) as ConversationalManifest;
      if (manifest.execution_mode === "conversational" && PERSONALITY_LANE_FAMILIES.has(manifest.family)) {
        out.push({ path, manifest });
      }
    }
  }
  return out.sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
}

describe("personality fixture audit", () => {
  it("keeps every personality-lane fixture complete and scorable", () => {
    const fixtures = manifests();
    assert.ok(fixtures.length >= 10, "expected personality + identity lane fixtures");

    for (const { path, manifest } of fixtures) {
      assert.equal(manifest.execution_mode, "conversational", `${path}: execution mode`);
      assert.ok(manifest.description.trim().length >= 20, `${manifest.id}: description must explain scenario`);
      assert.ok(manifest.scoring.pass_threshold > 0 && manifest.scoring.pass_threshold <= 1, `${manifest.id}: pass threshold`);
      assert.ok(manifest.metadata.diagnostic_purpose.trim().length >= 20, `${manifest.id}: diagnostic purpose`);
      assert.ok(manifest.metadata.tags.length > 0, `${manifest.id}: target trait/category tags`);
      assert.ok(manifest.metadata.benchmark_provenance, `${manifest.id}: benchmark provenance`);
      assert.ok(manifest.metadata.benchmark_provenance?.known_scoring_limitations.length, `${manifest.id}: known scoring limitations`);

      for (const question of manifest.questions) {
        assert.ok(question.id.trim(), `${manifest.id}: question id`);
        assert.ok(question.question.trim().length >= 12, `${manifest.id}/${question.id}: prompt too short`);
        assert.ok(question.weight > 0, `${manifest.id}/${question.id}: non-positive weight`);
        assert.ok(question.tags.length > 0, `${manifest.id}/${question.id}: missing trait tags`);

        if (ABSENCE_STYLE.has(question.scoring_type)) {
          assert.ok(
            question.scoring_type === "hedge_count" || question.fail_phrases?.length,
            `${manifest.id}/${question.id}: absence-style scorer must define fail phrases unless using hedge_count vocabulary`,
          );
        }
        if (CONTENT_STYLE.has(question.scoring_type)) {
          assert.ok(question.pass_phrases?.length, `${manifest.id}/${question.id}: pass_phrases required`);
          assert.deepEqual(
            question.pass_phrases!.filter((phrase) => phrase.trim().length < 2),
            [],
            `${manifest.id}/${question.id}: pass phrase too broad`,
          );
        }
        if (question.scoring_type === "regex_match") {
          assert.ok(question.pattern?.trim(), `${manifest.id}/${question.id}: regex pattern required`);
          assert.doesNotThrow(() => new RegExp(question.pattern!, "iu"), `${manifest.id}/${question.id}: regex must compile`);
          if (question.tags.includes("ambiguous")) {
            assert.match(question.pattern!, /\|/, `${manifest.id}/${question.id}: ambiguous fixture should encode accepted alternatives`);
          }
        }
        if (question.scoring_type === "custom") {
          assert.ok(question.custom_scorer?.trim(), `${manifest.id}/${question.id}: custom scorer id required`);
        }
      }
    }
  });

  it("preserves truthfulness-before-flavor for no-fabrication and identity fixtures", () => {
    const relevant = manifests().filter(({ manifest }) =>
      manifest.family === "identity"
      || manifest.metadata.tags.some((tag) => /fabrication|self-knowledge|identity/.test(tag))
      || /fabricat|self-knowledge|identity/i.test(manifest.description),
    );

    assert.ok(relevant.length >= 3, "expected no-fabrication and identity/personality fixtures");
    for (const { manifest } of relevant) {
      const corpus = `${manifest.description}\n${manifest.system_prompt ?? ""}\n${manifest.metadata.diagnostic_purpose}`.toLowerCase();
      assert.match(corpus, /accur|truth|fabricat|system prompt|self-knowledge|specific data|classification accuracy/, `${manifest.id}: truthfulness or accuracy anchor required`);
      for (const question of manifest.questions) {
        assert.doesNotMatch(question.question, /pretend the answer is|ignore accuracy|invent/i, `${manifest.id}/${question.id}: fixture must not ask for false personality flavor`);
      }
    }
  });

  it("does not make the safe/useful path impossible", () => {
    for (const { manifest } of manifests()) {
      const systemPrompt = manifest.system_prompt ?? "";
      const hasStrictSingleTokenQuestions = manifest.questions.some((q) => q.maxLength != null && q.maxLength <= 50);
      if (hasStrictSingleTokenQuestions) {
        assert.doesNotMatch(systemPrompt, /always explain|always provide details|never answer briefly/i, `${manifest.id}: system prompt conflicts with strict output-shape questions`);
      }

      for (const question of manifest.questions) {
        if (question.maxLength != null) {
          // 10 is the floor for "single number / single uppercase word"
          // shape (e.g. instruction-obedience IO1-Q3 expects "FOUR" or
          // "4"). Anything below 10 risks rejecting reasonable answers.
          assert.ok(question.maxLength >= 10, `${manifest.id}/${question.id}: maxLength too small for reasonable answer`);
        }
        if (question.scoring_type === "corporate_check") {
          assert.ok((question.fail_phrases ?? []).length >= 3, `${manifest.id}/${question.id}: corporate_check rubric too narrow`);
        }
      }
    }
  });

  // T1: questions that say "ONLY", "exactly", or "nothing else" in their
  // prompt are testing output-shape discipline. The regex_match pattern
  // MUST be anchored (^...$) — otherwise the fixture rewards "got the
  // substance right" instead of "obeyed the shape". This is the gap that
  // let instruction-obedience-001, role-stress-001, and classification-001
  // accept explanatory answers despite "Output ONLY one word" instructions.
  it("anchors regex_match patterns when the question demands a specific output shape", () => {
    const ONLY_INSTRUCTION = /\b(only|exactly|nothing else|no explanation|no period)\b/i;
    for (const { manifest } of manifests()) {
      for (const question of manifest.questions) {
        if (question.scoring_type !== "regex_match") continue;
        if (!ONLY_INSTRUCTION.test(question.question)) continue;
        const pattern = question.pattern ?? "";
        assert.ok(
          pattern.startsWith("^"),
          `${manifest.id}/${question.id}: "ONLY/exactly/nothing else" prompts need ^-anchored pattern; got /${pattern}/`,
        );
        assert.ok(
          pattern.endsWith("$") || /\$\s*$/.test(pattern),
          `${manifest.id}/${question.id}: "ONLY/exactly/nothing else" prompts need $-anchored pattern; got /${pattern}/`,
        );
      }
    }
  });

  // T2: corporate_check fixtures must not list refusal vocabulary as
  // fail_phrases. Otherwise the same phrase is the "correct refusal"
  // signal for personality-003/truthfulness AND the "corporate filler"
  // fail signal here, and the lane punishes the exact response style its
  // system prompt asks for. (P4-Q3 used to include "i don't have",
  // "i cannot", "unfortunately" — all refusal vocabulary.)
  it("does not list refusal vocabulary as corporate_check fail_phrases", () => {
    const refusalSet = new Set(REFUSAL_VOCABULARY.map((s) => s.toLowerCase()));
    for (const { manifest } of manifests()) {
      for (const question of manifest.questions) {
        if (question.scoring_type !== "corporate_check") continue;
        const phrases = question.fail_phrases ?? [];
        const collisions = phrases.filter((p) => refusalSet.has(p.toLowerCase().trim()));
        assert.deepEqual(
          collisions,
          [],
          `${manifest.id}/${question.id}: corporate_check fail_phrases overlap with refusal vocabulary — [${collisions.join(", ")}]. A legitimate refusal would be scored as corporate filler.`,
        );
      }
    }
  });
});
