import type { AdapterConfig, CrucibulumAdapter } from "./base.js";
import { OllamaAdapter } from "./ollama.js";
import { OpenRouterAdapter } from "./openrouter.js";
import { OpenClawAdapter } from "./openclaw.js";
import { ClaudeCodeAdapter } from "./claudecode.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";

export type AdapterRuntimeKind = "local" | "cloud" | "subprocess";

// ── Provider Catalog Types ──────────────────────────────────────────────────

export interface ProviderCatalogEntry {
  id: string;
  label: string;
  kind: AdapterRuntimeKind;
  available: boolean;
  reason: string | null;
  adapter: string;
  manualModelAllowed: boolean;
  models: Array<{ id: string; label: string; available: boolean }>;
  envKey: string | null;
}

export interface NotImplementedProvider {
  id: string;
  label: string;
  kind: AdapterRuntimeKind;
  implemented: false;
  blocker: string;
  envKey: string;
}

export interface AdapterProviderOption {
  id: string;
  name: string;
  kind: AdapterRuntimeKind;
  configurable: boolean;
}

export interface AdapterModelOption {
  id: string;
  name: string;
  provider: string;
  kind: AdapterRuntimeKind;
  available: boolean;
  reason: string | null;
  metadata?: Record<string, unknown> | undefined;
}

export interface AdapterCatalogEntry {
  id: string;
  name: string;
  kind: AdapterRuntimeKind;
  provider_mode: "fixed" | "configurable";
  fixed_provider: string | null;
  available: boolean;
  reason: string | null;
  supports_tool_calls: boolean;
  supports_custom_model: boolean;
  provider_options: AdapterProviderOption[];
  models: AdapterModelOption[];
  judge: typeof DETERMINISTIC_JUDGE_METADATA;
}

