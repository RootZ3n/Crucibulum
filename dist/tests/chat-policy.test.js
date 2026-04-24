import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildOpenAIChatBody } from "../adapters/openai.js";
import { buildOpenRouterChatBody } from "../adapters/openrouter.js";
import { buildGoogleGenerationConfig } from "../adapters/google.js";
describe("provider benchmark chat policy", () => {
    it("maps benchmark reasoning-off policy into OpenAI reasoning_effort for GPT-5", () => {
        const body = buildOpenAIChatBody("gpt-5.4", [{ role: "user", content: "Hi" }], {
            benchmarkMode: true,
            suppressVisibleReasoning: true,
            reasoningEffort: "off",
        });
        assert.equal(body.reasoning_effort, "none");
    });
    it("maps benchmark reasoning-off policy into OpenRouter native reasoning controls", () => {
        const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "any-model", [{ role: "user", content: "Hi" }], {
            benchmarkMode: true,
            suppressVisibleReasoning: true,
            reasoningEffort: "off",
        });
        assert.deepEqual(body.reasoning, { exclude: true, effort: "none" });
    });
    it("does not send OpenRouter-native reasoning payloads to generic compatible endpoints", () => {
        const body = buildOpenRouterChatBody("openrouter", "https://example.com/v1", "any-model", [{ role: "user", content: "Hi" }], {
            benchmarkMode: true,
            suppressVisibleReasoning: true,
            reasoningEffort: "off",
        });
        assert.equal("reasoning" in body, false);
    });
    it("maps benchmark reasoning-off policy into Gemini thinkingBudget=0", () => {
        const config = buildGoogleGenerationConfig({
            benchmarkMode: true,
            suppressVisibleReasoning: true,
            reasoningEffort: "off",
        });
        assert.deepEqual(config.thinkingConfig, { thinkingBudget: 0 });
    });
});
//# sourceMappingURL=chat-policy.test.js.map