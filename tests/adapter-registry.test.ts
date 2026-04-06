import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAdapterCatalog, listFlattenedModels, listRegisteredAdapters } from "../adapters/registry.js";

const realFetch = globalThis.fetch;
const realOpenRouterKey = process.env["OPENROUTER_API_KEY"];

describe("adapter registry", () => {
  beforeEach(() => {
    delete process.env["OPENROUTER_API_KEY"];
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realOpenRouterKey === undefined) delete process.env["OPENROUTER_API_KEY"];
    else process.env["OPENROUTER_API_KEY"] = realOpenRouterKey;
  });

  it("lists all implemented adapters", () => {
    const ids = listRegisteredAdapters().map((entry) => entry.id).sort();
    assert.deepEqual(ids, ["claudecode", "ollama", "openai", "openclaw", "openrouter"]);
  });

  it("surfaces explicit unavailable state for openrouter when api key is missing", async () => {
    globalThis.fetch = (async (input) => {
      const url = String(input);
      if (url.includes("/api/tags")) {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (url.includes("/models")) {
        // OpenAI / OpenRouter without key — health check will fail before reaching here
        return new Response("Unauthorized", { status: 401 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const catalog = await getAdapterCatalog();
    const openrouter = catalog.find((entry) => entry.id === "openrouter");
    assert.ok(openrouter);
    assert.equal(openrouter.available, false);
    assert.match(openrouter.reason || "", /API_KEY/i);
  });

  it("flattens adapter-backed model availability from registry APIs", async () => {
    process.env["OPENROUTER_API_KEY"] = "test-key";
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      if (url.includes("/api/tags")) {
        return new Response(JSON.stringify({
          models: [{ name: "gemma4:26b", details: { family: "gemma4", parameter_size: "26b" } }],
        }), { status: 200 });
      }
      if (url.endsWith("/models")) {
        assert.match(String((init && init.headers && (init.headers as Record<string, string>)["Authorization"]) || ""), /Bearer/);
        return new Response(JSON.stringify({
          data: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", context_length: 128000 }],
        }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    const models = await listFlattenedModels();
    assert.ok(models.some((model) => model.adapter === "ollama" && model.id === "gemma4:26b"));
    assert.ok(models.some((model) => model.adapter === "openrouter" && model.id === "openai/gpt-4.1-mini"));
  });
});