export interface RegistryDefinition {
  id: string;
  name: string;
  kind: AdapterRuntimeKind;
  provider_mode: "fixed" | "configurable";
  fixed_provider: string | null;
  supports_custom_model: boolean;
  create(): CrucibulumAdapter;
  provider_options: AdapterProviderOption[];
  listModels(): Promise<AdapterModelOption[]>;
  makeConfig(input: { model: string; provider?: string | null }): AdapterConfig;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENAI_BASE = "https://api.openai.com/v1";
const DEFAULT_OLLAMA_URL = process.env["OLLAMA_URL"] ?? "http://localhost:11434";

const REGISTRY: RegistryDefinition[] = [
  {
    id: "ollama",
    name: "Ollama",
    kind: "local",
    provider_mode: "fixed",
    fixed_provider: "ollama",
    supports_custom_model: true,
    create: () => new OllamaAdapter(),
    provider_options: [{ id: "ollama", name: "Ollama", kind: "local", configurable: false }],
    async listModels() {
      try {
        const res = await fetch(`${DEFAULT_OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          return [];
        }
        const data = await res.json() as {
          models?: Array<{ name: string; details?: { family?: string; parameter_size?: string } }>;
        };
        return (data.models ?? []).map((m) => ({
          id: m.name,
          name: m.name,
          provider: "ollama",
          kind: "local" as const,
          available: true,
          reason: null,
          metadata: {
            family: m.details?.family ?? null,
            size: m.details?.parameter_size ?? null,
          },
        }));
      } catch {
        return [];
      }
    },
    makeConfig(input) {
      return { model: input.model } as AdapterConfig;
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    kind: "cloud",
    provider_mode: "fixed",
    fixed_provider: "openai",
    supports_custom_model: true,
    create: () => new OpenRouterAdapter({
      id: "openai",
      name: "OpenAI",
      baseUrl: OPENAI_BASE,
      apiKeyEnv: "OPENAI_API_KEY",
      defaultModel: "gpt-4.1-mini",
    }),
    provider_options: [{ id: "openai", name: "OpenAI", kind: "cloud", configurable: false }],
    async listModels() {
      const apiKey = process.env["OPENAI_API_KEY"] ?? "";
      if (!apiKey) return [];
      try {
        const res = await fetch(`${OPENAI_BASE}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = await res.json() as { data?: Array<{ id: string; owned_by?: string }> };
        return (data.data ?? [])
          .filter((m) => m.id.startsWith("gpt-") || m.id.startsWith("o") || m.id.startsWith("chatgpt-"))
          .map((m) => ({
            id: m.id,
            name: m.id,
            provider: "openai",
            kind: "cloud" as const,
            available: true,
            reason: null,
            metadata: { owned_by: m.owned_by ?? null },
          }));
      } catch {
        return [];
      }
    },
    makeConfig(input) {
      return { model: input.model, base_url: OPENAI_BASE } as AdapterConfig;
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    kind: "cloud",
    provider_mode: "fixed",
    fixed_provider: "openrouter",
    supports_custom_model: true,
    create: () => new OpenRouterAdapter(),
    provider_options: [{ id: "openrouter", name: "OpenRouter", kind: "cloud", configurable: false }],
    async listModels() {
      const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
      if (!apiKey) {
        return [];
      }
      try {
        const res = await fetch(`${OPENROUTER_BASE}/models`, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          return [];
        }
        const data = await res.json() as { data?: Array<{ id: string; name?: string; context_length?: number; pricing?: Record<string, unknown> }> };
        return (data.data ?? []).map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          provider: "openrouter",
          kind: "cloud" as const,
          available: true,
          reason: null,
          metadata: {
            context_length: m.context_length ?? null,
            pricing: m.pricing ?? null,
          },
        }));
      } catch {
        return [];
      }
    },
    makeConfig(input) {
      return { model: input.model } as AdapterConfig;
    },
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    kind: "subprocess",
    provider_mode: "configurable",
    fixed_provider: null,
    supports_custom_model: true,
    create: () => new OpenClawAdapter(),
    provider_options: [{ id: "openclaw", name: "OpenClaw runtime", kind: "subprocess", configurable: true }],
    async listModels() {
      const model = process.env["OPENCLAW_MODEL"] ?? "";
      return model ? [{
        id: model,
        name: model,
        provider: process.env["OPENCLAW_PROVIDER"] ?? "openclaw",
        kind: "subprocess",
        available: true,
        reason: null,
      }] : [];
    },
    makeConfig(input) {
      return {
        model: input.model || undefined,
        provider: input.provider || process.env["OPENCLAW_PROVIDER"] || undefined,
        binary_path: process.env["OPENCLAW_BINARY"] || undefined,
        config_path: process.env["OPENCLAW_CONFIG"] || undefined,
      } as AdapterConfig;
    },
  },
  {
    id: "claudecode",
    name: "Claude Code",
    kind: "subprocess",
    provider_mode: "fixed",
    fixed_provider: "anthropic",
    supports_custom_model: true,
    create: () => new ClaudeCodeAdapter(),
    provider_options: [{ id: "anthropic", name: "Anthropic", kind: "cloud", configurable: false }],
    async listModels() {
      const model = process.env["CLAUDE_CODE_MODEL"] ?? "";
      return model ? [{
        id: model,
        name: model,
        provider: "anthropic",
        kind: "cloud",
        available: true,
        reason: null,
      }] : [];
    },
    makeConfig(input) {
      return {
        model: input.model || process.env["CLAUDE_CODE_MODEL"] || undefined,
        binary_path: process.env["CLAUDE_CODE_BINARY"] || undefined,
      } as AdapterConfig;
    },
  },
];

export function listRegisteredAdapters(): RegistryDefinition[] {
  return REGISTRY.slice();
}

export function resolveAdapter(adapterId: string): RegistryDefinition {
  const match = REGISTRY.find((entry) => entry.id === adapterId);
  if (!match) {
    throw new Error(`Unknown adapter: ${adapterId}`);
  }
  return match;
}

