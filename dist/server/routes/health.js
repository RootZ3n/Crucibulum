/**
 * Crucible — Health Routes
 * Health check, adapter status, judge info.
 */
import { sendJSON, log } from "./shared.js";
import { getAdapterCatalog } from "../../adapters/registry.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { describeDefaultJudge, resolveJudgeConfig } from "../../core/judge-config.js";
import { getCircuitState, rateLimitStatus, circuitReset } from "../../core/circuit-breaker.js";
import { authStatus } from "../auth.js";
import { listScorers } from "../../core/scorer-registry.js";
import { listSuites, listTaskDetails } from "./shared.js";
export async function handleHealth(_req, res) {
    sendJSON(res, 200, {
        status: "ok",
        service: "crucible",
        auth: authStatus(),
        uptime: process.uptime(),
    });
}
export async function handleScorers(_req, res) {
    sendJSON(res, 200, { scorers: listScorers() });
}
export async function handleScorersHealth(_req, res) {
    const all = listScorers();
    sendJSON(res, 200, {
        status: all.length > 0 ? "ok" : "no_scorers_loaded",
        count: all.length,
        scorers: all.map(s => s.id),
    });
}
export async function handleAdaptersHealth(_req, res) {
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
export async function handleJudge(_req, res) {
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
export async function handleSuites(_req, res) {
    sendJSON(res, 200, { suites: listSuites() });
}
export async function handleTasks(_req, res) {
    sendJSON(res, 200, { tasks: listTaskDetails() });
}
export async function handleAdapters(_req, res) {
    const adapters = await getAdapterCatalog();
    sendJSON(res, 200, { adapters, judge: DETERMINISTIC_JUDGE_METADATA });
}
export async function handleModels(_req, res) {
    const { listFlattenedModels } = await import("../../adapters/registry.js");
    const models = await listFlattenedModels();
    sendJSON(res, 200, { models });
}
export async function handleProviders(_req, res) {
    const { getProviderCatalog } = await import("../../adapters/registry.js");
    const catalog = await getProviderCatalog();
    sendJSON(res, 200, catalog);
}
export async function handleResetAdapterCircuit(_req, res, adapterId) {
    if (!adapterId) {
        sendJSON(res, 400, { error: "adapter id required" });
        return;
    }
    circuitReset(adapterId);
    log("info", "circuit-breaker", `Circuit ${adapterId}: reset via API`);
    sendJSON(res, 200, { ok: true, adapter: adapterId, circuit: getCircuitState(adapterId) });
}
//# sourceMappingURL=health.js.map