/**
 * Crucible — Provider / Model registry routes
 *
 * Exposes the data-plane CRUD on top of core/provider-registry:
 *
 *   GET    /api/registry/state                — presets + providers (masked) + models + flat catalog
 *   POST   /api/registry/providers            — add from preset
 *   PATCH  /api/registry/providers/:id        — edit label / baseUrl / apiKey / enabled
 *   DELETE /api/registry/providers/:id        — remove (cascades to models)
 *   POST   /api/registry/providers/:id/test   — live connectivity probe (bounded; safe)
 *   POST   /api/registry/models               — add model to a provider
 *   POST   /api/registry/models/bulk          — paste-many add (OpenRouter-style)
 *   PATCH  /api/registry/models/:id           — edit displayName / enabled / tags / notes
 *   DELETE /api/registry/models/:id           — remove
 *
 * All write routes require auth (routed through requireAuth in server/app.ts).
 * Connection tests are wrapped in a hard timeout so a misconfigured provider
 * can't hang the request.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { parseJsonBody, sendJSON } from "./shared.js";
import {
  listPresets,
  listProviders,
  listModels,
  getProvider,
  addProvider,
  updateProvider,
  removeProvider,
  markTested,
  addModel,
  updateModel,
  removeModel,
  bulkAddModels,
  serializeProviderForClient,
  flatCatalog,
  getPreset,
} from "../../core/provider-registry.js";
import { getCircuitState } from "../../core/circuit-breaker.js";
import { makeHttpProviderError, normalizeProviderError, providerErrorSummary } from "../../core/provider-errors.js";
import type { StructuredProviderError } from "../../types/provider-error.js";
import { log } from "../../utils/logger.js";

const TEST_TIMEOUT_MS = 10_000;

// ── GET /api/registry/state ────────────────────────────────────────────────

export async function handleRegistryState(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const providers = listProviders().map(serializeProviderForClient);
  // Attach per-preset circuit state so the UI can show "OpenRouter: degraded"
  // alongside the provider card. Circuit keys today are adapter-id-scoped,
  // which matches the "one instance per preset" typical use-case.
  const presets = listPresets().map((p) => ({
    ...p,
    circuit: getCircuitState(p.adapter),
  }));
  sendJSON(res, 200, {
    presets,
    providers,
    models: listModels(),
    catalog: flatCatalog(),
  });
}

// ── POST /api/registry/providers ───────────────────────────────────────────

export async function handleAddProvider(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const body = parsed.value;
  const presetId = typeof body["presetId"] === "string" ? body["presetId"] : "";
  if (!presetId || !getPreset(presetId)) {
    sendJSON(res, 400, { error: "Invalid or missing presetId", presets: listPresets().map((p) => p.id) });
    return;
  }
  try {
    const cfg = addProvider({
      presetId,
      label: typeof body["label"] === "string" ? body["label"] : undefined,
      baseUrl: typeof body["baseUrl"] === "string" ? body["baseUrl"] : null,
      apiKeyEnv: typeof body["apiKeyEnv"] === "string" ? body["apiKeyEnv"] : undefined,
      apiKey: typeof body["apiKey"] === "string" ? body["apiKey"] : undefined,
      enabled: typeof body["enabled"] === "boolean" ? body["enabled"] : true,
    });
    sendJSON(res, 201, { provider: serializeProviderForClient(cfg) });
  } catch (err) {
    sendJSON(res, 400, { error: String(err).slice(0, 200) });
  }
}

// ── PATCH /api/registry/providers/:id ──────────────────────────────────────

export async function handleUpdateProvider(req: IncomingMessage, res: ServerResponse, providerId: string): Promise<void> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const body = parsed.value;
  const updated = updateProvider(providerId, {
    label: typeof body["label"] === "string" ? body["label"] : undefined,
    baseUrl: typeof body["baseUrl"] === "string" ? body["baseUrl"] : body["baseUrl"] === null ? null : undefined,
    apiKeyEnv: typeof body["apiKeyEnv"] === "string" ? body["apiKeyEnv"] : body["apiKeyEnv"] === null ? null : undefined,
    apiKey: typeof body["apiKey"] === "string" ? body["apiKey"] : body["apiKey"] === null ? null : undefined,
    enabled: typeof body["enabled"] === "boolean" ? body["enabled"] : undefined,
  });
  if (!updated) { sendJSON(res, 404, { error: "Provider not found" }); return; }
  sendJSON(res, 200, { provider: serializeProviderForClient(updated) });
}

// ── DELETE /api/registry/providers/:id ─────────────────────────────────────

export async function handleRemoveProvider(_req: IncomingMessage, res: ServerResponse, providerId: string): Promise<void> {
  const ok = removeProvider(providerId);
  if (!ok) { sendJSON(res, 404, { error: "Provider not found" }); return; }
  sendJSON(res, 200, { ok: true });
}

// ── POST /api/registry/providers/:id/test ──────────────────────────────────

/**
 * Live connectivity probe. Tries /models first (for providers that advertise
 * listing) and falls back to the provider's health/root endpoint. Always
 * bounded by TEST_TIMEOUT_MS so a flaky upstream can't stall the UI.
 */
