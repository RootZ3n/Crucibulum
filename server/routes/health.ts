/**
 * Luak — Health Routes
 * Health check, adapter status, judge info.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJSON, log } from "./shared.js";
import { readRecentLogs } from "../../utils/logger.js";
import { getAdapterCatalog } from "../../adapters/registry.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { describeDefaultJudge, resolveJudgeConfig } from "../../core/judge-config.js";
import { getCircuitState, rateLimitStatus, circuitReset } from "../../core/circuit-breaker.js";
import { listScorers } from "../../core/scorer-registry.js";
import { listSuites, listTaskDetails } from "./shared.js";
import { cleanupStaleArtifacts, getCleanupStats, getReaperStatus } from "../../core/cleanup.js";

export async function handleHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  sendJSON(res, 200, {
    status: "ok",
    service: "luak",
    service_legacy: "crucible",
    auth: { enabled: false, scheme: "none", note: "no built-in auth — operator owns network-layer access control" },
    uptime: process.uptime(),
  });
}

export async function handleHealthLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Operator visibility (Audit C1): tail the persisted server log. A detached
  // server has no terminal, so this is the only window into reaper activity,
  // startup warnings, and crash traces without reproducing the failure.
  const url = new URL(req.url ?? "/", "http://localhost");
  const requested = parseInt(url.searchParams.get("limit") ?? "100", 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 1000) : 100;
  const logs = readRecentLogs(limit);
  sendJSON(res, 200, { count: logs.length, limit, logs });
}

export async function handleReaperHealth(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  // Operator-facing proof the TTL reaper is alive (Audit C2). lastRun is null
  // until the first cycle (startup reap runs synchronously, so by the time the
  // server answers requests this is populated).
  const status = getReaperStatus();
  sendJSON(res, 200, {
    lastRun: status.lastRun,
    lastRunIso: status.lastRun ? new Date(status.lastRun).toISOString() : null,
    lastChecked: status.lastChecked,
    lastDeleted: status.lastDeleted,
    lastKept: status.lastKept,
    errors: status.lastErrors,
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
  // Expose both the deterministic judge (always-on, authoritative) and the
  // configured *model* judge (advisory, used for subjective tone scoring and
  // QC review) so the UI/CLI can render "Tested model" and "Judge model" in
  // the same panel without guessing what's running.
  const judgeCfg = resolveJudgeConfig();
  sendJSON(res, 200, {
    judge: DETERMINISTIC_JUDGE_METADATA,
    model_judge: {
      ...describeDefaultJudge(),
      source: judgeCfg.source,
    },
  });
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

export async function handleResetAdapterCircuit(_req: IncomingMessage, res: ServerResponse, adapterId: string): Promise<void> {
  if (!adapterId) { sendJSON(res, 400, { error: "adapter id required" }); return; }
  circuitReset(adapterId);
  log("info", "circuit-breaker", `Circuit ${adapterId}: reset via API`);
  sendJSON(res, 200, { ok: true, adapter: adapterId, circuit: getCircuitState(adapterId) });
}
