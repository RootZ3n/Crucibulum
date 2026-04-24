/**
 * Crucible — Leaderboard & Scores Routes
 * Score queries, leaderboard, synthesis, verum ingest.
 */
import { sendJSON, parseJsonBody, loadBundles, getBundleById, filterBundlesByTaskFamilies, resolveLaneScope, parseFamiliesParam, canonicalPercent } from "./shared.js";
import { validateScoresSyncRequest, validateSynthesisRequest } from "../validators.js";
import { storeScores, queryScores, getLeaderboard } from "../../core/score-store.js";
import { runSynthesis } from "../../core/synthesis.js";
import { normalizeVerumIngest } from "../../core/verum.js";
import { summarizeRunSet } from "../contracts.js";
import { FAMILY_WEIGHTS, LEADERBOARD_MIN_N, SCORE_FAMILIES, SCORE_FAMILY_SPECS, } from "../../types/scores.js";
import { requireAuth } from "../auth.js";
function scoreFamilyForTaskFamily(taskFamily) {
    for (const family of SCORE_FAMILIES) {
        if (SCORE_FAMILY_SPECS[family].taskFamilies.includes(taskFamily)) {
            return family;
        }
    }
    if (taskFamily === "poison" || taskFamily === "security") {
        return "A";
    }
    return null;
}
function buildScopedLeaderboardEntries(bundles) {
    const grouped = new Map();
    for (const bundle of bundles) {
        const group = grouped.get(bundle.agent.model) ?? [];
        group.push(bundle);
        grouped.set(bundle.agent.model, group);
    }
    const entries = [];
    for (const [modelId, runs] of grouped) {
        const summary = summarizeRunSet(runs);
        const familyAverages = { A: null, B: null, C: null, D: null, E: null, F: null, G: null, H: null, I: null };
        const weighted = [];
        for (const family of SCORE_FAMILIES) {
            const familyRuns = runs.filter((bundle) => scoreFamilyForTaskFamily(bundle.task.family) === family);
            if (familyRuns.length === 0)
                continue;
            const average = Math.round((familyRuns.reduce((sum, bundle) => sum + canonicalPercent(bundle.score.total), 0) / familyRuns.length) * 100) / 100;
            familyAverages[family] = average;
            weighted.push({ family, score: average });
        }
        const weightedSum = weighted.reduce((sum, item) => sum + item.score * FAMILY_WEIGHTS[item.family], 0);
        const totalWeight = weighted.reduce((sum, item) => sum + FAMILY_WEIGHTS[item.family], 0);
        const composite = totalWeight > 0
            ? Math.round((weightedSum / totalWeight) * 100) / 100
            : Math.round(summary.avg_score * 100) / 100;
        const averagePassRate = summary.run_count > 0 ? Math.round((summary.passes / summary.run_count) * 100) / 100 : 0;
        const stabilityScore = Math.round(Math.abs(averagePassRate - 0.5) * 2 * 100) / 100;
        const sampleAdequate = summary.run_count >= LEADERBOARD_MIN_N;
        const samplePenalty = sampleAdequate ? 1 : Math.max(0, summary.run_count) / LEADERBOARD_MIN_N;
        const reliabilityScore = Math.round((composite * (0.5 + stabilityScore * 0.5) * samplePenalty) * 100) / 100;
        const confidence = !sampleAdequate
            ? "low"
            : averagePassRate >= 0.95 && stabilityScore >= 0.8
                ? "high"
                : averagePassRate >= 0.7 || stabilityScore >= 0.5
                    ? "medium"
                    : "low";
        const lastRun = runs.reduce((latest, bundle) => bundle.environment.timestamp_start > latest ? bundle.environment.timestamp_start : latest, "");
        entries.push({
            modelId,
            composite,
            families: familyAverages,
            totalRuns: summary.run_count,
            completedRuns: summary.run_count - summary.not_complete,
            notCompleteRuns: summary.not_complete,
            lastRun,
            source: "crucibulum",
            average_pass_rate: averagePassRate,
            model_failure_rate: summary.run_count > 0 ? Math.round((summary.failures / summary.run_count) * 100) / 100 : 0,
            completion_rate: summary.run_count > 0 ? Math.round(((summary.run_count - summary.not_complete) / summary.run_count) * 100) / 100 : 0,
            nc_rate: summary.run_count > 0 ? Math.round((summary.not_complete / summary.run_count) * 100) / 100 : 0,
            stability_score: stabilityScore,
            reliability_score: reliabilityScore,
            confidence,
            sample_adequate: sampleAdequate,
            sample_penalty: Math.round(samplePenalty * 100) / 100,
        });
    }
    entries.sort((a, b) => {
        const aRel = a.reliability_score ?? a.composite;
        const bRel = b.reliability_score ?? b.composite;
        if (bRel !== aRel)
            return bRel - aRel;
        if ((b.average_pass_rate ?? 0) !== (a.average_pass_rate ?? 0))
            return (b.average_pass_rate ?? 0) - (a.average_pass_rate ?? 0);
        if ((b.stability_score ?? 0) !== (a.stability_score ?? 0))
            return (b.stability_score ?? 0) - (a.stability_score ?? 0);
        if (b.composite !== a.composite)
            return b.composite - a.composite;
        return a.modelId.localeCompare(b.modelId);
    });
    return entries;
}
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
    const scope = resolveLaneScope(url);
    if (scope.taskFamilies && scope.taskFamilies.length > 0) {
        // Lane-scoped path: filter the full bundle set by the requested task
        // families BEFORE ranking, so best/worst/reliability are computed over the
        // same lane the UI asked for. We deliberately do not fall back to the
        // shared score-store on this path — that DB is populated by external
        // ingest (verum/crucibulum sync) and would cross-contaminate a scoped
        // leaderboard with rows that don't belong to any of the requested lanes.
        const bundles = filterBundlesByTaskFamilies(loadBundles(), scope.taskFamilies);
        sendJSON(res, 200, {
            leaderboard: buildScopedLeaderboardEntries(bundles),
            task_families: scope.taskFamilies,
            scope_key: scope.scopeKey,
        });
        return;
    }
    // Global ("all lanes") path: legacy score-family filter into the score-store.
    // This is the dashboard/overview view; lane tabs never hit this branch.
    const families = parseFamiliesParam(url);
    const entries = getLeaderboard(families ?? undefined);
    sendJSON(res, 200, { leaderboard: entries, families, task_families: null, scope_key: "all" });
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