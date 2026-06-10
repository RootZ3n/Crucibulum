/**
 * Pair-aware aggregation for prompt-sensitivity tasks.
 *
 * A paired test means "same intent, different phrasing — both must give the
 * same answer to pass." Scored independently, an inconsistent pair (one
 * phrasing right, the other wrong) banks half credit, so a model can clear the
 * 0.7 threshold while contradicting itself. enforcePairConsistency collapses
 * any disagreeing pair to 0 so inconsistency is fatal, not merely costly.
 * (Audit prompt-sensitivity-001.)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ConversationalManifest, ConversationalResult, ConversationalQuestion } from "../adapters/base.js";
import { enforcePairConsistency, loadConversationalManifest } from "../core/conversational-runner.js";

function q(id: string, pairTag: string): ConversationalQuestion {
  return { id, question: id, scoring_type: "regex_match", weight: 2, tags: ["prompt-sensitivity", pairTag] };
}

function result(id: string, passed: boolean): ConversationalResult {
  return {
    question_id: id, question: id, response: "x",
    passed, score: passed ? 2 : 0, weight: 2,
    failure_reason: passed ? null : "regex mismatch",
    duration_ms: 1, tokens_in: 1, tokens_out: 1,
  };
}

function manifestOf(...questions: ConversationalQuestion[]): ConversationalManifest {
  return {
    id: "prompt-sensitivity-test", version: "1.0.0", family: "personality",
    execution_mode: "conversational", difficulty: "hard", description: "paired",
    questions, scoring: { pass_threshold: 0.7 },
    metadata: { author: "test", created: "2026-06-10", tags: [], diagnostic_purpose: "test" },
  };
}

describe("enforcePairConsistency", () => {
  it("collapses an inconsistent pair (one pass / one fail) to all-fail", () => {
    const manifest = manifestOf(q("Q1a", "pair-1"), q("Q1b", "pair-1"));
    const results = [result("Q1a", true), result("Q1b", false)];
    enforcePairConsistency(manifest, results);
    assert.equal(results[0]!.passed, false, "the lucky-phrasing pass must be demoted");
    assert.equal(results[0]!.score, 0);
    assert.match(String(results[0]!.failure_reason), /PAIR_INCONSISTENT/);
    assert.equal(results[1]!.passed, false);
    assert.equal(results.reduce((s, r) => s + r.score, 0), 0, "an inconsistent pair scores 0, not 50%");
  });

  it("leaves a consistent all-pass pair untouched", () => {
    const manifest = manifestOf(q("Q2a", "pair-2"), q("Q2b", "pair-2"));
    const results = [result("Q2a", true), result("Q2b", true)];
    enforcePairConsistency(manifest, results);
    assert.ok(results.every((r) => r.passed && r.score === 2));
  });

  it("leaves a consistent all-fail pair untouched", () => {
    const manifest = manifestOf(q("Q3a", "pair-3"), q("Q3b", "pair-3"));
    const results = [result("Q3a", false), result("Q3b", false)];
    enforcePairConsistency(manifest, results);
    assert.ok(results.every((r) => !r.passed && r.score === 0));
  });

  it("only affects the disagreeing pair, not other consistent pairs", () => {
    const manifest = manifestOf(
      q("Q1a", "pair-1"), q("Q1b", "pair-1"),
      q("Q2a", "pair-2"), q("Q2b", "pair-2"),
    );
    const results = [
      result("Q1a", true), result("Q1b", false), // inconsistent → 0
      result("Q2a", true), result("Q2b", true),  // consistent → kept
    ];
    enforcePairConsistency(manifest, results);
    assert.equal(results[0]!.score, 0);
    assert.equal(results[1]!.score, 0);
    assert.equal(results[2]!.score, 2);
    assert.equal(results[3]!.score, 2);
  });

  it("is inert on tasks with no pair- tags", () => {
    const manifest = manifestOf(
      { id: "A", question: "A", scoring_type: "regex_match", weight: 1, tags: ["personality"] },
      { id: "B", question: "B", scoring_type: "regex_match", weight: 1, tags: ["personality"] },
    );
    const results = [result("A", true), result("B", false)];
    enforcePairConsistency(manifest, results);
    assert.equal(results[0]!.passed, true, "no pair tags → no collapse");
  });

  it("turns the audit's '6/8 still passes' scenario into a fail on the real manifest", () => {
    // 4 pairs, weight 2 each (16 total). The audit's bug: two pairs answered
    // inconsistently (one phrasing right, one wrong) leave 6 of 8 questions
    // passing independently = 12/16 = 0.75 > 0.7, so the task PASSES despite
    // two self-contradictions. After collapse those two pairs score 0, giving
    // 8/16 = 0.5 < 0.7 — inconsistency is now fatal.
    const manifest = loadConversationalManifest("prompt-sensitivity-001");
    assert.equal(manifest.questions.length, 8);
    const failed = new Set(["PS1-Q1b", "PS1-Q2b"]); // break one member of pair-1 and pair-2
    const results = manifest.questions.map((x) => result(x.id, !failed.has(x.id)));

    const independent = results.reduce((s, r) => s + r.score, 0) / results.reduce((s, r) => s + r.weight, 0);
    assert.ok(independent > 0.7, `independent scoring should pass under the bug (got ${independent})`);

    enforcePairConsistency(manifest, results);
    const collapsed = results.reduce((s, r) => s + r.score, 0) / results.reduce((s, r) => s + r.weight, 0);
    assert.ok(collapsed < 0.7, `two inconsistent pairs must drop below threshold (got ${collapsed})`);
  });
});
