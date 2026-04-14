/**
 * Crucibulum — Health Routes
 * Health check, adapter status, judge info.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJSON, log } from "./shared.js";
import { getAdapterCatalog } from "../../adapters/registry.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { getCircuitState, rateLimitStatus } from "../../core/circuit-breaker.js";
import { authStatus } from "../auth.js";
import { listScorers } from "../../core/scorer-registry.js";
import { listSuites, listTaskDetails } from "./shared.js";
import { cleanupStaleArtifacts, getCleanupStats } from "../../core/cleanup.js";

export async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJSON(res, 200, {
    status: "ok",
    service: "crucibulum",
    auth: authStatus(),
    uptime: process.uptime(),
  });
}

export async function handleScorers(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJSON(res, 200, { scorers: listScorers() });
}

export async function handleScorersHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const all = listScorers();
  sendJSON(res, 200, {
    status: all.length > 0 ? "ok" : "no_scorers_loaded",
    count: all.length,
    scorers: all.map(s => s.id),
  });
}

export async function handleAdaptersHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const catalog = await getAdapterCatalog();
  const status = catalog.map(a => ({
    id: a.id,
    name: a.name,
    available: a.available,
    circuit: getCircuitState(a.id),
    rateLimit: rateLimitStatus(a.id),
  }));
  sendJSON(res, 200, { adapters: status });
}

export async function handleJudge(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJSON(res, 200, { judge: DETERMINISTIC_JUDGE_METADATA });
}

export async function handleSuites(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJSON(res, 200, { suites: listSuites() });
}

export async function handleTasks(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJSON(res, 200, { tasks: listTaskDetails() });
}

export async function handleAdapters(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const adapters = await getAdapterCatalog();
  sendJSON(res, 200, { adapters, judge: DETERMINISTIC_JUDGE_METADATA });
}

export async function handleModels(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { listFlattenedModels } = await import("../../adapters/registry.js");
  const models = await listFlattenedModels();
  sendJSON(res, 200, { models });
}

export async function handleProviders(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { getProviderCatalog } = await import("../../adapters/registry.js");
  const catalog = await getProviderCatalog();
  sendJSON(res, 200, catalog);
}
