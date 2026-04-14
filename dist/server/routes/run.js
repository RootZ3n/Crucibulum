/**
 * Crucibulum — Run Routes
 * Single task execution, run queries, SSE streaming.
 */
import { sendJSON, parseJsonBody, isSafeId, loadBundles, getBundleById, filterBundlesByFamilies, parseFamiliesParam, bundleSummary, getStats, canonicalPercent } from "./shared.js";
import { validateRunRequest, validateCrucibleLinkRequest } from "../validators.js";
import { instantiateAdapterForRun } from "../../adapters/registry.js";
import { runTask } from "../../core/runner.js";
import { storeBundle } from "../../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { summarizeRunSet } from "../contracts.js";
import { writeCrucibleLink } from "../validation-links.js";
import { requireAuth } from "../auth.js";
export const activeRuns = new Map();
export const sseClients = new Map();
const RUN_COMPLETED_AT = new Map();
// Keep completed in-memory entries for 10 minutes so clients can still poll /status, then evict.
// Persistent bundles remain on disk and accessible via getBundleById regardless.
const RUN_RETENTION_MS = 10 * 60 * 1000;
// Hard cap so a flood of runs cannot exhaust heap.
const MAX_ACTIVE_RUNS = 256;
export function markRunSettled(runId) {
    RUN_COMPLETED_AT.set(runId, Date.now());
}
function gcActiveRuns() {
    const now = Date.now();
    for (const [id, completedAt] of RUN_COMPLETED_AT) {
        if (now - completedAt > RUN_RETENTION_MS) {
            activeRuns.delete(id);
            RUN_COMPLETED_AT.delete(id);
        }
    }
    // Hard cap: if still over, evict oldest-settled first.
    if (activeRuns.size > MAX_ACTIVE_RUNS) {
        const sorted = Array.from(RUN_COMPLETED_AT.entries()).sort((a, b) => a[1] - b[1]);
        while (activeRuns.size > MAX_ACTIVE_RUNS && sorted.length > 0) {
            const entry = sorted.shift();
            activeRuns.delete(entry[0]);
            RUN_COMPLETED_AT.delete(entry[0]);
        }
    }
}
export function broadcastSSE(runId, event, data) {
    const clients = sseClients.get(runId) ?? [];
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        try {
            res.write(msg);
        }
        catch { /* ignore */ }
    }
    const run = activeRuns.get(runId);
    if (run)
        run.events.push(msg);
}
export async function handleRunsList(req, res, url) {
    const families = parseFamiliesParam(url);
    const allBundles = loadBundles();
    const bundles = filterBundlesByFamilies(allBundles, families);
    bundles.sort((a, b) => new Date(b.environment.timestamp_start).getTime() - new Date(a.environment.timestamp_start).getTime());
    const runs = bundles.map((bundle) => {
        const summary = bundleSummary(bundle, allBundles);
        return {
            bundle_id: bundle.bundle_id,
            bundle_hash: bundle.bundle_hash,
            task_id: bundle.task.id,
            family: bundle.task.family,
            difficulty: bundle.task.difficulty,
            model: bundle.agent.model,
            provider: bundle.agent.provider,
            adapter: bundle.agent.adapter,
            score: canonicalPercent(bundle.score.total),
            pass: bundle.score.pass,
            pass_threshold: canonicalPercent(bundle.score.pass_threshold),
            integrity_violations: bundle.score.integrity_violations,
            breakdown: {
                correctness: canonicalPercent(bundle.score.breakdown.correctness),
                regression: canonicalPercent(bundle.score.breakdown.regression),
                integrity: canonicalPercent(bundle.score.breakdown.integrity),
                efficiency: canonicalPercent(bundle.score.breakdown.efficiency),
            },
            failure_taxonomy: summary.outcome.failure_taxonomy,
            timestamp: bundle.environment.timestamp_start,
            duration_sec: summary.timing.duration_sec,
            tokens_in: bundle.usage.tokens_in,
            tokens_out: bundle.usage.tokens_out,
            cost_usd: bundle.usage.estimated_cost_usd,
            judge: bundle.judge,
            judge_status: "authoritative",
            trust: summary.trust,
            review: bundle.review ?? null,
            second_opinion_status: bundle.review?.secondOpinion?.status ?? "skipped",
            qc_review_status: bundle.review?.qcReview?.status ?? "skipped",
            disagreement: !!(bundle.review?.secondOpinion?.disagreement || bundle.review?.qcReview?.disagreement),
            repeat_run_count: summary.repeat_run_count,
            pass_at: summary.pass_at,
            reliability: summary.reliability,
            review_security: summary.review_security,
        };
    });
    sendJSON(res, 200, { runs, families });
}
export async function handleRunSummary(req, res, path) {
    const id = path.replace("/api/runs/", "").replace("/summary", "");
    const bundle = getBundleById(id);
    if (!bundle) {
        sendJSON(res, 404, { error: "Run not found" });
        return;
    }
    const bundles = loadBundles();
    sendJSON(res, 200, { summary: bundleSummary(bundle, bundles) });
}
export async function handleRunGet(req, res, path) {
    const id = path.replace("/api/runs/", "");
    const bundle = getBundleById(id);
    if (!bundle) {
        sendJSON(res, 404, { error: "Run not found" });
        return;
    }
    const bundles = loadBundles();
    sendJSON(res, 200, { bundle, summary: bundleSummary(bundle, bundles) });
}
export async function handleStats(req, res, url) {
    const families = parseFamiliesParam(url);
    const bundles = filterBundlesByFamilies(loadBundles(), families);
    sendJSON(res, 200, { ...getStats(bundles), families });
}
export async function handleReceipts(req, res, url) {
    const families = parseFamiliesParam(url);
    const bundles = filterBundlesByFamilies(loadBundles(), families);
    bundles.sort((a, b) => new Date(b.environment.timestamp_start).getTime() - new Date(a.environment.timestamp_start).getTime());
    const receipts = bundles.map((bundle) => ({
        run_id: bundle.bundle_id,
        task_id: bundle.task.id,
        family: bundle.task.family,
        model: bundle.agent.model,
        provider: bundle.agent.provider,
        adapter: bundle.agent.adapter,
        bundle_hash: bundle.bundle_hash,
        judge: bundle.judge,
        trust: bundle.trust,
        authority: {
            deterministic_judge_authoritative: true,
            review_layer_advisory: true,
        },
        review_security: bundle.review?.security ?? null,
        review_input_sanitized: bundle.review?.security.review_input_sanitized ?? false,
        injection_flags_count: bundle.review?.security.injection_flags_count ?? 0,
        flagged_sources: bundle.review?.security.flagged_sources ?? [],
        review_blocked_reason: bundle.review?.security.review_blocked_reason ?? null,
        review_output_invalid: bundle.review?.security.review_output_invalid ?? false,
        trust_boundary_violations: bundle.review?.security.trust_boundary_violations ?? [],
        tokens_in: bundle.usage.tokens_in,
        tokens_out: bundle.usage.tokens_out,
        cost_usd: bundle.usage.estimated_cost_usd,
        duration_ms: new Date(bundle.environment.timestamp_end).getTime() - new Date(bundle.environment.timestamp_start).getTime(),
        pass: bundle.score.pass,
        score: canonicalPercent(bundle.score.total),
        timestamp: bundle.environment.timestamp_start,
    }));
    const totalCost = receipts.reduce((sum, receipt) => sum + receipt.cost_usd, 0);
    const totalTokens = receipts.reduce((sum, receipt) => sum + receipt.tokens_in + receipt.tokens_out, 0);
    sendJSON(res, 200, {
        receipts,
        summary: {
            total_runs: receipts.length,
            total_cost_usd: totalCost,
            total_tokens: totalTokens,
            judge: DETERMINISTIC_JUDGE_METADATA,
        },
    });
}
export async function handleCompare(req, res, url) {
    const taskId = url.searchParams.get("task") ?? "";
    const suiteId = url.searchParams.get("suite") ?? "v1";
    const families = parseFamiliesParam(url);
    const bundles = filterBundlesByFamilies(loadBundles(), families);
    const filtered = taskId ? bundles.filter((bundle) => bundle.task.id === taskId) : bundles;
    const groups = new Map();
    for (const bundle of filtered) {
        const key = JSON.stringify([bundle.agent.adapter, bundle.agent.provider, bundle.agent.model]);
        const group = groups.get(key) ?? [];
        group.push(bundle);
        groups.set(key, group);
    }
    const comparisons = Array.from(groups.entries()).map(([key, group]) => {
        const [adapter, provider, model] = JSON.parse(key);
        const aggregate = summarizeRunSet(group);
        return {
            adapter,
            provider,
            model,
            suite_id: suiteId,
            task_scope: taskId || "all",
            runs: aggregate.run_count,
            pass_rate: aggregate.pass_rate,
            pass_at: aggregate.pass_at,
            avg_score: aggregate.avg_score,
            avg_cost_usd: aggregate.run_count ? Math.round((aggregate.total_cost_usd / aggregate.run_count) * 10000) / 10000 : 0,
            avg_duration_sec: aggregate.run_count ? Math.round(aggregate.total_time_sec / aggregate.run_count) : 0,
            qc_disagreement_rate: aggregate.qc_disagreement_rate,
            review_blocked_rate: aggregate.review_blocked_rate,
            reliability: aggregate.reliability,
        };
    }).sort((a, b) => b.avg_score - a.avg_score);
    sendJSON(res, 200, { comparisons, task_id: taskId || null, suite_id: suiteId, families });
}
export async function handleRunStatus(req, res, path) {
    const runId = path.replace("/api/run/", "").replace("/status", "");
    const active = activeRuns.get(runId);
    if (active) {
        sendJSON(res, 200, {
            run_id: runId,
            status: active.status,
            error: active.error ?? null,
            request: active.request ?? null,
            bundle_id: active.bundle?.bundle_id ?? null,
            bundle_ids: active.bundles?.map((bundle) => bundle.bundle_id) ?? (active.bundle ? [active.bundle.bundle_id] : []),
            aggregate: active.aggregate ?? null,
        });
        return;
    }
    const stored = getBundleById(runId);
    if (stored) {
        sendJSON(res, 200, {
            run_id: runId,
            status: "complete",
            error: null,
            request: {
                task: stored.task.id,
                adapter: stored.agent.adapter,
                provider: stored.agent.provider,
                model: stored.agent.model,
                count: 1,
                judge: stored.judge ?? DETERMINISTIC_JUDGE_METADATA,
            },
            bundle_id: stored.bundle_id,
            bundle_ids: [stored.bundle_id],
            aggregate: summarizeRunSet([stored]),
        });
        return;
    }
    sendJSON(res, 404, { error: "Run not found" });
}
export async function handleRunPost(req, res) {
    if (!requireAuth(req, res))
        return;
    gcActiveRuns();
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { error: parsed.error });
        return;
    }
    const v = validateRunRequest(parsed.value);
    if (!v.ok) {
        sendJSON(res, 400, { error: "Invalid run request", details: v.errors });
        return;
    }
    const body = v.value;
    const adapterId = body.adapter;
    const requestedCount = body.count;
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
    const runId = `run_${Date.now().toString(36)}`;
    activeRuns.set(runId, {
        id: runId,
        status: "running",
        events: [],
        request: {
            task: body.task,
            adapter: adapterId,
            provider: body.provider ?? null,
            model: body.model,
            count: requestedCount,
            judge: DETERMINISTIC_JUDGE_METADATA,
        },
    });
    sendJSON(res, 202, { ok: true, run_id: runId, judge: DETERMINISTIC_JUDGE_METADATA });
    void (async () => {
        try {
            const healthAdapter = await instantiateAdapterForRun({
                adapter: adapterId,
                model: body.model,
                provider: body.provider ?? null,
            });
            const health = await healthAdapter.adapter.healthCheck();
            if (!health.ok)
                throw new Error(health.reason ?? `${adapterId} unavailable`);
            await healthAdapter.adapter.teardown();
            broadcastSSE(runId, "step", {
                type: "task_start",
                detail: `Target ${body.task} via ${adapterId}/${body.model} (${requestedCount} run${requestedCount === 1 ? "" : "s"})`,
            });
            const completedBundles = [];
            for (let index = 0; index < requestedCount; index += 1) {
                const adapterInstance = await instantiateAdapterForRun({
                    adapter: adapterId,
                    model: body.model,
                    provider: body.provider ?? null,
                });
                try {
                    broadcastSSE(runId, "step", { type: "task_start", detail: `Run ${index + 1}/${requestedCount} executing` });
                    const result = await runTask({
                        taskId: body.task,
                        adapter: adapterInstance.adapter,
                        model: body.model,
                        keepWorkspace: false,
                        reviewConfig,
                    });
                    storeBundle(result.bundle);
                    completedBundles.push(result.bundle);
                }
                catch (runErr) {
                    broadcastSSE(runId, "step", {
                        type: "task_error",
                        detail: `Run ${index + 1}/${requestedCount} failed: ${String(runErr).slice(0, 200)}`,
                    });
                }
                finally {
                    await adapterInstance.adapter.teardown();
                }
            }
            if (completedBundles.length === 0) {
                throw new Error(`All ${requestedCount} run(s) failed — no results produced`);
            }
            const latestBundle = completedBundles[completedBundles.length - 1];
            const aggregate = summarizeRunSet(completedBundles);
            const active = activeRuns.get(runId);
            if (active) {
                active.status = "complete";
                active.bundle = latestBundle;
                active.bundles = completedBundles;
                active.aggregate = aggregate;
            }
            broadcastSSE(runId, "complete", {
                bundle_id: latestBundle.bundle_id,
                bundle_ids: completedBundles.map((bundle) => bundle.bundle_id),
                score: latestBundle.score,
                pass: latestBundle.score.pass,
                judge: latestBundle.judge,
                review: latestBundle.review,
                aggregate,
                target: {
                    adapter: latestBundle.agent.adapter,
                    provider: latestBundle.agent.provider,
                    model: latestBundle.agent.model,
                },
            });
        }
        catch (err) {
            const active = activeRuns.get(runId);
            if (active) {
                active.status = "error";
                active.error = String(err);
            }
            broadcastSSE(runId, "error", { error: String(err) });
        }
        finally {
            const clients = sseClients.get(runId) ?? [];
            for (const client of clients) {
                try {
                    client.end();
                }
                catch { /* ignore */ }
            }
            sseClients.delete(runId);
            markRunSettled(runId);
        }
    })();
}
export async function handleRunLive(req, res, path) {
    const runId = path.replace("/api/run/", "").replace("/live", "");
    res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
    });
    const run = activeRuns.get(runId);
    if (run) {
        for (const evt of run.events)
            res.write(evt);
        // Both "complete" and "error" are terminal states — replay cached events and
        // close the stream. Previously only "complete" closed, which meant late
        // clients connecting to a failed run held the socket open forever.
        if (run.status === "complete" || run.status === "error") {
            res.end();
            return;
        }
    }
    if (!sseClients.has(runId))
        sseClients.set(runId, []);
    sseClients.get(runId).push(res);
    req.on("close", () => {
        const clients = sseClients.get(runId);
        if (!clients)
            return;
        const idx = clients.indexOf(res);
        if (idx >= 0)
            clients.splice(idx, 1);
    });
}
export async function handleCrucibleLink(req, res, path) {
    if (!requireAuth(req, res))
        return;
    const id = path.slice("/api/runs/".length, -"/crucible-link".length);
    // Defense in depth: even though the ID must resolve to a real bundle on disk,
    // never write a file at a path derived from unsanitized user input.
    if (!isSafeId(id)) {
        sendJSON(res, 400, { error: "Invalid run id" });
        return;
    }
    const bundle = getBundleById(id);
    if (!bundle) {
        sendJSON(res, 404, { error: "Run not found" });
        return;
    }
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { error: parsed.error });
        return;
    }
    const v = validateCrucibleLinkRequest(parsed.value);
    if (!v.ok) {
        sendJSON(res, 400, { error: "Invalid crucible link", details: v.errors });
        return;
    }
    const link = v.value;
    // Use the resolved bundle's canonical id, not the raw path segment, for the filename.
    writeCrucibleLink(bundle.bundle_id, link);
    sendJSON(res, 200, { ok: true, link });
}
//# sourceMappingURL=run.js.map