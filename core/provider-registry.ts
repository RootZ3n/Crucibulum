/**
 * Crucible — Provider / Model Registry
 *
 * Data-driven control plane for benchmark providers and their models. The
 * adapter layer (adapters/registry.ts) stays as-is — it knows how to TALK to
 * each provider. This module decides which provider *instances* the user
 * actually has configured and which models they've registered under each one.
 *
 * Everything the UI manipulates lives in ONE JSON file:
 *   state/provider-registry.json
 *
 * Shape (v1):
 *   {
 *     "version": 1,
 *     "providers": [ProviderConfig, …],
 *     "models":    [ModelEntry, …]
 *   }
 *
 * - Presets are code-owned (short, stable list of provider templates).
 * - Provider configs and model entries are data-owned (user-managed).
 * - Secrets are either (a) a reference to an environment variable name or
 *   (b) an inline value that is masked in every serialize-for-client path.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";
import { crucibleStateRoot } from "../utils/env.js";
import type { StructuredProviderError } from "../types/provider-error.js";

// ── Presets ────────────────────────────────────────────────────────────────

export type PresetAuthStyle = "bearer" | "header" | "none";

/**
 * A preset is the shape of a well-known provider. Users pick one when they
 * click "Add provider" in the UI; the preset supplies sane defaults and
 * determines which adapter drives the actual HTTP call.
 */
export interface ProviderPreset {
  id: string;                       // preset identity (stable key used in persisted data)
  label: string;                    // human-readable default label
  adapter: string;                  // which adapter in adapters/registry.ts handles this
  kind: "cloud" | "local" | "subprocess";
  defaultBaseUrl: string | null;    // null = adapter-internal default
  envKey: string | null;            // canonical env var for the API key (null = none)
  authStyle: PresetAuthStyle;
  supportsModelListing: boolean;    // does the provider have a /models endpoint
  supportsUsageMetadata: boolean;   // does the provider surface token/cost usage
  firstClass: boolean;              // treated as a headline path in UI ordering
  notes: string | null;
}

