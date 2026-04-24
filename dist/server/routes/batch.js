/**
 * Crucible — Batch Routes
 * Multi-model batch execution.
 */
import { sendJSON, parseJsonBody, log, canonicalPercent } from "./shared.js";
import { validateRunBatchRequest } from "../validators.js";
import { instantiateAdapterForRun } from "../../adapters/registry.js";
import { runTask } from "../../core/runner.js";
import { storeBundle } from "../../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { summarizeRunSet } from "../contracts.js";
import { runSynthesis } from "../../core/synthesis.js";
import { requireAuth } from "../auth.js";
import { activeRuns, broadcastSSE, sseClients, markRunSettled } from "./run.js";
import { resolveByModelIdWithHint } from "../../core/provider-registry.js";
function resolveRequestedDispatch(adapter, provider, model) {
    const resolved = resolveByModelIdWithHint(model, provider);
    if (!resolved)
        return { adapter, provider, model };
    return {
        adapter: resolved.adapter,
        provider: resolved.presetId,
        model: resolved.model,
    };
}
export async function handleRunBatch(req, res) {
    if (!requireAuth(req, res))
        return;
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { error: parsed.error });
        return;
    }
    const v = validateRunBatchRequest(parsed.value);
    if (!v.ok) {
        sendJSON(res, 400, { error: "Invalid run-batch request", details: v.errors });
        return;
    }
    const body = v.value;
    const batchId = `batch_${Date.now().toString(36)}`;
    const autoSynthesis = body.auto_synthesis;
    const reviewConfig = {
        secondOpinion: {
            enabled: !!(body.secondOpinion?.enabled),
            provider: body.secondOpinion?.provider ?? "",
            model: body.secondOpinion?.model ?? "",
        },
        qcReview: {
            enabled: !!(body.qcReview?.enabled),
            provider: body.qcReview?.provider ?? "",
            model: body.qcReview?.model ?? "",
        },
    };
    activeRuns.set(batchId, {
        id: batchId,
        status: "running",
        events: [],
        request: {
            task: body.task,
            adapter: "batch",
            provider: null,
            model: body.models.map((model) => model.model).join(","),
            count: body.models.length,
            judge: DETERMINISTIC_JUDGE_METADATA,
        },
    });
    sendJSON(res, 202, {
        ok: true,
        batch_id: batchId,
        total_models: body.models.length,
        auto_synthesis: autoSynthesis,
        judge: DETERMINISTIC_JUDGE_METADATA,
    });
    void (async () => {
        const completedBundles = [];
        try {
            for (let index = 0; index < body.models.length; index += 1) {
                const modelSpec = body.models[index];
                const dispatch = resolveRequestedDispatch(modelSpec.adapter, modelSpec.provider ?? null, modelSpec.model);
                const adapterId = dispatch.adapter;
                broadcastSSE(batchId, "step", {
                    type: "task_start",
                    detail: `Model ${index + 1}/${body.models.length}: ${adapterId}/${dispatch.model}`,
                });
                try {
                    const adapterInstance = await instantiateAdapterForRun({
                        adapter: adapterId,
                        model: dispatch.model,
                        provider: dispatch.provider,
                    });
                    const health = await adapterInstance.adapter.healthCheck();
                    if (!health.ok) {
                        broadcastSSE(batchId, "step", { type: "skip", detail: `${adapterId}/${dispatch.model}: unavailable — ${health.reason ?? "no reason"}` });
                        log("debug", "api", `Batch skip: ${adapterId}/${dispatch.model} unavailable`);
                        await adapterInstance.adapter.teardown();
                        continue;
                    }
                    const result = await runTask({
                        taskId: body.task,
                        adapter: adapterInstance.adapter,
                        model: dispatch.model,
                        keepWorkspace: false,
                        reviewConfig,
                    });
                    storeBundle(result.bundle);
                    completedBundles.push(result.bundle);
                    broadcastSSE(batchId, "step", {
                        type: "task_complete",
                        detail: `${adapterId}/${dispatch.model}: ${result.bundle.score.pass ? "PASS" : "FAIL"} (${Math.round(canonicalPercent(result.bundle.score.total))}%)`,
                    });
                    await adapterInstance.adapter.teardown();
                }
                catch (err) {
                    broadcastSSE(batchId, "step", {
                        type: "error",
                        detail: `${adapterId}/${dispatch.model}: ${String(err).slice(0, 200)}`,
                    });
                }
            }
            let synthesis = null;
            if (autoSynthesis && completedBundles.length >= 2) {
                synthesis = runSynthesis(completedBundles);
                broadcastSSE(batchId, "step", {
                    type: "task_complete",
                    detail: `Synthesis complete: ${synthesis.consensus.length} consensus, ${synthesis.outliers.length} outliers, anti-consensus: ${synthesis.truth_alignment.anti_consensus}`,
                });
            }
            const active = activeRuns.get(batchId);
            if (active) {
                active.status = "complete";
                active.bundles = completedBundles;
                if (completedBundles.length > 0) {
                    active.bundle = completedBundles[completedBundles.length - 1];
                    active.aggregate = summarizeRunSet(completedBundles);
                }
            }
            broadcastSSE(batchId, "complete", {
                batch_id: batchId,
                bundle_ids: completedBundles.map((bundle) => bundle.bundle_id),
                total: body.models.length,
                completed: completedBundles.length,
                synthesis,
            });
        }
        catch (err) {
            const active = activeRuns.get(batchId);
            if (active) {
                active.status = "error";
                active.error = String(err);
            }
            broadcastSSE(batchId, "error", { error: String(err) });
        }
        finally {
            const clients = sseClients.get(batchId) ?? [];
            for (const client of clients) {
                try {
                    client.end();
                }
                catch { /* ignore */ }
            }
            sseClients.delete(batchId);
            markRunSettled(batchId);
        }
    })();
}
//# sourceMappingURL=batch.js.map