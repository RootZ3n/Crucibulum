import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ConversationalManifest } from "../adapters/base.js";
import { computeConversationalEfficiency, sanitizeVisibleReasoning, shouldSuppressVisibleReasoning } from "../core/conversational-runner.js";

function manifest(overrides: Partial<ConversationalManifest> = {}): ConversationalManifest {
  return {
    id: "conv-test-001",
    version: "1.0.0",
    family: "truthfulness",
    execution_mode: "conversational",
    difficulty: "medium",
    description: "fixture",
    questions: [
      {
        id: "q1",
        question: "What is 2+2?",
        scoring_type: "text_match",
        pass_phrases: ["4"],
        weight: 1,
        tags: [],
      },
      {
        id: "q2",
        question: "Repeat 4.",
        scoring_type: "text_match",
        pass_phrases: ["4"],
        weight: 1,
        tags: [],
      },
    ],
    scoring: {
      pass_threshold: 0.7,
    },
    metadata: {
      author: "test",
      created: "2026-04-11",
      tags: [],
      diagnostic_purpose: "test",
    },
    ...overrides,
  };
}

describe("computeConversationalEfficiency", () => {
  it("penalizes excessive duration and tokens", () => {
    const result = computeConversationalEfficiency(manifest(), 240_000, 2500, 1800);
    assert.equal(result.time_limit_sec, 120);
    assert.equal(result.steps_used, 2);
    assert.ok(result.score < 0.5, `expected penalty, got ${result.score}`);
  });

  it("uses manifest constraints when provided", () => {
    const result = computeConversationalEfficiency(
      manifest({
        constraints: {
          time_limit_sec: 400,
          max_total_tokens: 6000,
        },
      }),
      90_000,
      1200,
      800,
    );

    assert.equal(result.time_limit_sec, 400);
    assert.ok(result.score > 0.8, `expected relaxed budget to pass comfortably, got ${result.score}`);
  });

  it("treats cost efficiency tasks more strictly on token usage", () => {
    const costManifest = manifest({
      family: "cost_efficiency",
      metadata: {
        author: "test",
        created: "2026-04-11",
        tags: [],
        diagnostic_purpose: "test",
      },
    });

    const result = computeConversationalEfficiency(costManifest, 30_000, 1200, 900);
    assert.equal(result.time_limit_sec, 90);
    assert.ok(result.score < 0.8, `expected tighter token budget to matter, got ${result.score}`);
  });
});

describe("conversational benchmark reasoning policy", () => {
  it("strips visible <think> blocks before scoring", () => {
    const sanitized = sanitizeVisibleReasoning("<think> The user is asking a question </think>question");
    assert.equal(sanitized.text, "question");
    assert.equal(sanitized.strippedVisibleReasoning, true);
    assert.deepEqual(sanitized.tags, ["think"]);
    assert.equal(sanitized.rawText, "<think> The user is asking a question </think>question");
  });

  it("strips alternate thinking-block shapes (reasoning/thought/analysis/scratchpad)", () => {
    const variants: Array<[string, string, string]> = [
      ["<reasoning>let me think</reasoning>final", "final", "reasoning_tag"],
      ["<thought>plan</thought>final", "final", "thought_tag"],
      ["<analysis>weigh options</analysis>final", "final", "analysis_tag"],
      ["<scratchpad>scratch</scratchpad>final", "final", "scratchpad_tag"],
      ["<thinking>blah</thinking>final", "final", "thinking"],
    ];
    for (const [input, expected, expectedTag] of variants) {
      const s = sanitizeVisibleReasoning(input);
      assert.equal(s.text, expected, `${input} -> "${s.text}"`);
      assert.equal(s.strippedVisibleReasoning, true, input);
      assert.ok(s.tags.includes(expectedTag), `${input} should tag ${expectedTag}`);
    }
  });

  it("strips bracket-style [thinking]…[/thinking] blocks", () => {
    const s = sanitizeVisibleReasoning("[thinking]plan plan[/thinking]ANSWER");
    assert.equal(s.text, "ANSWER");
    assert.equal(s.strippedVisibleReasoning, true);
    assert.ok(s.tags.includes("bracket_thinking"));
  });

  it("strips OpenAI channel-style analysis chain-of-thought", () => {
    const input = "<|channel|>analysis<|message|>let me think about this carefully<|channel|>final<|message|>RESULT";
    const s = sanitizeVisibleReasoning(input);
    assert.equal(s.text, "RESULT");
    assert.equal(s.strippedVisibleReasoning, true);
    assert.ok(s.tags.includes("channel_analysis"));
  });

  it("strips dangling/half-closed thinking tags", () => {
    const s = sanitizeVisibleReasoning("<think>partial leak\nactual answer");
    assert.ok(!s.text.includes("<think"));
    assert.equal(s.strippedVisibleReasoning, true);
    assert.ok(s.tags.includes("think"));
  });

  it("strips a markdown 'Thinking:' preamble at the start of the response", () => {
    const s = sanitizeVisibleReasoning("Thinking: I should compute 2+2.\n\nThe answer is 4.");
    assert.equal(s.text, "The answer is 4.");
    assert.equal(s.strippedVisibleReasoning, true);
    assert.ok(s.tags.includes("markdown_heading"));
  });

  it("preserves raw text and reports no strip when content is plain prose", () => {
    const s = sanitizeVisibleReasoning("Hello, the answer is 4.");
    assert.equal(s.text, "Hello, the answer is 4.");
    assert.equal(s.strippedVisibleReasoning, false);
    assert.deepEqual(s.tags, []);
    assert.equal(s.rawText, "Hello, the answer is 4.");
  });

  it("does not damage code blocks that mention 'thinking' inside the body", () => {
    // A code task that legitimately uses the word "thinking" later in the
    // response must not be cut. The sanitizer only touches block-shaped
    // markers and a top-of-response markdown preface — never running prose.
    const code = "Here's the patch:\n\n```js\nfunction think(thinking) { return 2 + 2; }\n```\n\nThe function returns 4.";
    const s = sanitizeVisibleReasoning(code);
    assert.equal(s.text, code);
    assert.equal(s.strippedVisibleReasoning, false);
  });

  it("does not strip inner code that contains XML-like words 'analysis' as identifiers", () => {
    const code = "Use this function:\n\n```js\nfunction analysis(x){return x*2;}\n```";
    const s = sanitizeVisibleReasoning(code);
    assert.equal(s.text, code);
    assert.equal(s.strippedVisibleReasoning, false);
  });

  it("suppresses visible reasoning for normal benchmark families", () => {
    assert.equal(shouldSuppressVisibleReasoning(manifest({ family: "personality" })), true);
    assert.equal(shouldSuppressVisibleReasoning(manifest({ family: "classification" })), true);
  });

  it("keeps thinking-mode tasks opt-in so the dedicated lane can still compare policies", () => {
    assert.equal(shouldSuppressVisibleReasoning(manifest({ family: "thinking-mode" })), false);
  });

  it("respects manifest-level thinking_mode = preserve override", () => {
    assert.equal(
      shouldSuppressVisibleReasoning(manifest({ family: "personality", thinking_mode: "preserve" })),
      false,
    );
  });

  it("respects manifest-level thinking_mode = off override even on a thinking-mode family", () => {
    assert.equal(
      shouldSuppressVisibleReasoning(manifest({ family: "thinking-mode", thinking_mode: "off" })),
      true,
    );
  });
});
