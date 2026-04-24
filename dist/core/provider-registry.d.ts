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
import type { StructuredProviderError } from "../types/provider-error.js";
export type PresetAuthStyle = "bearer" | "header" | "none";
/**
 * A preset is the shape of a well-known provider. Users pick one when they
 * click "Add provider" in the UI; the preset supplies sane defaults and
 * determines which adapter drives the actual HTTP call.
 */
export interface ProviderPreset {
    id: string;
    label: string;
    adapter: string;
    kind: "cloud" | "local" | "subprocess";
    defaultBaseUrl: string | null;
    envKey: string | null;
    authStyle: PresetAuthStyle;
    supportsModelListing: boolean;
    supportsUsageMetadata: boolean;
    firstClass: boolean;
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
export declare const PROVIDER_PRESETS: ProviderPreset[];
export declare function listPresets(): ProviderPreset[];
export declare function getPreset(id: string): ProviderPreset | null;
export interface ProviderConfig {
    id: string;
    presetId: string;
    label: string;
    baseUrl: string | null;
    apiKeyEnv: string | null;
    apiKey: string | null;
    enabled: boolean;
    lastTestedAt: number | null;
    lastTestedOk: boolean | null;
    lastTestedReason: string | null;
    lastTestedError?: StructuredProviderError | null;
    createdAt: number;
}
export interface ModelEntry {
    id: string;
    providerConfigId: string;
    modelId: string;
    displayName: string;
    enabled: boolean;
    tags: string[];
    notes: string | null;
    createdAt: number;
}
export declare function __resetRegistryForTests(): void;
/** Test-only: drop all state and overwrite the on-disk file with an empty store. */
export declare function __wipeForTests(): void;
export declare function listProviders(): ProviderConfig[];
export declare function getProvider(id: string): ProviderConfig | null;
export declare function listModels(providerConfigId?: string): ModelEntry[];
export declare function getModel(id: string): ModelEntry | null;
/**
 * Serialize a provider config for the client. Inline API keys are always
 * masked to "****<last4>" so GET endpoints never leak a live credential.
 * Env-based keys are reported as `{apiKeyEnv, apiKeyEnvSet: boolean}` so the
 * UI can show "OPENROUTER_API_KEY is configured" without disclosing the value.
 */
export declare function serializeProviderForClient(p: ProviderConfig): Record<string, unknown>;
export interface AddProviderInput {
    presetId: string;
    label?: string | undefined;
    baseUrl?: string | null | undefined;
    apiKeyEnv?: string | null | undefined;
    apiKey?: string | null | undefined;
    enabled?: boolean | undefined;
}
export declare function addProvider(input: AddProviderInput): ProviderConfig;
export interface UpdateProviderInput {
    label?: string | undefined;
    baseUrl?: string | null | undefined;
    apiKeyEnv?: string | null | undefined;
    apiKey?: string | null | undefined;
    enabled?: boolean | undefined;
}
export declare function updateProvider(id: string, patch: UpdateProviderInput): ProviderConfig | null;
export declare function removeProvider(id: string): boolean;
export declare function markTested(id: string, ok: boolean, reason: string | null, providerError?: StructuredProviderError | null): ProviderConfig | null;
export interface AddModelInput {
    providerConfigId: string;
    modelId: string;
    displayName?: string | undefined;
    tags?: string[] | undefined;
    notes?: string | undefined;
    enabled?: boolean | undefined;
}
export declare function addModel(input: AddModelInput): ModelEntry;
/**
 * Parse a newline/comma-separated paste into individual model ids and add each
 * one (deduped against the provider's existing entries). Blank lines and
 * leading bullet characters (`- ` / `* `) are stripped so users can paste
 * Markdown lists verbatim.
 */
export declare function bulkAddModels(providerConfigId: string, pasted: string): {
    added: ModelEntry[];
    skipped: Array<{
        modelId: string;
        reason: string;
    }>;
};
export interface UpdateModelInput {
    displayName?: string | undefined;
    enabled?: boolean | undefined;
    tags?: string[] | undefined;
    notes?: string | null | undefined;
}
export declare function updateModel(id: string, patch: UpdateModelInput): ModelEntry | null;
export declare function removeModel(id: string): boolean;
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
export declare function resolveRunTarget(providerConfigId: string, modelKey: string): ResolvedRunTarget | null;
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
export declare function flatCatalog(): FlatCatalogEntry[];
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
export declare function resolveByModelId(modelId: string): ResolvedRunTarget | null;
/**
 * Resolve a raw model id while honoring the caller's provider hint when one is
 * present. This closes the stale-client gap where the browser can post an old
 * adapter id (for example `squidley`) for a model that is now registered under
 * a direct preset (`minimax`). The provider hint is treated as the operator's
 * intended lane; within that lane we still resolve to the concrete configured
 * provider/model entry.
 */
export declare function resolveByModelIdWithHint(modelId: string, preferredPresetId?: string | null): ResolvedRunTarget | null;
//# sourceMappingURL=provider-registry.d.ts.map