/**
 * The preset list is intentionally SHORT. Anything more niche should either
 * (a) use "openai-compatible" with a custom base URL, or (b) be added by a
 * follow-up PR that also wires the corresponding adapter.
 *
 * OpenRouter is first-class because it's the user's primary cost-monitoring
 * hub; it sits at the top of the list and is the only preset that exposes
 * bulk-add in the UI.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "openrouter",
    label: "OpenRouter",
    adapter: "openrouter",
    kind: "cloud",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    envKey: "OPENROUTER_API_KEY",
    authStyle: "bearer",
    supportsModelListing: true,
    supportsUsageMetadata: true,
    firstClass: true,
    notes: "Primary benchmarking hub. Widest model surface. Cost appears on the OpenRouter dashboard and is echoed on /api/generation when available.",
  },
  {
    id: "openai-compatible",
    label: "OpenAI-compatible endpoint",
    adapter: "openrouter",
    kind: "cloud",
    defaultBaseUrl: null,
    envKey: null,
    authStyle: "bearer",
    supportsModelListing: true,
    supportsUsageMetadata: true,
    firstClass: false,
    notes: "Any OpenAI-compatible /chat/completions endpoint (vLLM, LM Studio, Together, Fireworks, etc.). Supply your own base URL and API key.",
  },
  {
    id: "openai",
    label: "OpenAI",
    adapter: "openai",
    kind: "cloud",
    defaultBaseUrl: "https://api.openai.com/v1",
    envKey: "OPENAI_API_KEY",
    authStyle: "bearer",
    supportsModelListing: true,
    supportsUsageMetadata: true,
    firstClass: false,
    notes: null,
  },
  {
    id: "anthropic",
    label: "Anthropic",
    adapter: "anthropic",
    kind: "cloud",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    envKey: "ANTHROPIC_API_KEY",
    authStyle: "header",
    supportsModelListing: false,
    supportsUsageMetadata: true,
    firstClass: false,
    notes: null,
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    adapter: "ollama",
    kind: "local",
    defaultBaseUrl: "http://localhost:11434",
    envKey: null,
    authStyle: "none",
    supportsModelListing: true,
    supportsUsageMetadata: false,
    firstClass: false,
    notes: "Free, runs on your machine. No credentials.",
  },
  {
    id: "modelstudio",
    label: "Model Studio (Alibaba DashScope)",
    adapter: "squidley",
    kind: "cloud",
    defaultBaseUrl: "https://dashscope-intl.aliyuncs.com/api/v1",
    envKey: "MODELSTUDIO_API_KEY",
    authStyle: "bearer",
    supportsModelListing: false,
    supportsUsageMetadata: true,
    firstClass: false,
    notes: "Alibaba's Model Studio (qwen family). Configure base URL and API key, then add model IDs by hand.",
  },
  {
    id: "minimax",
    label: "MiniMax Direct (International)",
    adapter: "minimax",
    kind: "cloud",
    defaultBaseUrl: "https://api.minimax.io/v1",
    envKey: "MINIMAX_API_KEY",
    authStyle: "bearer",
    supportsModelListing: false,
    supportsUsageMetadata: true,
    firstClass: false,
    notes: "MiniMax international API. Default host is api.minimax.io. For Chinese domestic accounts change the base URL to https://api.minimax.chat/v1.",
  },
  {
    id: "zai",
    label: "Z.AI Direct (GLM)",
    adapter: "zai",
    kind: "cloud",
    defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
    envKey: "ZAI_API_KEY",
    authStyle: "bearer",
    supportsModelListing: true,
    supportsUsageMetadata: true,
    firstClass: false,
    notes: "Zhipu AI (BigModel) direct — GLM-4, GLM-5.1, GLM-Z1 families.",
  },
];

export function listPresets(): ProviderPreset[] {
  return PROVIDER_PRESETS.slice();
}

export function getPreset(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((p) => p.id === id) ?? null;
}

// ── Persisted shapes ───────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;                       // uuid-like, generated on add
  presetId: string;                 // fkey → ProviderPreset.id
  label: string;                    // user-visible name (defaults to preset label)
  baseUrl: string | null;           // null = use preset/adapter default
  apiKeyEnv: string | null;         // env var name
  apiKey: string | null;            // inline secret (mutually exclusive with apiKeyEnv in UI)
  enabled: boolean;
  lastTestedAt: number | null;
  lastTestedOk: boolean | null;
  lastTestedReason: string | null;
  lastTestedError?: StructuredProviderError | null;
  createdAt: number;
}

export interface ModelEntry {
  id: string;                       // uuid-like
  providerConfigId: string;         // fkey → ProviderConfig.id
  modelId: string;                  // the actual id sent to the provider
  displayName: string;
  enabled: boolean;
  tags: string[];                   // "reasoning" | "cheap" | "fast" | "coding" | "vision" | etc.
  notes: string | null;
  createdAt: number;
}

interface StoreShape {
  version: number;
  providers: ProviderConfig[];
  models: ModelEntry[];
}

const STORE_VERSION = 1;
const LEGACY_MINIMAX_BASE_URL = "https://api.minimaxi.chat/v1";
const CURRENT_MINIMAX_BASE_URL = "https://api.minimax.io/v1";

// ── State directory / file I/O ─────────────────────────────────────────────

function statePath(): string {
  return crucibleStateRoot();
}

function storeFile(): string {
  return join(statePath(), "provider-registry.json");
}

let cache: StoreShape | null = null;
let cacheInitialized = false;

function emptyStore(): StoreShape {
  return { version: STORE_VERSION, providers: [], models: [] };
}

/**
 * One-time migration: if no file exists, seed a provider config for every
 * preset whose canonical env var is already set. This preserves the current
 * out-of-the-box behavior — someone with OPENROUTER_API_KEY in their .env
 * still gets an OpenRouter provider auto-registered on first boot.
 */
function seedFromEnv(): StoreShape {
  const now = Date.now();
  const providers: ProviderConfig[] = [];
  for (const preset of PROVIDER_PRESETS) {
    if (!preset.envKey) continue;
    if (!process.env[preset.envKey]) continue;
    providers.push({
      id: `${preset.id}-seed-${now}`,
      presetId: preset.id,
      label: preset.label,
      baseUrl: null,
      apiKeyEnv: preset.envKey,
      apiKey: null,
      enabled: true,
      lastTestedAt: null,
      lastTestedOk: null,
      lastTestedReason: null,
      lastTestedError: null,
      createdAt: now,
    });
  }
  // Ollama is special: no env key required, seed unconditionally if no
  // other local provider already serves that role.
  if (!providers.some((p) => p.presetId === "ollama")) {
    providers.push({
      id: `ollama-seed-${now}`,
      presetId: "ollama",
      label: "Ollama (local)",
      baseUrl: process.env["OLLAMA_URL"] ?? null,
      apiKeyEnv: null,
      apiKey: null,
      enabled: true,
      lastTestedAt: null,
      lastTestedOk: null,
      lastTestedReason: null,
      lastTestedError: null,
      createdAt: now,
    });
  }
  return { version: STORE_VERSION, providers, models: [] };
}

