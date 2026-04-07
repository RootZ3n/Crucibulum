import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAdapterCatalog, listFlattenedModels, getProviderCatalog, getNotImplementedProviders, } from "../adapters/registry.js";
const realFetch = globalThis.fetch;
const realOpenRouterKey = process.env["OPENROUTER_API_KEY"];
const realOpenAIKey = process.env["OPENAI_API_KEY"];
const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");
// Helper: mock fetch for Ollama + OpenRouter + OpenAI
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
                    { id: "o3-mini", owned_by: "openai" },
                ],
            }), { status: 200 });
        }
        // Fallback for unmatched /models endpoints (health checks)
        if (url.endsWith("/models")) {
            return new Response("Unauthorized", { status: 401 });
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
}
describe("provider-first selection flow", () => {
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
    // ── Part 1: adapter registry includes OpenAI ──────────────────────────
    describe("adapter catalog", () => {
        it("returns all 5 adapters including OpenAI", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            assert.equal(catalog.length, 5);
            const ids = catalog.map((e) => e.id).sort();
            assert.deepEqual(ids, ["claudecode", "ollama", "openai", "openclaw", "openrouter"]);
        });
        it("each entry has required fields", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            for (const entry of catalog) {
                assert.ok(typeof entry.id === "string" && entry.id.length > 0);
                assert.ok(typeof entry.name === "string" && entry.name.length > 0);
                assert.ok(["local", "cloud", "subprocess"].includes(entry.kind));
                assert.ok(typeof entry.available === "boolean");
                assert.ok(entry.reason === null || typeof entry.reason === "string");
                assert.ok(Array.isArray(entry.models));
                assert.ok(entry.judge && entry.judge.kind === "deterministic");
            }
        });
        it("unavailable adapters have a reason string", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            const unavailable = catalog.filter((e) => !e.available);
            assert.ok(unavailable.length > 0);
            for (const entry of unavailable) {
                assert.ok(typeof entry.reason === "string" && entry.reason.length > 0, `${entry.id} missing reason`);
            }
        });
        it("OpenAI adapter is cloud kind and unavailable without key", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            const openai = catalog.find((e) => e.id === "openai");
            assert.ok(openai);
            assert.equal(openai.kind, "cloud");
            assert.equal(openai.available, false);
            assert.match(openai.reason || "", /OPENAI_API_KEY/);
        });
        it("OpenAI adapter becomes available with key", async () => {
            process.env["OPENAI_API_KEY"] = "test-key";
            mockFetch();
            const catalog = await getAdapterCatalog();
            const openai = catalog.find((e) => e.id === "openai");
            assert.ok(openai);
            assert.equal(openai.available, true);
            assert.ok(openai.models.length > 0, "should discover models with key");
        });
    });
    // ── Part 2: per-adapter error isolation ─────────────────────────────────
    describe("per-adapter error isolation", () => {
        it("one adapter throwing does not break the whole catalog", async () => {
            process.env["OPENROUTER_API_KEY"] = "test-key";
            globalThis.fetch = (async (input, init) => {
                const url = String(input);
                if (url.includes("/api/tags"))
                    throw new Error("Ollama crashed");
                if (url.endsWith("/models")) {
                    return new Response(JSON.stringify({
                        data: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 Mini" }],
                    }), { status: 200 });
                }
                throw new Error(`unexpected: ${url}`);
            });
            const catalog = await getAdapterCatalog();
            assert.equal(catalog.length, 5);
            const ollama = catalog.find((e) => e.id === "ollama");
            assert.ok(ollama);
            assert.equal(ollama.available, false);
            const openrouter = catalog.find((e) => e.id === "openrouter");
            assert.ok(openrouter);
            assert.equal(openrouter.available, true);
        });
    });
    // ── Part 3: provider catalog endpoint ──────────────────────────────────
    describe("provider catalog", () => {
        it("returns providers mapped from adapters", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            assert.ok(Array.isArray(result.providers));
            assert.equal(result.providers.length, 5);
            assert.ok(result.judge);
            assert.equal(result.judge.kind, "deterministic");
        });
        it("each provider has required shape", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            for (const p of result.providers) {
                assert.ok(typeof p.id === "string" && p.id.length > 0);
                assert.ok(typeof p.label === "string" && p.label.length > 0);
                assert.ok(["local", "cloud", "subprocess"].includes(p.kind));
                assert.ok(typeof p.available === "boolean");
                assert.ok(typeof p.manualModelAllowed === "boolean");
                assert.ok(typeof p.adapter === "string");
                assert.ok(Array.isArray(p.models));
            }
        });
        it("includes not-implemented providers list", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            assert.ok(Array.isArray(result.notImplemented));
            assert.ok(result.notImplemented.length > 0);
            for (const p of result.notImplemented) {
                assert.equal(p.implemented, false);
                assert.ok(typeof p.blocker === "string" && p.blocker.length > 0);
                assert.ok(typeof p.envKey === "string");
            }
        });
        it("not-implemented list includes anthropic, google, zai", () => {
            const notImpl = getNotImplementedProviders();
            const ids = notImpl.map((p) => p.id);
            assert.ok(ids.includes("anthropic"));
            assert.ok(ids.includes("google"));
            assert.ok(ids.includes("zai"));
        });
        it("provider with missing key reports reason with env var name", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            const openai = result.providers.find((p) => p.id === "openai");
            assert.ok(openai);
            assert.equal(openai.available, false);
            assert.match(openai.reason || "", /OPENAI_API_KEY/);
        });
        it("provider with configured key is available", async () => {
            process.env["OPENROUTER_API_KEY"] = "test-key";
            mockFetch();
            const result = await getProviderCatalog();
            const openrouter = result.providers.find((p) => p.id === "openrouter");
            assert.ok(openrouter);
            assert.equal(openrouter.available, true);
            assert.ok(openrouter.models.length > 0);
        });
        it("provider models have id and label", async () => {
            process.env["OPENAI_API_KEY"] = "test-key";
            mockFetch();
            const result = await getProviderCatalog();
            const openai = result.providers.find((p) => p.id === "openai");
            assert.ok(openai && openai.models.length > 0);
            for (const m of openai.models) {
                assert.ok(typeof m.id === "string" && m.id.length > 0);
                assert.ok(typeof m.label === "string" && m.label.length > 0);
            }
        });
    });
    // ── Part 4: flattened models ────────────────────────────────────────────
    describe("flattened models", () => {
        it("includes models from multiple adapters", async () => {
            process.env["OPENROUTER_API_KEY"] = "test-key";
            process.env["OPENAI_API_KEY"] = "test-key";
            mockFetch();
            const models = await listFlattenedModels();
            const adapters = new Set(models.map((m) => m.adapter));
            assert.ok(adapters.has("ollama"));
            assert.ok(adapters.has("openrouter"));
            assert.ok(adapters.has("openai"));
        });
    });
    // ── Part 5: UI contract checks ──────────────────────────────────────────
    describe("UI provider-first contract", () => {
        it("loads provider catalog from /api/providers", () => {
            assert.match(ui, /\/api\/providers/);
            assert.match(ui, /providerCatalog/);
        });
        it("has provider dropdown as primary selector", () => {
            assert.match(ui, /id="run-provider"/);
        });
        it("shows 'No providers loaded' when catalog is empty", () => {
            assert.match(ui, /No providers loaded/);
        });
        it("disables unavailable providers in dropdown", () => {
            assert.match(ui, /!entry\.available\s*\?\s*' disabled'\s*:\s*''/);
        });
        it("pipeline summary includes Provider field", () => {
            assert.match(ui, /renderPipelineStage\('Provider'/);
        });
        it("pipeline summary includes Model field", () => {
            assert.match(ui, /renderPipelineStage\('Model'/);
        });
        it("pipeline summary includes Judge and Review fields", () => {
            assert.match(ui, /renderPipelineStage\('Judge'/);
            assert.match(ui, /renderPipelineStage\('Review'/);
        });
        it("run payload sends providerId", () => {
            assert.match(ui, /providerId:\s*providerId/);
        });
        it("validates provider before starting run", () => {
            assert.match(ui, /Select a provider/);
        });
        it("shows not-implemented providers in optgroup", () => {
            assert.match(ui, /Not yet implemented/);
            assert.match(ui, /notImplementedProviders/);
        });
        it("uses provider models for datalist", () => {
            assert.match(ui, /getModelsForProvider/);
        });
        it("no longer uses adapter as primary selector label", () => {
            // Provider section should exist, not "Adapter & Provider"
            assert.doesNotMatch(ui, /Adapter &amp; Provider/);
        });
    });
    // ── Part 6: deterministic judge metadata ────────────────────────────────
    describe("deterministic judge metadata", () => {
        it("catalog entries include judge with deterministic kind", async () => {
            mockFetch();
            const catalog = await getAdapterCatalog();
            for (const entry of catalog) {
                assert.equal(entry.judge.kind, "deterministic");
            }
        });
        it("provider catalog includes judge metadata", async () => {
            mockFetch();
            const result = await getProviderCatalog();
            assert.equal(result.judge.kind, "deterministic");
            assert.ok(result.judge.label.includes("deterministic"));
        });
        it("UI shows judge summary section", () => {
            assert.match(ui, /id="judge-summary"/);
            assert.match(ui, /judgeMeta\.label/);
        });
    });
});
//# sourceMappingURL=adapter-selection.test.js.map