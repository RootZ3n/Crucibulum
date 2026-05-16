import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { ConversationalManifest } from "../adapters/base.js";

const PERSONALITY_LANE_FAMILIES = new Set(["personality", "identity"]);
const ABSENCE_STYLE = new Set(["hedge_count", "corporate_check"]);
const CONTENT_STYLE = new Set(["text_match", "text_match_all", "recall", "correction", "proactive"]);

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
          assert.ok(question.maxLength >= 15, `${manifest.id}/${question.id}: maxLength too small for reasonable answer`);
        }
        if (question.scoring_type === "corporate_check") {
          assert.ok((question.fail_phrases ?? []).length >= 3, `${manifest.id}/${question.id}: corporate_check rubric too narrow`);
        }
      }
    }
  });
});