/**
 * Very forgiving: anything we can't parse resets to an empty store rather than
 * crashing the server. We log loudly and the user can re-add providers from
 * the UI — we never want a corrupted registry file to brick the UI.
 */
function migrate(raw: unknown): StoreShape {
  if (!raw || typeof raw !== "object") return emptyStore();
  const r = raw as Record<string, unknown>;
  const version = typeof r["version"] === "number" ? r["version"] as number : 0;
  const providers = Array.isArray(r["providers"]) ? (r["providers"] as ProviderConfig[]) : [];
  const models = Array.isArray(r["models"]) ? (r["models"] as ModelEntry[]) : [];
  const normalizedProviders = providers.map((provider) => {
    if (provider.presetId === "minimax" && provider.baseUrl === LEGACY_MINIMAX_BASE_URL) {
      return { ...provider, baseUrl: CURRENT_MINIMAX_BASE_URL };
    }
    return provider;
  });
  if (version === STORE_VERSION) return { version, providers: normalizedProviders, models };
  // Future migrations branch here.
  log("warn", "provider-registry", `Unknown registry version ${version}; treating as v${STORE_VERSION}`);
  return { version: STORE_VERSION, providers: normalizedProviders, models };
}

function loadFromDisk(): StoreShape {
  const path = storeFile();
  if (!existsSync(path)) {
    const seeded = seedFromEnv();
    if (seeded.providers.length > 0) {
      log("info", "provider-registry", `Seeding registry from env — ${seeded.providers.length} provider(s)`);
      saveToDisk(seeded);
    }
    return seeded;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    return migrate(JSON.parse(raw));
  } catch (err) {
    log("error", "provider-registry", `Could not parse ${path}: ${String(err)} — starting with an empty registry`);
    return emptyStore();
  }
}

function saveToDisk(store: StoreShape): void {
  try {
    mkdirSync(statePath(), { recursive: true });
    const path = storeFile();
    const tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(store, null, 2));
    renameSync(tmp, path);
  } catch (err) {
    log("error", "provider-registry", `Failed to persist registry: ${String(err)}`);
  }
}

function ensureLoaded(): StoreShape {
  if (!cacheInitialized) {
    cache = loadFromDisk();
    cacheInitialized = true;
  }
  return cache!;
}

export function __resetRegistryForTests(): void {
  cache = null;
  cacheInitialized = false;
}

/** Test-only: drop all state and overwrite the on-disk file with an empty store. */
export function __wipeForTests(): void {
  cache = emptyStore();
  cacheInitialized = true;
  saveToDisk(cache);
}

// ── Read helpers ───────────────────────────────────────────────────────────

export function listProviders(): ProviderConfig[] {
  return ensureLoaded().providers.slice();
}

export function getProvider(id: string): ProviderConfig | null {
  return ensureLoaded().providers.find((p) => p.id === id) ?? null;
}

export function listModels(providerConfigId?: string): ModelEntry[] {
  const models = ensureLoaded().models;
  return providerConfigId ? models.filter((m) => m.providerConfigId === providerConfigId) : models.slice();
}

export function getModel(id: string): ModelEntry | null {
  return ensureLoaded().models.find((m) => m.id === id) ?? null;
}

// ── Secret masking ─────────────────────────────────────────────────────────

/**
 * Serialize a provider config for the client. Inline API keys are always
 * masked to "****<last4>" so GET endpoints never leak a live credential.
 * Env-based keys are reported as `{apiKeyEnv, apiKeyEnvSet: boolean}` so the
 * UI can show "OPENROUTER_API_KEY is configured" without disclosing the value.
 */
