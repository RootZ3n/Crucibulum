import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAdapterCatalog, listFlattenedModels, getProviderCatalog, } from "../adapters/registry.js";
const realFetch = globalThis.fetch;
const realOpenRouterKey = process.env["OPENROUTER_API_KEY"];
const realOpenAIKey = process.env["OPENAI_API_KEY"];
function mockFetch(opts) {
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
            if (opts?.ollamaDown)
                throw new Error("Connection refused");
            return new Response(JSON.stringify({
                models: [
                    { name: "qwen3.5:9b", details: { family: "qwen3", parameter_size: "9b" } },
                    { name: "gemma4:26b", details: { family: "gemma4", parameter_size: "26b" } },
                ],
            }), { status: 200 });
        }
        if (url.includes("openrouter.ai") && url.endsWith("/models")) {
            if (opts?.openrouterDown)
                throw new Error("Network error");
            const auth = init?.headers?.["Authorization"] ?? "";
            if (!auth.includes("Bearer"))
                return new Response("Unauthorized", { status: 401 });
            return new Response(JSON.stringify({
                data: [
                    { id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini", context_length: 128000 },
                    { id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4", context_length: 200000 },
                ],
            }), { status: 200 });
        }
        if (url.includes("api.openai.com") && url.endsWith("/models")) {
            if (opts?.openaiDown)
                throw new Error("Network error");
            const auth = init?.headers?.["Authorization"] ?? "";
            if (!auth.includes("Bearer"))
                return new Response("Unauthorized", { status: 401 });
            return new Response(JSON.stringify({
                data: [
                    { id: "gpt-4.1-mini", owned_by: "openai" },
                    { id: "gpt-4.1", owned_by: "openai" },
                ],
            }), { status: 200 });
        }
        if (url.endsWith("/models")) {
            return new Response("Unauthorized", { status: 401 });
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
}
describe("adapter and selection catalog", () => {
    beforeEach(() => {
        delete process.env["OPENROUTER_API_KEY"];
        delete process.env["OPENAI_API_KEY"];
    });
    afterEach(() => {
        globalThis.fetch = realFetch;
        if (realOpenRouterKey === undefined)
            delete process.env["OPENROUTER_API_KEY"];
        else
            process.env["OPENROUTER_API_KEY"] = realOpenRouterKey;
        if (realOpenAIKey === undefined)
            delete process.env["OPENAI_API_KEY"];
        else
            process.env["OPENAI_API_KEY"] = realOpenAIKey;
    });
    it("returns the current adapter catalog including local, cloud, and subprocess entries", async () => {
        mockFetch();
        const catalog = await getAdapterCatalog();
        const ids = catalog.map((entry) => entry.id);
        for (const id of ["ollama", "openrouter", "openai", "openclaw", "claudecode", "squidley"]) {
            assert.ok(ids.includes(id), `expected adapter ${id} in catalog`);
        }
    });
    it("keeps per-adapter failures isolated", async () => {
        process.env["OPENROUTER_API_KEY"] = "test-key";
        mockFetch({ ollamaDown: true });
        const catalog = await getAdapterCatalog();
        const ollama = catalog.find((entry) => entry.id === "ollama");
        const openrouter = catalog.find((entry) => entry.id === "openrouter");
        assert.equal(ollama?.available, false);
        assert.equal(openrouter?.available, true);
    });
    it("flattens discovered models across adapters", async () => {
        process.env["OPENROUTER_API_KEY"] = "test-key";
        process.env["OPENAI_API_KEY"] = "test-key";
        mockFetch();
        const models = await listFlattenedModels();
        assert.ok(models.some((model) => model.adapter === "ollama" && model.id === "gemma4:26b"));
        assert.ok(models.some((model) => model.adapter === "openrouter" && model.id === "openai/gpt-4.1-mini"));
        assert.ok(models.some((model) => model.adapter === "openai" && model.id === "gpt-4.1-mini"));
    });
    it("exposes provider catalog metadata from adapters", async () => {
        mockFetch();
        const result = await getProviderCatalog();
        assert.ok(Array.isArray(result.providers));
        assert.equal(result.judge.kind, "deterministic");
        assert.ok(result.providers.some((provider) => provider.id === "ollama"));
        assert.ok(result.providers.some((provider) => provider.id === "openai"));
    });
    // NOTE: Two prior UI-source-grep assertions ("current UI bootstraps
    // catalogs …", "current UI exposes lane summary …") were removed. They
    // matched literal JS-bundle text and copy like "Lane summary" that
    // changed with every UI pass. Real coverage now lives in
    // tests/route-contract.test.ts and tests/ui-layout-regression.test.ts.
});
//# sourceMappingURL=adapter-selection.test.js.map