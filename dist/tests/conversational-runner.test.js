import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeConversationalEfficiency, sanitizeVisibleReasoning, shouldSuppressVisibleReasoning } from "../core/conversational-runner.js";
function manifest(overrides = {}) {
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
        const result = computeConversationalEfficiency(manifest({
            constraints: {
                time_limit_sec: 400,
                max_total_tokens: 6000,
            },
        }), 90_000, 1200, 800);
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
    });
    it("suppresses visible reasoning for normal benchmark families", () => {
        assert.equal(shouldSuppressVisibleReasoning(manifest({ family: "personality" })), true);
        assert.equal(shouldSuppressVisibleReasoning(manifest({ family: "classification" })), true);
    });
    it("keeps thinking-mode tasks opt-in so the dedicated lane can still compare policies", () => {
        assert.equal(shouldSuppressVisibleReasoning(manifest({ family: "thinking-mode" })), false);
    });
});
//# sourceMappingURL=conversational-runner.test.js.map