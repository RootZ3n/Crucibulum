/**
 * Crucible — Provider / Model registry tests
 *
 * Covers the data-plane directly:
 *   - add provider from preset (no code edits)
 *   - add / remove / enable / disable a model
 *   - bulk-add OpenRouter models from pasted list
 *   - persistence round-trip across module resets
 *   - secret masking on client-serialization
 *   - Model Studio preset is usable with the same code path as OpenRouter
 *   - resolveByModelId prefers first-class providers on ties
 *
 * All tests use an isolated CRUCIBULUM_STATE_DIR so the real state/ folder
 * is never touched.
 */
import { describe, it, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-registry-"));
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
// Make sure preset-seed logic doesn't pick up caller's env.
delete process.env["OPENROUTER_API_KEY"];
delete process.env["ANTHROPIC_API_KEY"];
delete process.env["OPENAI_API_KEY"];
delete process.env["MODELSTUDIO_API_KEY"];

const registry = await import("../core/provider-registry.js");

before(() => {
  registry.__resetRegistryForTests();
});

beforeEach(() => {
  // Wipe all state between tests — both in-memory cache AND the on-disk
  // file — so each case gets an empty registry and can't contaminate the
  // next via leftover providers/models.
  registry.__wipeForTests();
});

describe("provider-registry: presets", () => {
  it("ships built-in presets including OpenRouter (first-class) and Model Studio", () => {
    const presets = registry.listPresets();
    const byId = new Map(presets.map((p) => [p.id, p]));
    assert.ok(byId.has("openrouter"), "OpenRouter preset must ship built-in");
    assert.equal(byId.get("openrouter")!.firstClass, true, "OpenRouter must be marked first-class");
    assert.ok(byId.has("modelstudio"), "Model Studio preset must ship built-in");
    assert.ok(byId.has("openai-compatible"), "OpenAI-compatible preset must ship built-in");
    assert.ok(byId.has("ollama"), "Ollama preset must ship built-in");
    assert.ok(byId.has("anthropic"), "Anthropic preset must ship built-in");
    assert.ok(byId.has("openai"), "OpenAI preset must ship built-in");
  });
});

describe("provider-registry: add provider from preset (no code edits)", () => {
  it("persists a provider config when added, and serializeForClient masks any inline key", () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "My OpenRouter", apiKey: "sk-or-v1-ABCDEF1234", apiKeyEnv: null });
    assert.ok(p.id, "provider must get an id");
    assert.equal(p.presetId, "openrouter");
    const client = registry.serializeProviderForClient(p);
    assert.equal(client["apiKeyInline"], "****1234", "inline api key must be masked to last 4");
    assert.equal(client["firstClass"], true, "OpenRouter serializes as first-class");
  });

  it("Model Studio is added through the exact same path as OpenRouter", () => {
    const p = registry.addProvider({ presetId: "modelstudio", label: "Model Studio · qwen", apiKey: "sk-ms-xyz" });
    assert.ok(p.id);
    const list = registry.listProviders().filter((x) => x.presetId === "modelstudio");
    assert.equal(list.length, 1);
  });

  it("rejects unknown preset ids with a clear error", () => {
    assert.throws(() => registry.addProvider({ presetId: "bogus" }), /Unknown preset/);
  });
});

describe("provider-registry: model CRUD", () => {
  it("add / toggle / remove a model entry under a provider", () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "OR", apiKey: "sk-or-v1-test" });
    const m = registry.addModel({ providerConfigId: p.id, modelId: "qwen/qwen3.6-plus" });
    assert.equal(m.enabled, true);
    const disabled = registry.updateModel(m.id, { enabled: false });
    assert.equal(disabled?.enabled, false);
    assert.equal(registry.removeModel(m.id), true);
    assert.equal(registry.removeModel(m.id), false, "removing a non-existent model returns false without throwing");
  });

  it("removing a provider cascades to its models but leaves others alone", () => {
    const p1 = registry.addProvider({ presetId: "openrouter", label: "OR #1", apiKey: "sk1" });
    const p2 = registry.addProvider({ presetId: "openrouter", label: "OR #2", apiKey: "sk2" });
    registry.addModel({ providerConfigId: p1.id, modelId: "a/model-a" });
    const keeper = registry.addModel({ providerConfigId: p2.id, modelId: "b/model-b" });
    registry.removeProvider(p1.id);
    assert.equal(registry.listModels(p1.id).length, 0, "models under removed provider must be gone");
    const still = registry.getModel(keeper.id);
    assert.ok(still, "models under the OTHER provider must survive");
  });
});

