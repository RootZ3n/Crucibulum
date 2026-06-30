/**
 * Luak — adapter contract tests
 *
 * Exercises the real built-in adapters through their public registry and
 * health/chat seams. Network calls are mocked; no provider is contacted.
 */

import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";

import type { AdapterConfig, ChatMessage, CrucibulumAdapter } from "../adapters/base.js";
import { resolveAdapter } from "../adapters/registry.js";

const ADAPTER_IDS = [
  "openai",
  "anthropic",
  "openrouter",
  "ollama",
  "minimax",
  "google",
  "zai",
  "peh",
] as const;

type AdapterId = typeof ADAPTER_IDS[number];

const ENV_KEYS: Partial<Record<AdapterId, string>> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  minimax: "MINIMAX_API_KEY",
  google: "GOOGLE_AI_API_KEY",
  zai: "ZAI_API_KEY",
};

const MODELS: Record<AdapterId, string> = {
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-4-6",
  openrouter: "openai/gpt-5.4-mini",
  ollama: "llama3.2",
  minimax: "MiniMax-Text-01",
  google: "gemini-2.0-flash",
  zai: "glm-4-plus",
  peh: "peh:test-model",
};

const AUTH_EXPECTATIONS: Record<AdapterId, Record<string, string | null>> = {
  openai: { authorization: "Bearer test-openai-key" },
  anthropic: { "x-api-key": "test-anthropic-key", "anthropic-version": "2023-06-01" },
  openrouter: { authorization: "Bearer test-openrouter-key" },
  ollama: { authorization: null, "x-api-key": null, "x-goog-api-key": null },
  minimax: { authorization: "Bearer test-minimax-key", "content-type": "application/json" },
  google: { "x-goog-api-key": "test-google-key", authorization: null },
  zai: { authorization: "Bearer test-zai-key" },
  peh: { authorization: null, "x-api-key": null, "x-goog-api-key": null },
};

const originalEnv = new Map<string, string | undefined>();

function rememberEnv(key: string): void {
  if (!originalEnv.has(key)) originalEnv.set(key, process.env[key]);
}

function seedProviderEnv(): void {
  for (const [adapterId, key] of Object.entries(ENV_KEYS) as Array<[AdapterId, string]>) {
    rememberEnv(key);
    process.env[key] = `test-${adapterId}-key`;
  }
  rememberEnv("PEH_URL");
  process.env["PEH_URL"] = "http://127.0.0.1:18791";
}

afterEach(() => {
  mock.restoreAll();
  for (const [key, value] of originalEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnv.clear();
});

function headerValue(headers: unknown, name: string): string | null {
  const lower = name.toLowerCase();
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([k]) => String(k).toLowerCase() === lower);
    return hit ? String(hit[1]) : null;
  }
  if (typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      if (k.toLowerCase() === lower) return String(v);
    }
  }
  return null;
}

function makeJsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
}

function successfulFetch(url: string): Response {
  if (url.endsWith("/api/tags")) {
    return makeJsonResponse({ models: [{ name: "llama3.2", details: { family: "llama", parameter_size: "3B" } }] });
  }
  if (url.endsWith("/nous/models")) {
    return makeJsonResponse([{ model: "peh:test-model", name: "Peh Test Model", provider: "peh", active: true }]);
  }
  if (url.includes("openrouter.ai") && url.endsWith("/models")) {
    return makeJsonResponse({ data: [{ id: "openai/gpt-5.4-mini", name: "GPT 5.4 Mini" }] });
  }
  if (url.includes("api.openai.com") && url.endsWith("/models")) {
    return makeJsonResponse({ data: [{ id: "gpt-5.4-mini", owned_by: "openai" }] });
  }
  return makeJsonResponse({ ok: true, choices: [{ message: { content: "ok" } }], base_resp: { status_code: 0 } });
}

function initConfig(adapterId: AdapterId): AdapterConfig {
  const config = resolveAdapter(adapterId).makeConfig({ model: MODELS[adapterId], provider: adapterId });
  const envKey = ENV_KEYS[adapterId];
  if (envKey) {
    (config as AdapterConfig & { api_key: string }).api_key = process.env[envKey] ?? "";
  }
  if (adapterId === "peh") {
    (config as AdapterConfig & { peh_url: string; provider: string }).peh_url = "http://127.0.0.1:18791";
    (config as AdapterConfig & { provider: string }).provider = "peh";
  }
  if (adapterId === "ollama") {
    (config as AdapterConfig & { ollama_url: string }).ollama_url = "http://127.0.0.1:11434";
  }
  return config;
}

