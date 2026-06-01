import { describe, it, afterEach } from "node:test";
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

  it("keeps mandatory-reasoning Gemini OpenRouter models on minimal hidden reasoning", () => {
    const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "google/gemini-3.5-flash", [{ role: "user", content: "Hi" }], {
      benchmarkMode: true,
      suppressVisibleReasoning: true,
      reasoningEffort: "off",
    });
    assert.deepEqual(body.reasoning, { exclude: true, effort: "minimal" });
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

describe("OpenRouter output-token cap", () => {
  const realEnv = process.env["OPENROUTER_MAX_OUTPUT_TOKENS"];
  afterEach(() => {
    if (realEnv === undefined) delete process.env["OPENROUTER_MAX_OUTPUT_TOKENS"];
    else process.env["OPENROUTER_MAX_OUTPUT_TOKENS"] = realEnv;
  });

  it("defaults to 8192 when nothing overrides it", () => {
    delete process.env["OPENROUTER_MAX_OUTPUT_TOKENS"];
    const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "any-model", [{ role: "user", content: "Hi" }]);
    assert.equal(body.max_tokens, 8192);
  });

  it("honours an explicit per-call maxTokens option", () => {
    delete process.env["OPENROUTER_MAX_OUTPUT_TOKENS"];
    const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "any-model", [{ role: "user", content: "Hi" }], {
      maxTokens: 512,
    });
    assert.equal(body.max_tokens, 512);
  });

  it("honours the OPENROUTER_MAX_OUTPUT_TOKENS env cap (covers chat + execute paths)", () => {
    process.env["OPENROUTER_MAX_OUTPUT_TOKENS"] = "1024";
    const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "any-model", [{ role: "user", content: "Hi" }]);
    assert.equal(body.max_tokens, 1024);
  });

  it("ignores a malformed env value rather than collapsing the cap to zero", () => {
    process.env["OPENROUTER_MAX_OUTPUT_TOKENS"] = "not-a-number";
    const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "any-model", [{ role: "user", content: "Hi" }]);
    assert.equal(body.max_tokens, 8192);
  });

  it("an explicit option beats the env cap", () => {
    process.env["OPENROUTER_MAX_OUTPUT_TOKENS"] = "1024";
    const body = buildOpenRouterChatBody("openrouter", "https://openrouter.ai/api/v1", "any-model", [{ role: "user", content: "Hi" }], {
      maxTokens: 256,
    });
    assert.equal(body.max_tokens, 256);
  });
});