describe("provider-registry: bulk add from pasted list (OpenRouter flow)", () => {
  it("parses newline and comma separated ids, strips markdown bullets, and dedupes", () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "OR", apiKey: "sk-or-v1-test" });
    // Pre-register one so the dedupe path is exercised.
    registry.addModel({ providerConfigId: p.id, modelId: "openai/gpt-5-mini" });
    const pasted = [
      "openai/gpt-5-mini",               // duplicate, should skip
      "- anthropic/claude-sonnet-4.5",   // bullet, should trim
      "qwen/qwen3.6-plus  # primary",    // comment, should trim after #
      "  google/gemini-2.5-pro  ",
      "",
      "openai/gpt-5-mini",               // duplicate within paste
    ].join("\n");
    const r = registry.bulkAddModels(p.id, pasted);
    const addedIds = r.added.map((m) => m.modelId);
    assert.deepEqual(
      addedIds.sort(),
      ["anthropic/claude-sonnet-4.5", "google/gemini-2.5-pro", "qwen/qwen3.6-plus"].sort(),
      "every non-duplicate line should be added with trimmed id",
    );
    assert.ok(r.skipped.some((s) => s.modelId === "openai/gpt-5-mini"), "pre-existing entry must be reported as skipped");
  });

  it("requires the provider to exist", () => {
    assert.throws(() => registry.bulkAddModels("not-a-real-id", "qwen/qwen3.6-plus"), /Unknown provider/);
  });
});

describe("provider-registry: persistence round-trip", () => {
  it("writes to disk on mutation and reloads exact state after a fresh module import", async () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "Persisted OR", apiKey: "sk-or-v1-PERSIST" });
    registry.addModel({ providerConfigId: p.id, modelId: "qwen/qwen3.6-plus" });

    const file = join(STATE_DIR, "provider-registry.json");
    assert.ok(existsSync(file), "provider-registry.json must exist after a mutation");
    const onDisk = JSON.parse(readFileSync(file, "utf-8")) as { version: number; providers: unknown[]; models: unknown[] };
    assert.equal(onDisk.version, 1);
    assert.equal(onDisk.providers.length, 1);
    assert.equal(onDisk.models.length, 1);

    // Simulate a process restart: drop the in-memory cache and re-read.
    registry.__resetRegistryForTests();
    const providers = registry.listProviders();
    const models = registry.listModels();
    assert.equal(providers.length, 1, "registry must reload from disk");
    assert.equal(providers[0]!.label, "Persisted OR");
    assert.equal(models.length, 1);
    assert.equal(models[0]!.modelId, "qwen/qwen3.6-plus");
  });
});

describe("provider-registry: routing / resolveByModelId", () => {
  it("qwen3.6-plus added through OpenRouter resolves to the openrouter adapter", () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "OR", apiKey: "sk-or-v1-test" });
    registry.addModel({ providerConfigId: p.id, modelId: "qwen/qwen3.6-plus" });
    const resolved = registry.resolveByModelId("qwen/qwen3.6-plus");
    assert.ok(resolved, "model must resolve");
    assert.equal(resolved!.adapter, "openrouter");
    assert.equal(resolved!.model, "qwen/qwen3.6-plus");
    assert.equal(resolved!.presetId, "openrouter");
  });

  it("prefers first-class (OpenRouter) on ties even when another provider hosts the same id", () => {
    const or = registry.addProvider({ presetId: "openrouter", label: "OR", apiKey: "sk1" });
    const ms = registry.addProvider({ presetId: "modelstudio", label: "Model Studio", apiKey: "sk2" });
    registry.addModel({ providerConfigId: ms.id, modelId: "qwen3.6-plus" });
    registry.addModel({ providerConfigId: or.id, modelId: "qwen3.6-plus" });
    const resolved = registry.resolveByModelId("qwen3.6-plus");
    assert.ok(resolved);
    assert.equal(resolved!.presetId, "openrouter", "first-class preset must win on ties");
  });

  it("returns null when the provider is disabled — nothing runs silently", () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "OR", apiKey: "sk" });
    registry.addModel({ providerConfigId: p.id, modelId: "qwen/qwen3.6-plus" });
    registry.updateProvider(p.id, { enabled: false });
    assert.equal(registry.resolveByModelId("qwen/qwen3.6-plus"), null);
  });

  it("honors the provider hint when resolving a stale client request for a registered model", () => {
    const minimax = registry.addProvider({ presetId: "minimax", label: "MiniMax Direct", apiKey: "sk-mini" });
    const modelstudio = registry.addProvider({ presetId: "modelstudio", label: "Model Studio", apiKey: "sk-ms" });
    registry.addModel({ providerConfigId: modelstudio.id, modelId: "abab6.5s-chat" });
    registry.addModel({ providerConfigId: minimax.id, modelId: "abab6.5s-chat" });

    const resolved = registry.resolveByModelIdWithHint("abab6.5s-chat", "minimax");
    assert.ok(resolved, "registered MiniMax model must resolve");
    assert.equal(resolved!.presetId, "minimax");
    assert.equal(resolved!.adapter, "minimax", "MiniMax must resolve to the direct adapter");
    assert.equal(resolved!.model, "abab6.5s-chat");
  });
});

describe("provider-registry: serialization never leaks inline secrets", () => {
  it("serializeProviderForClient masks inline apiKey as ****<last4>", () => {
    const p = registry.addProvider({ presetId: "openrouter", label: "OR", apiKey: "sk-or-v1-ABCDEFGHIJKLMN" });
    const out = registry.serializeProviderForClient(p);
    assert.equal(out["apiKeyInline"], "****KLMN");
    // The full secret must never be present in the serialized output.
    const serialized = JSON.stringify(out);
    assert.ok(!serialized.includes("sk-or-v1-ABCDEFGHIJKLMN"), "full API key must never leak through serialize-for-client");
  });
});
