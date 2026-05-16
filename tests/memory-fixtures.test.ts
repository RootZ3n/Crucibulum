import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ConversationalManifest } from "../adapters/base.js";

const MEMORY_TASKS = ["memory-001", "memory-002", "memory-003"] as const;

type MemoryExpectation = {
  operation: "recall" | "update" | "forget";
  setup_turns: string[];
  targets: string[];
  scope: string;
  pass: string;
  partial: string;
  fail: string;
  infra_failure: string;
};

function loadMemoryManifest(taskId: string): ConversationalManifest & { metadata: ConversationalManifest["metadata"] & { memory_expectation?: MemoryExpectation } } {
  return JSON.parse(readFileSync(join(process.cwd(), "tasks", "memory", taskId, "manifest.json"), "utf-8"));
}

describe("memory fixture validity", () => {
  for (const taskId of MEMORY_TASKS) {
    it(`${taskId} records explicit memory expectations and scoped sessions`, () => {
      const manifest = loadMemoryManifest(taskId);
      const expectation = manifest.metadata.memory_expectation;
      assert.equal(manifest.family, "memory");
      assert.equal(manifest.execution_mode, "conversational");
      assert.ok(manifest.session?.session_id?.startsWith("memory-"), "memory fixtures must use explicit memory session ids");
      assert.equal(manifest.session?.resume, false, "release fixtures must not accidentally resume stale state");
      assert.ok(expectation, "memory_expectation metadata is required");
      assert.ok(["recall", "update", "forget"].includes(expectation!.operation));
      assert.ok(expectation!.setup_turns.length > 0);
      assert.ok(expectation!.targets.length > 0);
      assert.match(expectation!.scope, /session/);
      assert.ok(expectation!.pass.length > 0);
      assert.ok(expectation!.partial.length > 0);
      assert.ok(expectation!.fail.length > 0);
      assert.ok(expectation!.infra_failure.length > 0);
    });
  }

  it("memory-001 tests delayed recall without leaking both answers in recall prompts", () => {
    const manifest = loadMemoryManifest("memory-001");
    const questions = manifest.questions.map((q) => q.question.toLowerCase()).join("\n");
    assert.match(manifest.questions[0]!.setup ?? "", /ember-owl/);
    assert.match(manifest.questions[0]!.setup ?? "", /Cobalt-9/);
    assert.doesNotMatch(questions, /ember-owl|cobalt-9/);
    assert.equal(manifest.questions[0]!.setup_gap, 4);
  });

  it("memory-002 verifies honest non-recall instead of leaking missing answers", () => {
    const manifest = loadMemoryManifest("memory-002");
    const promptText = manifest.questions.map((q) => `${q.setup ?? ""}\n${q.question}`).join("\n").toLowerCase();
    assert.match(promptText, /favorite season is autumn/);
    assert.doesNotMatch(promptText, /denver|chicago|boston|fido|spot|buddy/);
    assert.ok(manifest.questions.every((q) => q.scoring_type === "refusal_check"));
  });

  it("memory-003 verifies update and contradiction handling", () => {
    const manifest = loadMemoryManifest("memory-003");
    assert.equal(manifest.metadata.memory_expectation?.operation, "update");
    assert.ok(manifest.questions.some((q) => /correction/i.test(q.question)));
    assert.ok(manifest.questions.every((q) => q.pass_phrases?.some((phrase) => /contradiction/i.test(phrase))));
  });
});