async function initializedAdapter(adapterId: AdapterId): Promise<CrucibulumAdapter> {
  const adapter = resolveAdapter(adapterId).create();
  await adapter.init(initConfig(adapterId));
  return adapter;
}

describe("built-in adapter registry contracts", () => {
  it("makeConfig returns the expected per-adapter shape", () => {
    seedProviderEnv();
    for (const adapterId of ADAPTER_IDS) {
      const entry = resolveAdapter(adapterId);
      const config = entry.makeConfig({ model: MODELS[adapterId], provider: "provider-hint" }) as Record<string, unknown>;

      assert.equal(config.model, MODELS[adapterId], `${adapterId}: model must round-trip through makeConfig`);
      assert.equal(entry.create().id, adapterId, `${adapterId}: registry must create the real adapter`);
      assert.equal(typeof entry.create().supportsChat, "function", `${adapterId}: adapter must expose supportsChat`);
      if (adapterId === "peh") {
        assert.equal(config.provider, "provider-hint", "peh config must preserve routed provider");
      }
    }
  });

  it("model listing returns non-empty catalog entries without live network", async () => {
    seedProviderEnv();
    mock.method(globalThis, "fetch", async (url: string | URL | Request) => successfulFetch(String(url)));

    for (const adapterId of ADAPTER_IDS) {
      const entry = resolveAdapter(adapterId);
      const models = await entry.listModels();
      assert.ok(models.length > 0, `${adapterId}: expected at least one listed model`);
      for (const model of models) {
        assert.equal(typeof model.id, "string", `${adapterId}: model id`);
        assert.equal(model.provider.length > 0, true, `${adapterId}: provider should be populated`);
        assert.equal(model.available, true, `${adapterId}: mocked listed model should be available`);
      }
    }
  });

  it("health checks send the correct provider auth headers", async () => {
    seedProviderEnv();
    const calls: Array<{ adapterId: AdapterId; url: string; headers: unknown }> = [];
    let active: AdapterId = "openai";
    mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ adapterId: active, url: String(url), headers: init?.headers });
      return successfulFetch(String(url));
    });

    for (const adapterId of ADAPTER_IDS) {
      active = adapterId;
      const adapter = await initializedAdapter(adapterId);
      const health = await adapter.healthCheck();
      assert.equal(health.ok, true, `${adapterId}: mocked health check should pass`);
    }

    for (const adapterId of ADAPTER_IDS) {
      const call = calls.find((c) => c.adapterId === adapterId);
      assert.ok(call, `${adapterId}: expected a fetch call`);
      for (const [header, expected] of Object.entries(AUTH_EXPECTATIONS[adapterId])) {
        assert.equal(headerValue(call.headers, header), expected, `${adapterId}: ${header}`);
      }
    }
  });

  it("provider errors are normalized on failed health checks", async () => {
    seedProviderEnv();

    for (const adapterId of ADAPTER_IDS) {
      mock.restoreAll();
      mock.method(globalThis, "fetch", async () => new Response("upstream unavailable", { status: 503 }));
      const adapter = await initializedAdapter(adapterId);
      const health = await adapter.healthCheck();

      assert.equal(health.ok, false, `${adapterId}: failing upstream must mark health false`);
      assert.equal(health.providerError?.kind, "UNAVAILABLE", `${adapterId}: HTTP 503 should normalize`);
      assert.equal(health.providerError?.adapter, adapterId, `${adapterId}: normalized error adapter`);
      assert.match(health.reason ?? "", /temporarily unavailable|unavailable/i, `${adapterId}: reason should be operator-readable`);
    }
  });

  it("chat failures expose structured provider errors for adapters that throw them", async () => {
    seedProviderEnv();
    const messages: ChatMessage[] = [{ role: "user", content: "hello" }];

    for (const adapterId of ["openrouter", "minimax"] as const) {
      mock.restoreAll();
      mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));
      const adapter = await initializedAdapter(adapterId);
      await assert.rejects(
        () => adapter.chat!(messages, { retries: 0, timeoutMs: 1000 }),
        (err: unknown) => {
          const structured = (err as { structured?: { kind?: string; adapter?: string } }).structured;
          assert.equal(structured?.kind, "RATE_LIMIT", `${adapterId}: chat error kind`);
          assert.equal(structured?.adapter, adapterId, `${adapterId}: chat error adapter`);
          return true;
        },
      );
    }
  });
});