export async function handleTestProvider(_req: IncomingMessage, res: ServerResponse, providerId: string): Promise<void> {
  const provider = getProvider(providerId);
  if (!provider) { sendJSON(res, 404, { error: "Provider not found" }); return; }
  const preset = getPreset(provider.presetId);
  if (!preset) { sendJSON(res, 400, { error: "Provider has unknown preset" }); return; }

  const baseUrl = provider.baseUrl ?? preset.defaultBaseUrl;
  if (!baseUrl) {
    const updated = markTested(providerId, false, "No base URL configured", null);
    sendJSON(res, 200, { ok: false, reason: "No base URL configured", provider_error: null, provider: updated ? serializeProviderForClient(updated) : null });
    return;
  }
  const apiKey = provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] ?? "" : "");

  // Decide what to probe. For presets that advertise listing, hit /models —
  // that doubles as an auth check. For providers that don't, just issue a
  // HEAD/GET on the base URL to prove network reachability.
  const probePath = preset.supportsModelListing ? "/models" : "";
  const url = `${baseUrl.replace(/\/+$/, "")}${probePath}`;

  let outcome: { ok: boolean; reason: string; providerError: StructuredProviderError | null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    const headers: Record<string, string> = {};
    if (preset.authStyle === "bearer" && apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (preset.authStyle === "header" && apiKey) {
      headers["x-api-key"] = apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
    const r = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timer);
    if (r.status === 200 || r.status === 204) {
      outcome = { ok: true, reason: `HTTP ${r.status}`, providerError: null };
    } else {
      const providerError = makeHttpProviderError(r, await r.text().catch(() => ""), { provider: preset.id, adapter: preset.adapter }).structured;
      outcome = { ok: false, reason: providerErrorSummary(providerError), providerError };
    }
  } catch (err) {
    const providerError = normalizeProviderError(err, { provider: preset.id, adapter: preset.adapter });
    outcome = { ok: false, reason: providerErrorSummary(providerError), providerError };
  }

  const updated = markTested(providerId, outcome.ok, outcome.reason, outcome.providerError);
  log("info", "registry", `Test provider ${providerId}: ${outcome.ok ? "ok" : "fail"} — ${outcome.reason}`);
  sendJSON(res, 200, {
    ok: outcome.ok,
    reason: outcome.reason,
    provider_error: outcome.providerError,
    provider: updated ? serializeProviderForClient(updated) : null,
  });
}

// ── POST /api/registry/models ──────────────────────────────────────────────

export async function handleAddModel(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const body = parsed.value;
  const providerConfigId = typeof body["providerConfigId"] === "string" ? body["providerConfigId"] : "";
  const modelId = typeof body["modelId"] === "string" ? body["modelId"] : "";
  if (!providerConfigId || !modelId) {
    sendJSON(res, 400, { error: "providerConfigId and modelId are required" });
    return;
  }
  try {
    const entry = addModel({
      providerConfigId,
      modelId,
      displayName: typeof body["displayName"] === "string" ? body["displayName"] : undefined,
      tags: Array.isArray(body["tags"]) ? body["tags"] as string[] : undefined,
      notes: typeof body["notes"] === "string" ? body["notes"] : undefined,
      enabled: typeof body["enabled"] === "boolean" ? body["enabled"] : true,
    });
    sendJSON(res, 201, { model: entry });
  } catch (err) {
    sendJSON(res, 400, { error: String(err).slice(0, 200) });
  }
}

// ── POST /api/registry/models/bulk ─────────────────────────────────────────

export async function handleBulkAddModels(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const body = parsed.value;
  const providerConfigId = typeof body["providerConfigId"] === "string" ? body["providerConfigId"] : "";
  const pasted = typeof body["pasted"] === "string" ? body["pasted"] : "";
  if (!providerConfigId || !pasted.trim()) {
    sendJSON(res, 400, { error: "providerConfigId and pasted are required" });
    return;
  }
  try {
    const result = bulkAddModels(providerConfigId, pasted);
    sendJSON(res, 201, result);
  } catch (err) {
    sendJSON(res, 400, { error: String(err).slice(0, 200) });
  }
}

// ── PATCH /api/registry/models/:id ─────────────────────────────────────────

export async function handleUpdateModel(req: IncomingMessage, res: ServerResponse, modelId: string): Promise<void> {
  const parsed = await parseJsonBody<Record<string, unknown>>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const body = parsed.value;
  const updated = updateModel(modelId, {
    displayName: typeof body["displayName"] === "string" ? body["displayName"] : undefined,
    enabled: typeof body["enabled"] === "boolean" ? body["enabled"] : undefined,
    tags: Array.isArray(body["tags"]) ? body["tags"] as string[] : undefined,
    notes: typeof body["notes"] === "string" ? body["notes"] : body["notes"] === null ? null : undefined,
  });
  if (!updated) { sendJSON(res, 404, { error: "Model not found" }); return; }
  sendJSON(res, 200, { model: updated });
}

// ── DELETE /api/registry/models/:id ────────────────────────────────────────

export async function handleRemoveModel(_req: IncomingMessage, res: ServerResponse, modelId: string): Promise<void> {
  const ok = removeModel(modelId);
  if (!ok) { sendJSON(res, 404, { error: "Model not found" }); return; }
  sendJSON(res, 200, { ok: true });
}