export function serializeProviderForClient(p: ProviderConfig): Record<string, unknown> {
  const preset = getPreset(p.presetId);
  return {
    id: p.id,
    presetId: p.presetId,
    presetLabel: preset?.label ?? p.presetId,
    adapter: preset?.adapter ?? null,
    kind: preset?.kind ?? "cloud",
    label: p.label,
    baseUrl: p.baseUrl ?? preset?.defaultBaseUrl ?? null,
    apiKeyEnv: p.apiKeyEnv,
    apiKeyEnvSet: p.apiKeyEnv ? !!process.env[p.apiKeyEnv] : false,
    apiKeyInline: p.apiKey ? maskSecret(p.apiKey) : null,
    enabled: p.enabled,
    lastTestedAt: p.lastTestedAt,
    lastTestedOk: p.lastTestedOk,
    lastTestedReason: p.lastTestedReason,
    lastTestedError: p.lastTestedError ?? null,
    createdAt: p.createdAt,
    supportsModelListing: preset?.supportsModelListing ?? false,
    supportsUsageMetadata: preset?.supportsUsageMetadata ?? false,
    firstClass: preset?.firstClass ?? false,
  };
}

function maskSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 4) return "****";
  return `****${secret.slice(-4)}`;
}

// ── Write helpers ──────────────────────────────────────────────────────────

