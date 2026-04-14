/**
 * Tests for the current provider/model flow:
 * - Provider truth through adapter metadata
 * - Provider catalog status wording
 * - Model-driven routing in the current UI
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getAdapterCatalog, getProviderCatalog } from "../adapters/registry.js";
const realFetch = globalThis.fetch;
const realOpenRouterKey = process.env["OPENROUTER_API_KEY"];
const realOpenAIKey = process.env["OPENAI_API_KEY"];
function mockFetch() {
    globalThis.fetch = (async (input, init) => {
        const url = String(input);
        if (url.includes("/api/tags")) {
            return new Response(JSON.stringify({
                models: [{ name: "gemma4:26b" }],
            }), { status: 200 });
        }
        if (url.includes("openrouter.ai") && url.endsWith("/models")) {
            const auth = init?.headers?.["Authorization"] ?? "";
            if (!auth.includes("Bearer"))
                return new Response("Unauthorized", { status: 401 });
            return new Response(JSON.stringify({
                data: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" }],
            }), { status: 200 });
        }
        if (url.includes("api.openai.com") && url.endsWith("/models")) {
            const auth = init?.headers?.["Authorization"] ?? "";
            if (!auth.includes("Bearer"))
                return new Response("Unauthorized", { status: 401 });
            return new Response(JSON.stringify({
                data: [{ id: "gpt-4.1-mini", owned_by: "openai" }],
            }), { status: 200 });
        }
        if (url.endsWith("/models")) {
            return new Response("Unauthorized", { status: 401 });
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
}
describe("provider flow validation", () => {
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
    describe("adapter metadata provider identity", () => {
        it("ollama adapter remains fixed to ollama provider identity", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            const ollama = catalog.find((e) => e.id === "ollama");
            assert.ok(ollama);
            assert.equal(ollama.fixed_provider, "ollama");
        });
        it("openai adapter remains fixed to openai provider identity", async () => {
            process.env["OPENAI_API_KEY"] = "test-key";
            mockFetch();
            const catalog = await getAdapterCatalog();
            const openai = catalog.find((e) => e.id === "openai");
            assert.ok(openai);
            assert.equal(openai.fixed_provider, "openai");
            assert.equal(openai.id, "openai");
        });
        it("squidley is configurable rather than fixed to one provider", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            const squidley = catalog.find((e) => e.id === "squidley");
            assert.ok(squidley);
            assert.equal(squidley.provider_mode, "configurable");
            assert.equal(squidley.fixed_provider, null);
        });
    });
    describe("provider catalog wording", () => {
        it("missing API key reasons mention the required env var", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            const openai = result.providers.find((p) => p.id === "openai");
            const openrouter = result.providers.find((p) => p.id === "openrouter");
            assert.ok(openai?.reason?.includes("OPENAI_API_KEY"));
            assert.ok(openrouter?.reason?.includes("OPENROUTER_API_KEY"));
        });
        it("configured providers expose discovered models", async () => {
            process.env["OPENROUTER_API_KEY"] = "test-key";
            process.env["OPENAI_API_KEY"] = "test-key";
            mockFetch();
            const result = await getProviderCatalog();
            assert.ok((result.providers.find((p) => p.id === "openrouter")?.models.length ?? 0) > 0);
            assert.ok((result.providers.find((p) => p.id === "openai")?.models.length ?? 0) > 0);
        });
        it("returns judge metadata and a notImplemented list shape even when empty", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            assert.equal(result.judge.kind, "deterministic");
            assert.ok(Array.isArray(result.notImplemented));
        });
    });
    // NOTE: A prior "current UI routing contract" subsuite of source-string
    // assertions was removed. Those tests grepped ui/index.html for specific
    // function names, label copy, and CSS breakpoints — all of which drifted
    // every time the UI was touched and caught zero real regressions.
    // Behavioral coverage for UI-facing endpoints now lives in
    // tests/route-contract.test.ts; layout invariants in tests/ui-layout-regression.test.ts.
});
//# sourceMappingURL=provider-flow.test.js.map