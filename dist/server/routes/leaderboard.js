/**
 * Crucibulum — Leaderboard & Scores Routes
 * Score queries, leaderboard, synthesis, verum ingest.
 */
import { sendJSON, parseJsonBody, loadBundles, getBundleById, parseFamiliesParam } from "./shared.js";
import { validateScoresSyncRequest, validateSynthesisRequest } from "../validators.js";
import { storeScores, queryScores, getLeaderboard } from "../../core/score-store.js";
import { runSynthesis } from "../../core/synthesis.js";
import { normalizeVerumIngest } from "../../core/verum.js";
import { requireAuth } from "../auth.js";
export async function handleScoresSync(req, res) {
    if (!requireAuth(req, res))
        return;
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { ok: false, stored: 0, errors: [parsed.error] });
        return;
    }
    const v = validateScoresSyncRequest(parsed.value);
    if (!v.ok) {
        sendJSON(res, 400, { ok: false, stored: 0, errors: v.errors });
        return;
    }
    const body = v.value;
    const source = body.source;
    const validScores = body.scores;
    const result = storeScores(validScores, source, body.runId);
    // 200 = all accepted, 207 = partial (some stored, some rejected), 400 = nothing stored.
    const status = result.errors.length === 0 ? 200 : result.stored === 0 ? 400 : 207;
    sendJSON(res, status, {
        ok: result.errors.length === 0,
        stored: result.stored,
        errors: result.errors,
    });
}
export async function handleVerumIngest(req, res) {
    if (!requireAuth(req, res))
        return;
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { ok: false, stored: 0, errors: [parsed.error], source: "verum" });
        return;
    }
    const body = parsed.value;
    if (!body || typeof body.modelId !== "string" || typeof body.provider !== "string" || typeof body.adapter !== "string" || !Array.isArray(body.results) || body.results.length === 0) {
        sendJSON(res, 400, { ok: false, stored: 0, errors: ["modelId, provider, adapter, and a non-empty results array are required"], source: "verum" });
        return;
    }
    const scores = normalizeVerumIngest(body);
    const result = storeScores(scores, "verum", body.runId);
    sendJSON(res, 200, {
        ok: result.errors.length === 0,
        stored: result.stored,
        errors: result.errors,
        source: "verum",
    });
}
export async function handleScoresQuery(req, res, url) {
    const modelId = url.searchParams.get("modelId") ?? undefined;
    const family = url.searchParams.get("family") ?? undefined;
    const taskId = url.searchParams.get("taskId") ?? undefined;
    const source = url.searchParams.get("source") ?? undefined;
    const parsedLimit = parseInt(url.searchParams.get("limit") ?? "100", 10);
    // Clamp limit: negative / NaN / over-cap all fall back to a safe bound.
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 1000) : 100;
    const scores = queryScores({ modelId, family, taskId, source, limit });
    sendJSON(res, 200, { scores, count: scores.length });
}
export async function handleLeaderboard(req, res, url) {
    const families = parseFamiliesParam(url);
    const entries = getLeaderboard(families ?? undefined);
    sendJSON(res, 200, { leaderboard: entries, families });
}
export async function handleSynthesis(req, res) {
    if (!requireAuth(req, res))
        return;
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { error: parsed.error });
        return;
    }
    const v = validateSynthesisRequest(parsed.value);
    if (!v.ok) {
        sendJSON(res, 400, { error: "Invalid synthesis request", details: v.errors });
        return;
    }
    const body = v.value;
    let bundles;
    if (body.run_ids && body.run_ids.length > 0) {
        bundles = [];
        for (const id of body.run_ids) {
            const bundle = getBundleById(id);
            if (!bundle) {
                sendJSON(res, 404, { error: `Run not found: ${id}` });
                return;
            }
            bundles.push(bundle);
        }
    }
    else if (body.task_id) {
        const allBundles = loadBundles();
        bundles = allBundles.filter((bundle) => bundle.task.id === body.task_id);
        if (bundles.length === 0) {
            sendJSON(res, 404, { error: `No runs found for task: ${body.task_id}` });
            return;
        }
    }
    else {
        sendJSON(res, 400, { error: "run_ids or task_id is required" });
        return;
    }
    const taskIds = new Set(bundles.map((bundle) => bundle.task.id));
    if (taskIds.size > 1) {
        sendJSON(res, 400, { error: `All runs must be for the same task. Found: ${Array.from(taskIds).join(", ")}` });
        return;
    }
    const synthesis = runSynthesis(bundles);
    sendJSON(res, 200, { synthesis });
}
//# sourceMappingURL=leaderboard.js.map