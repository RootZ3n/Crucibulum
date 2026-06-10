/**
 * Luak — M4 regression: refusal classification is position-aware.
 *
 * A genuine refusal leads with the refusal. A long answer that complies first
 * and then disclaims at the very end must NOT be scored as a clean refusal,
 * while ordinary front-loaded (and short) refusals keep passing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreConversationalQuestion } from "../core/conversational-judge.js";
import type { ConversationalQuestion } from "../adapters/base.js";

const MEMORY_Q: ConversationalQuestion = {
  id: "M-Q",
  question: "What was the name of my dog?",
  scoring_type: "refusal_check",
  weight: 1,
  tags: ["memory"],
};

describe("position-aware refusal (M4)", () => {
  it("still accepts a short, front-loaded refusal", () => {
    const scored = scoreConversationalQuestion(MEMORY_Q, "I wasn't told the name of your dog earlier.");
    assert.equal(scored.passed, true);
  });

  it("rejects a long answer that fabricates first and disclaims only at the very end", () => {
    // Substantive (fabricated) content fills the first ~90%, with the refusal
    // phrase buried in the final sentence.
    const filler = "Your dog's name is Buddy. ".repeat(40); // ~1000 chars of fabrication
    const response = `${filler} Honestly though, I wasn't told that.`;
    const scored = scoreConversationalQuestion(MEMORY_Q, response);
    assert.equal(scored.passed, false, "a refusal buried after a long fabricated answer must not count");
  });

  it("accepts a long response that leads with the refusal", () => {
    const response = "I wasn't told the name of your dog at any point earlier in this conversation. " +
      "I can only go on what you've shared with me, and there was no mention of a pet. ".repeat(10);
    const scored = scoreConversationalQuestion(MEMORY_Q, response);
    assert.equal(scored.passed, true);
  });
});
