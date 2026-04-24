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
export declare function handleRegistryState(_req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAddProvider(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleUpdateProvider(req: IncomingMessage, res: ServerResponse, providerId: string): Promise<void>;
export declare function handleRemoveProvider(_req: IncomingMessage, res: ServerResponse, providerId: string): Promise<void>;
/**
 * Live connectivity probe. Tries /models first (for providers that advertise
 * listing) and falls back to the provider's health/root endpoint. Always
 * bounded by TEST_TIMEOUT_MS so a flaky upstream can't stall the UI.
 */
export declare function handleTestProvider(_req: IncomingMessage, res: ServerResponse, providerId: string): Promise<void>;
export declare function handleAddModel(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleBulkAddModels(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleUpdateModel(req: IncomingMessage, res: ServerResponse, modelId: string): Promise<void>;
export declare function handleRemoveModel(_req: IncomingMessage, res: ServerResponse, modelId: string): Promise<void>;
//# sourceMappingURL=registry.d.ts.map