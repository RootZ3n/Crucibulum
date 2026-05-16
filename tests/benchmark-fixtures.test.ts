import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import type { ConversationalManifest, TaskManifest } from "../adapters/base.js";
import { resolveOraclePath } from "../core/oracle.js";

const BENCHMARK_FAMILIES = new Set(["truthfulness", "cost_efficiency"]);

function manifests(): Array<{ path: string; manifest: any }> {
  const out: Array<{ path: string; manifest: any }> = [];
  for (const family of readdirSync("tasks", { withFileTypes: true })) {
    if (!family.isDirectory()) continue;
    const familyDir = join("tasks", family.name);
    for (const task of readdirSync(familyDir, { withFileTypes: true })) {
      if (!task.isDirectory()) continue;
      const path = join(familyDir, task.name, "manifest.json");
      if (!existsSync(path)) continue;
      out.push({ path, manifest: JSON.parse(readFileSync(path, "utf-8")) });
    }
  }
  return out;
}

describe("benchmark fixture audit", () => {
  it("keeps conversational benchmark fixtures complete and scorable", () => {
    const manifestsUnderTest = manifests()
      .map((entry) => entry.manifest as ConversationalManifest)
      .filter((manifest) => manifest.execution_mode === "conversational" && BENCHMARK_FAMILIES.has(manifest.family));

    assert.ok(manifestsUnderTest.length >= 8, "expected benchmark conversational manifests");

    for (const manifest of manifestsUnderTest) {
      assert.equal(manifest.execution_mode, "conversational", `${manifest.id}: execution mode`);
      assert.ok(manifest.description.trim(), `${manifest.id}: description`);
      assert.ok(manifest.scoring.pass_threshold > 0 && manifest.scoring.pass_threshold <= 1, `${manifest.id}: pass threshold`);
      assert.ok(manifest.metadata.benchmark_provenance, `${manifest.id}: benchmark provenance`);
      assert.ok(manifest.metadata.benchmark_provenance?.known_scoring_limitations.length, `${manifest.id}: scoring limitations`);

      for (const question of manifest.questions) {
        assert.ok(question.id.trim(), `${manifest.id}: question id`);
        assert.ok(question.question.trim().length >= 12, `${manifest.id}/${question.id}: prompt too short`);
        assert.ok(question.weight > 0, `${manifest.id}/${question.id}: non-positive weight`);
        assert.ok(question.tags.length > 0, `${manifest.id}/${question.id}: missing category tags`);

        if (question.scoring_type === "text_match" || question.scoring_type === "text_match_all" || question.scoring_type === "recall" || question.scoring_type === "correction" || question.scoring_type === "proactive") {
          assert.ok(question.pass_phrases?.length, `${manifest.id}/${question.id}: pass_phrases required`);
          const broad = question.scoring_type === "text_match"
            ? question.pass_phrases!.filter((phrase) => phrase.trim().length < 4)
            : [];
          assert.deepEqual(broad, [], `${manifest.id}/${question.id}: overly broad pass phrase can create false positives`);
        }
        if (question.scoring_type === "regex_match") {
          assert.ok(question.pattern?.trim(), `${manifest.id}/${question.id}: regex pattern required`);
          assert.doesNotThrow(() => new RegExp(question.pattern!, "iu"), `${manifest.id}/${question.id}: regex must compile`);
        }
        if (question.scoring_type === "custom") {
          assert.ok(question.custom_scorer?.trim(), `${manifest.id}/${question.id}: custom scorer id required`);
        }
      }
    }
  });

  it("keeps repo-mode spec benchmark fixtures wired to real prompts and oracles", () => {
    const manifestsUnderTest = manifests()
      .filter((entry) => entry.manifest.family === "spec_discipline")
      .map((entry) => ({ path: entry.path, manifest: entry.manifest as TaskManifest }));

    assert.ok(manifestsUnderTest.length >= 5, "expected repo-mode spec benchmark manifests");

    for (const { path, manifest } of manifestsUnderTest) {
      assert.ok(manifest.task.description.trim().length >= 20, `${manifest.id}: benign task description`);
      assert.ok(manifest.task.entrypoints.length > 0, `${manifest.id}: entrypoints`);
      assert.ok(manifest.metadata.benchmark_provenance, `${manifest.id}: benchmark provenance`);
      assert.ok(manifest.verification.public_tests_command || manifest.verification.build_command, `${manifest.id}: visible verification command`);
      assert.ok(manifest.oracle_ref.path.trim(), `${manifest.id}: oracle path`);

      const oraclePath = resolveOraclePath(manifest);
      assert.ok(existsSync(oraclePath), `${manifest.id}: oracle exists at ${relative(process.cwd(), oraclePath)}`);

      const weights = manifest.scoring.weights;
      const totalWeight = weights.correctness + weights.regression + weights.integrity + weights.efficiency;
      assert.ok(Math.abs(totalWeight - 1) < 0.0001, `${manifest.id}: scoring weights sum to 1`);
      assert.ok(manifest.scoring.pass_threshold > 0 && manifest.scoring.pass_threshold <= 1, `${manifest.id}: pass threshold`);

      assert.doesNotMatch(JSON.stringify(manifest.task), /gold_solution|expected_answer|oracle_ref/i, `${manifest.id}: sample answer leaked into agent-visible task`);
    }
  });
});