export async function getAdapterCatalog(): Promise<AdapterCatalogEntry[]> {
  const entries: AdapterCatalogEntry[] = [];
  for (const entry of REGISTRY) {
    try {
      const adapter = entry.create();
      const config = entry.makeConfig({ model: "", provider: entry.fixed_provider });
      await adapter.init(config);
      let health: { ok: boolean; reason?: string | undefined };
      try {
        health = await adapter.healthCheck();
      } catch (err) {
        health = { ok: false, reason: `healthCheck error: ${String(err)}` };
      }
      let models: AdapterModelOption[];
      try {
        models = await entry.listModels();
      } catch {
        models = [];
      }
      entries.push({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        provider_mode: entry.provider_mode,
        fixed_provider: entry.fixed_provider,
        available: health.ok,
        reason: health.reason ?? null,
        supports_tool_calls: adapter.supportsToolCalls(),
        supports_custom_model: entry.supports_custom_model,
        provider_options: entry.provider_options,
        models,
        judge: DETERMINISTIC_JUDGE_METADATA,
      });
      try { await adapter.teardown(); } catch { /* best effort */ }
    } catch (err) {
      // Adapter failed to initialize — still include it as unavailable
      entries.push({
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        provider_mode: entry.provider_mode,
        fixed_provider: entry.fixed_provider,
        available: false,
        reason: `init error: ${String(err)}`,
        supports_tool_calls: false,
        supports_custom_model: entry.supports_custom_model,
        provider_options: entry.provider_options,
        models: [],
        judge: DETERMINISTIC_JUDGE_METADATA,
      });
    }
  }
  return entries;
}

export async function listFlattenedModels(): Promise<Array<AdapterModelOption & { adapter: string; adapter_name: string }>> {
  const catalog = await getAdapterCatalog();
  return catalog.flatMap((entry) => entry.models.map((model) => ({
    ...model,
    adapter: entry.id,
    adapter_name: entry.name,
  })));
}

export async function instantiateAdapterForRun(input: {
  adapter: string;
  model: string;
  provider?: string | null;
}): Promise<{ adapter: CrucibulumAdapter; config: AdapterConfig; registry: RegistryDefinition }> {
  const registry = resolveAdapter(input.adapter);
  const adapter = registry.create();
  const config = registry.makeConfig({
    model: input.model,
    provider: input.provider ?? registry.fixed_provider,
  });
  await adapter.init(config);
  return { adapter, config, registry };
}

// ── Provider Catalog ──────────────────────────────────────────────────────

const ENV_KEYS: Record<string, string> = {
  ollama: "OLLAMA_URL",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  openclaw: "OPENCLAW_BINARY",
  claudecode: "CLAUDE_CODE_BINARY",
};

const NOT_IMPLEMENTED_PROVIDERS: NotImplementedProvider[] = [
  {
    id: "anthropic",
    label: "Anthropic (direct)",
    kind: "cloud",
    implemented: false,
    blocker: "Anthropic Messages API adapter not yet implemented. Use OpenRouter or Claude Code for Anthropic models.",
    envKey: "ANTHROPIC_API_KEY",
  },
  {
    id: "google",
    label: "Google Gemini (direct)",
    kind: "cloud",
    implemented: false,
    blocker: "Gemini API adapter not yet implemented. Use OpenRouter for Google models.",
    envKey: "GOOGLE_API_KEY",
  },
  {
    id: "zai",
    label: "ZAI",
    kind: "cloud",
    implemented: false,
    blocker: "ZAI adapter not yet implemented.",
    envKey: "ZAI_API_KEY",
  },
];

export function getNotImplementedProviders(): NotImplementedProvider[] {
  return NOT_IMPLEMENTED_PROVIDERS.slice();
}

export async function getProviderCatalog(): Promise<{
  providers: ProviderCatalogEntry[];
  notImplemented: NotImplementedProvider[];
  judge: typeof DETERMINISTIC_JUDGE_METADATA;
}> {
  const adapterCatalog = await getAdapterCatalog();
  const providers: ProviderCatalogEntry[] = adapterCatalog.map((entry) => ({
    id: entry.id,
    label: entry.name,
    kind: entry.kind,
    available: entry.available,
    reason: entry.reason,
    adapter: entry.id,
    manualModelAllowed: entry.supports_custom_model,
    models: entry.models.map((m) => ({
      id: m.id,
      label: m.name ?? m.id,
      available: m.available,
    })),
    envKey: ENV_KEYS[entry.id] ?? null,
  }));

  return {
    providers,
    notImplemented: NOT_IMPLEMENTED_PROVIDERS,
    judge: DETERMINISTIC_JUDGE_METADATA,
  };
}