function newId(kind: string): string {
  // Short, URL-safe id; not a cryptographic token, just an opaque key.
  return `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function mutate(fn: (store: StoreShape) => void): StoreShape {
  const store = ensureLoaded();
  fn(store);
  saveToDisk(store);
  return store;
}

export interface AddProviderInput {
  presetId: string;
  label?: string | undefined;
  baseUrl?: string | null | undefined;
  apiKeyEnv?: string | null | undefined;
  apiKey?: string | null | undefined;
  enabled?: boolean | undefined;
}

export function addProvider(input: AddProviderInput): ProviderConfig {
  const preset = getPreset(input.presetId);
  if (!preset) throw new Error(`Unknown preset: ${input.presetId}`);
  const now = Date.now();
  const cfg: ProviderConfig = {
    id: newId("prov"),
    presetId: preset.id,
    label: input.label?.trim() || preset.label,
    baseUrl: (input.baseUrl ?? null) || null,
    apiKeyEnv: (input.apiKeyEnv ?? preset.envKey) || null,
    apiKey: (input.apiKey ?? null) || null,
    enabled: input.enabled !== false,
    lastTestedAt: null,
    lastTestedOk: null,
    lastTestedReason: null,
    lastTestedError: null,
    createdAt: now,
  };
  mutate((s) => { s.providers.push(cfg); });
  return cfg;
}

export interface UpdateProviderInput {
  label?: string | undefined;
  baseUrl?: string | null | undefined;
  apiKeyEnv?: string | null | undefined;
  apiKey?: string | null | undefined;
  enabled?: boolean | undefined;
}

export function updateProvider(id: string, patch: UpdateProviderInput): ProviderConfig | null {
  let updated: ProviderConfig | null = null;
  mutate((s) => {
    const p = s.providers.find((x) => x.id === id);
    if (!p) return;
    if (patch.label !== undefined) p.label = patch.label.trim() || p.label;
    if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl || null;
    if (patch.apiKeyEnv !== undefined) p.apiKeyEnv = patch.apiKeyEnv || null;
    if (patch.apiKey !== undefined) p.apiKey = patch.apiKey || null;
    if (patch.enabled !== undefined) p.enabled = patch.enabled;
    updated = p;
  });
  return updated;
}

export function removeProvider(id: string): boolean {
  let removed = false;
  mutate((s) => {
    const before = s.providers.length;
    s.providers = s.providers.filter((x) => x.id !== id);
    // Cascade: drop models bound to the removed provider — bundles on disk
    // keep the `adapter/provider/model` strings so archive history still
    // reads fine, but the live control plane should no longer list orphans.
    s.models = s.models.filter((m) => m.providerConfigId !== id);
    removed = s.providers.length < before;
  });
  return removed;
}

export function markTested(id: string, ok: boolean, reason: string | null, providerError?: StructuredProviderError | null): ProviderConfig | null {
  let updated: ProviderConfig | null = null;
  mutate((s) => {
    const p = s.providers.find((x) => x.id === id);
    if (!p) return;
    p.lastTestedAt = Date.now();
    p.lastTestedOk = ok;
    p.lastTestedReason = reason;
    p.lastTestedError = providerError ?? null;
    updated = p;
  });
  return updated;
}

export interface AddModelInput {
  providerConfigId: string;
  modelId: string;
  displayName?: string | undefined;
  tags?: string[] | undefined;
  notes?: string | undefined;
  enabled?: boolean | undefined;
}

export function addModel(input: AddModelInput): ModelEntry {
  if (!input.modelId.trim()) throw new Error("Model id is required");
  const provider = getProvider(input.providerConfigId);
  if (!provider) throw new Error(`Unknown provider: ${input.providerConfigId}`);
  const now = Date.now();
  const entry: ModelEntry = {
    id: newId("mdl"),
    providerConfigId: provider.id,
    modelId: input.modelId.trim(),
    displayName: (input.displayName ?? input.modelId).trim(),
    enabled: input.enabled !== false,
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 16).map((t) => String(t).trim()).filter(Boolean) : [],
    notes: input.notes?.trim() || null,
    createdAt: now,
  };
  mutate((s) => { s.models.push(entry); });
  return entry;
}

/**
 * Parse a newline/comma-separated paste into individual model ids and add each
 * one (deduped against the provider's existing entries). Blank lines and
 * leading bullet characters (`- ` / `* `) are stripped so users can paste
 * Markdown lists verbatim.
 */
export function bulkAddModels(providerConfigId: string, pasted: string): {
  added: ModelEntry[];
  skipped: Array<{ modelId: string; reason: string }>;
} {
  const provider = getProvider(providerConfigId);
  if (!provider) throw new Error(`Unknown provider: ${providerConfigId}`);
  const lines = pasted
    .split(/[\n,]+/)
    .map((l) => l.trim().replace(/^[-*]\s+/, "").replace(/\s*#.*$/, "").trim())
    .filter(Boolean);
  const existing = new Set(listModels(providerConfigId).map((m) => m.modelId.toLowerCase()));
  const added: ModelEntry[] = [];
  const skipped: Array<{ modelId: string; reason: string }> = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (existing.has(key)) {
      skipped.push({ modelId: line, reason: "already registered" });
      continue;
    }
    existing.add(key);
    added.push(addModel({ providerConfigId, modelId: line }));
  }
  return { added, skipped };
}

export interface UpdateModelInput {
  displayName?: string | undefined;
  enabled?: boolean | undefined;
  tags?: string[] | undefined;
  notes?: string | null | undefined;
}

export function updateModel(id: string, patch: UpdateModelInput): ModelEntry | null {
  let updated: ModelEntry | null = null;
  mutate((s) => {
    const m = s.models.find((x) => x.id === id);
    if (!m) return;
    if (patch.displayName !== undefined) m.displayName = patch.displayName.trim() || m.displayName;
    if (patch.enabled !== undefined) m.enabled = patch.enabled;
    if (patch.tags !== undefined) m.tags = patch.tags.slice(0, 16).map((t) => String(t).trim()).filter(Boolean);
    if (patch.notes !== undefined) m.notes = patch.notes?.trim() || null;
    updated = m;
  });
  return updated;
}

export function removeModel(id: string): boolean {
  let removed = false;
  mutate((s) => {
    const before = s.models.length;
    s.models = s.models.filter((x) => x.id !== id);
    removed = s.models.length < before;
  });
  return removed;
}

// ── Resolution for benchmark dispatch ──────────────────────────────────────

/**
 * Map a (providerConfigId, modelEntryId-or-modelId) to the adapter-level
 * invocation details the run pipeline needs: which adapter class to
 * instantiate, what `api_key`/`base_url` to pass. Returns null if the
 * provider config is disabled or the model isn't registered/enabled.
 *
 * This is the single handoff point between the registry (data plane) and
 * the adapter layer (request plane).
 */
export interface ResolvedRunTarget {
  providerConfigId: string;
  providerLabel: string;
  adapter: string;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
  apiKeyEnv: string | null;
  presetId: string;
}

export function resolveRunTarget(providerConfigId: string, modelKey: string): ResolvedRunTarget | null {
  const provider = getProvider(providerConfigId);
  if (!provider || !provider.enabled) return null;
  const preset = getPreset(provider.presetId);
  if (!preset) return null;
  const models = listModels(providerConfigId);
  // modelKey may be either the ModelEntry id (opaque) or the raw modelId (as
  // stored). Supporting both simplifies UI callers that already have a
  // model id string from the existing lane UI.
  const entry = models.find((m) => m.id === modelKey) ?? models.find((m) => m.modelId === modelKey) ?? null;
  if (!entry || !entry.enabled) return null;
  return {
    providerConfigId: provider.id,
    providerLabel: provider.label,
    adapter: preset.adapter,
    model: entry.modelId,
    baseUrl: provider.baseUrl ?? preset.defaultBaseUrl,
    apiKey: provider.apiKey,
    apiKeyEnv: provider.apiKeyEnv,
    presetId: preset.id,
  };
}

/**
 * Flat catalog view for UI consumption: every enabled model across every
 * enabled provider, annotated with the provider label + preset kind. Used
 * to populate the benchmark lane's model picker.
 */
export interface FlatCatalogEntry {
  providerConfigId: string;
  providerLabel: string;
  presetId: string;
  presetLabel: string;
  adapter: string;
  kind: "cloud" | "local" | "subprocess";
  modelEntryId: string;
  modelId: string;
  displayName: string;
  tags: string[];
  enabled: boolean;
  providerEnabled: boolean;
}

export function flatCatalog(): FlatCatalogEntry[] {
  const out: FlatCatalogEntry[] = [];
  for (const provider of listProviders()) {
    const preset = getPreset(provider.presetId);
    if (!preset) continue;
    for (const model of listModels(provider.id)) {
      out.push({
        providerConfigId: provider.id,
        providerLabel: provider.label,
        presetId: preset.id,
        presetLabel: preset.label,
        adapter: preset.adapter,
        kind: preset.kind,
        modelEntryId: model.id,
        modelId: model.modelId,
        displayName: model.displayName,
        tags: model.tags,
        enabled: model.enabled,
        providerEnabled: provider.enabled,
      });
    }
  }
  return out;
}

/**
 * Resolve a raw model id (as the run dispatch layer currently has) to the
 * best-matching registered (provider, model) pair. Honors:
 *
 *   1. exact modelId match on an enabled provider/model
 *   2. if ambiguous, prefers first-class (OpenRouter) providers
 *   3. finally falls back to ANY preset whose adapter advertises the id
 *
 * This lets the existing runBatch/runSingle pipeline keep routing by raw
 * modelId while still honoring the registry (a user who adds qwen3.6-plus to
 * their OpenRouter provider gets dispatched through OpenRouter automatically).
 */
export function resolveByModelId(modelId: string): ResolvedRunTarget | null {
  const catalog = flatCatalog().filter((c) => c.enabled && c.providerEnabled && c.modelId === modelId);
  if (catalog.length === 0) return null;
  // Prefer first-class presets (OpenRouter) when the same model id exists on
  // multiple providers — the product decision is that OpenRouter is the main
  // benchmarking hub.
  catalog.sort((a, b) => {
    const af = getPreset(a.presetId)?.firstClass ? 0 : 1;
    const bf = getPreset(b.presetId)?.firstClass ? 0 : 1;
    return af - bf;
  });
  const top = catalog[0]!;
  return resolveRunTarget(top.providerConfigId, top.modelEntryId);
}

/**
 * Resolve a raw model id while honoring the caller's provider hint when one is
 * present. This closes the stale-client gap where the browser can post an old
 * adapter id (for example `squidley`) for a model that is now registered under
 * a direct preset (`minimax`). The provider hint is treated as the operator's
 * intended lane; within that lane we still resolve to the concrete configured
 * provider/model entry.
 */
export function resolveByModelIdWithHint(modelId: string, preferredPresetId?: string | null): ResolvedRunTarget | null {
  const catalog = flatCatalog().filter((c) => c.enabled && c.providerEnabled && c.modelId === modelId);
  if (catalog.length === 0) return null;
  const preferred = (preferredPresetId ?? "").trim();
  catalog.sort((a, b) => {
    const aPreferred = preferred && a.presetId === preferred ? 0 : 1;
    const bPreferred = preferred && b.presetId === preferred ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    const af = getPreset(a.presetId)?.firstClass ? 0 : 1;
    const bf = getPreset(b.presetId)?.firstClass ? 0 : 1;
    return af - bf;
  });
  const top = catalog[0]!;
  return resolveRunTarget(top.providerConfigId, top.modelEntryId);
}
