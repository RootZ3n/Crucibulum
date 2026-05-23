/**
 * Crucible — Run Routes
 * Single task execution, run queries, SSE streaming.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJSON, readBody, parseJsonBody, isSafeId, loadBundles, getBundleById, getBundleByRunId, filterBundlesByTaskFamilies, resolveLaneScope, bundleSummary, getStats, log, canonicalPercent } from "./shared.js";
import { generateRunId as mintRunId } from "../../core/identity.js";
import { validateRunRequest, validateCrucibleLinkRequest } from "../validators.js";
import type { EvidenceBundle } from "../../adapters/base.js";
import { instantiateAdapterForRun } from "../../adapters/registry.js";
import { runTask } from "../../core/runner.js";
import { storeBundle, buildPreExecutionFailureBundle } from "../../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { summarizeRunSet, type CrucibleLink } from "../contracts.js";
import { writeCrucibleLink } from "../validation-links.js";
import { isConversationalTask } from "../../core/conversational-runner.js";
import { normalizeBundleVerdict } from "../../core/verdict.js";
import { presentBundleVerdict } from "../../core/verdict-policy.js";
import type { StructuredProviderError } from "../../types/provider-error.js";
import { providerErrorDetail } from "../../core/provider-errors.js";
import { resolveByModelIdWithHint } from "../../core/provider-registry.js";

interface ActiveRun {
  id: string;
  status: "running" | "complete" | "error";
  events: string[];
  bundle?: EvidenceBundle | undefined;
  bundles?: EvidenceBundle[] | undefined;
  aggregate?: ReturnType<typeof summarizeRunSet> | undefined;
  error?: string | undefined;
  provider_error?: StructuredProviderError | undefined;
  request?: {
    task: string;
    adapter: string;
    provider: string | null;
    model: string;
    requested_adapter?: string | undefined;
    requested_provider?: string | null | undefined;
    requested_model?: string | undefined;
    routing_note?: string | null | undefined;
    resolved_by_registry?: boolean | undefined;
    count: number;
    judge: typeof DETERMINISTIC_JUDGE_METADATA;
  } | undefined;
  failure_stage?: "preflight" | "adapter_init" | "health_check" | "execution" | "unknown" | undefined;
}

export const activeRuns = new Map<string, ActiveRun>();
export const sseClients = new Map<string, ServerResponse[]>();
const RUN_COMPLETED_AT = new Map<string, number>();
// Keep completed in-memory entries for 10 minutes so clients can still poll /status, then evict.
// Persistent bundles remain on disk and accessible via getBundleById regardless.
const RUN_RETENTION_MS = 10 * 60 * 1000;
// Hard cap so a flood of runs cannot exhaust heap.
const MAX_ACTIVE_RUNS = 256;

/**
 * Mint a unique run id for this dispatch. The check against `activeRuns`
 * is the belt; the random suffix in `mintRunId` is the suspenders. See
 * core/identity.ts for the collision-avoidance argument.
 */
function generateRunId(): string {
  return mintRunId((id) => activeRuns.has(id));
}

export interface DispatchTarget {
  adapter: string;
  provider: string | null;
  model: string;
  requested_adapter: string;
  requested_provider: string | null;
  requested_model: string;
  resolved_by_registry: boolean;
  routing_note: string | null;
}

export function resolveRequestedDispatch(adapter: string, provider: string | null, model: string): DispatchTarget {
  const resolved = resolveByModelIdWithHint(model, provider);
  if (!resolved) {
    return {
      adapter,
      provider,
      model,
      requested_adapter: adapter,
      requested_provider: provider,
      requested_model: model,
      resolved_by_registry: false,
      routing_note: null,
    };
  }
  const target = {
    adapter: resolved.adapter,
    provider: resolved.presetId,
    model: resolved.model,
  };
  const changed = target.adapter !== adapter || target.provider !== provider || target.model !== model;
  return {
    ...target,
    requested_adapter: adapter,
    requested_provider: provider,
    requested_model: model,
    resolved_by_registry: true,
    routing_note: changed
      ? `Resolved registered model ${model} from requested ${adapter}/${provider ?? "none"} to ${target.adapter}/${target.provider}.`
      : `Resolved registered model ${model} for ${target.adapter}/${target.provider}.`,
  };
}

export function markRunSettled(runId: string): void {
  RUN_COMPLETED_AT.set(runId, Date.now());
}

function gcActiveRuns(): void {
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
      const entry = sorted.shift()!;
      activeRuns.delete(entry[0]);
      RUN_COMPLETED_AT.delete(entry[0]);
    }
  }
}

export function broadcastSSE(runId: string, event: string, data: unknown): void {
  const clients = sseClients.get(runId) ?? [];
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  let delivered = 0;
  for (const res of clients) {
    try { res.write(msg); delivered++; } catch { /* ignore */ }
  }
  const run = activeRuns.get(runId);
  if (run) run.events.push(msg);
  log("info", "sse", `broadcast ${event} runId=${runId} clients=${clients.length} delivered=${delivered}`);
}

export async function handleRunsList(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const scope = resolveLaneScope(url);
  const allBundles = loadBundles();
  const bundles = filterBundlesByTaskFamilies(allBundles, scope.taskFamilies);
  bundles.sort((a, b) => new Date(b.environment.timestamp_start).getTime() - new Date(a.environment.timestamp_start).getTime());
  const runs = bundles.map((bundle) => {
    const summary = bundleSummary(bundle, allBundles);
    const verdict = normalizeBundleVerdict(bundle);
    const verdictPresentation = presentBundleVerdict(bundle, verdict);
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
      verdict,
      verdict_presentation: verdictPresentation,
      pass_threshold: canonicalPercent(bundle.score.pass_threshold),
      integrity_violations: bundle.score.integrity_violations,
      breakdown: {
        correctness: canonicalPercent(bundle.score.breakdown.correctness),
        regression: canonicalPercent(bundle.score.breakdown.regression),
        integrity: canonicalPercent(bundle.score.breakdown.integrity),
        efficiency: canonicalPercent(bundle.score.breakdown.efficiency),
      },
      failure_taxonomy: summary.outcome.failure_taxonomy,
      poison_evaluation: summary.outcome.poison_evaluation,
      benchmark_evaluation: summary.outcome.benchmark_evaluation,
      build_evaluation: summary.outcome.build_evaluation,
      safety_evaluation: summary.outcome.safety_evaluation,
      memory_evaluation: summary.outcome.memory_evaluation,
      personality_evaluation: summary.outcome.personality_evaluation,
      timestamp: bundle.environment.timestamp_start,
      duration_sec: summary.timing.duration_sec,
      tokens_in: bundle.usage.tokens_in,
      tokens_out: bundle.usage.tokens_out,
      cost_usd: bundle.usage.estimated_cost_usd,
      // Separate-channel cost transparency: judge_usage is the model judge's
      // spend (zero for deterministic-only runs). Frontend renders it in its
      // own row so the operator never confuses tested-model cost with judge
      // cost. Falls back to a deterministic stub when the bundle predates the
      // field.
      judge_usage: bundle.judge_usage ?? {
        provider: "",
        model: "",
        tokens_in: 0,
        tokens_out: 0,
        estimated_cost_usd: 0,
        kind: "deterministic" as const,
        note: "deterministic judge — no model cost",
      },
      total_tokens: bundle.usage.tokens_in + bundle.usage.tokens_out + (bundle.judge_usage?.tokens_in ?? 0) + (bundle.judge_usage?.tokens_out ?? 0),
      total_cost_usd: bundle.usage.estimated_cost_usd + (bundle.judge_usage?.estimated_cost_usd ?? 0),
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
  sendJSON(res, 200, { runs, task_families: scope.taskFamilies, scope_key: scope.scopeKey });
}

export async function handleRunSummary(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const id = path.replace("/api/runs/", "").replace("/summary", "");
  // /api/runs/<id> accepts either the bundle_id (filename slug) or the
  // server-issued run_id from POST /api/run. The UI threads the latter
  // through `watchRunCompletion` → `hydrateFocusedRun`, so the run_id path
  // is the live one in production. Falling through to getBundleByRunId is
  // what makes evidence hydration work after the bundle_id changed shape
  // to include a random suffix.
  const bundle = getBundleById(id) ?? getBundleByRunId(id);
  if (!bundle) {
    sendJSON(res, 404, { error: "Run not found" });
    return;
  }
  const bundles = loadBundles();
  sendJSON(res, 200, { summary: bundleSummary(bundle, bundles) });
}

export async function handleRunGet(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const id = path.replace("/api/runs/", "");
  const bundle = getBundleById(id) ?? getBundleByRunId(id);
  if (!bundle) {
    // 404 the lookup — but distinguish "never existed" from "evidence was
    // removed by retention". The active-run map records every run id the
    // server has handed out (within the retention window for in-memory
    // entries). If the id appears there but no bundle is on disk, the
    // operator should see "evidence removed by retention" instead of a
    // generic miss — which previously got UI-collapsed into "Run stream
    // interrupted".
    const known = activeRuns.has(id);
    sendJSON(res, 404, known
      ? { error: "Evidence removed by retention", reason: "The bundle for this run is no longer on disk. Check retention settings or re-run.", run_id: id }
      : { error: "Run not found" });
    return;
  }
  const bundles = loadBundles();
  sendJSON(res, 200, { bundle, summary: bundleSummary(bundle, bundles) });
}

export async function handleStats(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const scope = resolveLaneScope(url);
  const bundles = filterBundlesByTaskFamilies(loadBundles(), scope.taskFamilies);
  sendJSON(res, 200, { ...getStats(bundles), task_families: scope.taskFamilies, scope_key: scope.scopeKey });
}

export async function handleReceipts(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const scope = resolveLaneScope(url);
  const bundles = filterBundlesByTaskFamilies(loadBundles(), scope.taskFamilies);
  bundles.sort((a, b) => new Date(b.environment.timestamp_start).getTime() - new Date(a.environment.timestamp_start).getTime());
  const receipts = bundles.map((bundle) => {
    const verdict = normalizeBundleVerdict(bundle);
    return {
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
      judge_usage: bundle.judge_usage ?? {
        provider: "",
        model: "",
        tokens_in: 0,
        tokens_out: 0,
        estimated_cost_usd: 0,
        kind: "deterministic" as const,
        note: "deterministic judge — no model cost",
      },
      total_cost_usd: bundle.usage.estimated_cost_usd + (bundle.judge_usage?.estimated_cost_usd ?? 0),
      total_tokens: bundle.usage.tokens_in + bundle.usage.tokens_out + (bundle.judge_usage?.tokens_in ?? 0) + (bundle.judge_usage?.tokens_out ?? 0),
      duration_ms: new Date(bundle.environment.timestamp_end).getTime() - new Date(bundle.environment.timestamp_start).getTime(),
      pass: bundle.score.pass,
      score: canonicalPercent(bundle.score.total),
      verdict,
      verdict_presentation: presentBundleVerdict(bundle, verdict),
      poison_evaluation: bundle.poison_evaluation ?? null,
      benchmark_evaluation: bundle.benchmark_evaluation ?? null,
      build_evaluation: bundle.build_evaluation ?? null,
      safety_evaluation: bundle.safety_evaluation ?? null,
      memory_evaluation: bundle.memory_evaluation ?? null,
      personality_evaluation: bundle.personality_evaluation ?? null,
      timestamp: bundle.environment.timestamp_start,
    };
  });
  const totalCost = receipts.reduce((sum, receipt) => sum + receipt.cost_usd, 0);
  const totalJudgeCost = receipts.reduce((sum, receipt) => sum + (receipt.judge_usage?.estimated_cost_usd ?? 0), 0);
  const totalTokens = receipts.reduce((sum, receipt) => sum + receipt.tokens_in + receipt.tokens_out, 0);
  const totalJudgeTokens = receipts.reduce((sum, receipt) => sum + (receipt.judge_usage?.tokens_in ?? 0) + (receipt.judge_usage?.tokens_out ?? 0), 0);
  sendJSON(res, 200, {
    receipts,
    summary: {
      total_runs: receipts.length,
      // Tested model spend, kept separate from the judge spend below so the
      // UI can render two distinct lines instead of one ambiguous total.
      total_model_cost_usd: totalCost,
      total_judge_cost_usd: totalJudgeCost,
      total_cost_usd: totalCost + totalJudgeCost,
      total_model_tokens: totalTokens,
      total_judge_tokens: totalJudgeTokens,
      total_tokens: totalTokens + totalJudgeTokens,
      judge: DETERMINISTIC_JUDGE_METADATA,
    },
    task_families: scope.taskFamilies,
    scope_key: scope.scopeKey,
  });
}

export async function handleCompare(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const taskId = url.searchParams.get("task") ?? "";
  const suiteId = url.searchParams.get("suite") ?? "v1";
  const scope = resolveLaneScope(url);
  const bundles = filterBundlesByTaskFamilies(loadBundles(), scope.taskFamilies);
  const filtered = taskId ? bundles.filter((bundle) => bundle.task.id === taskId) : bundles;
  const groups = new Map<string, EvidenceBundle[]>();
  for (const bundle of filtered) {
    const key = JSON.stringify([bundle.agent.adapter, bundle.agent.provider, bundle.agent.model]);
    const group = groups.get(key) ?? [];
    group.push(bundle);
    groups.set(key, group);
  }
  const comparisons = Array.from(groups.entries()).map(([key, group]) => {
    const [adapter, provider, model] = JSON.parse(key) as [string, string, string];
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
  sendJSON(res, 200, { comparisons, task_id: taskId || null, suite_id: suiteId, task_families: scope.taskFamilies, scope_key: scope.scopeKey });
}

export async function handleRunStatus(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  const runId = path.replace("/api/run/", "").replace("/status", "");
  const active = activeRuns.get(runId);
  if (active) {
    sendJSON(res, 200, {
      run_id: runId,
      status: active.status,
      error: active.error ?? null,
      provider_error: active.provider_error ?? null,
      failure_stage: active.failure_stage ?? null,
      request: active.request ?? null,
      bundle_id: active.bundle?.bundle_id ?? null,
      bundle_ids: active.bundles?.map((bundle) => bundle.bundle_id) ?? (active.bundle ? [active.bundle.bundle_id] : []),
      aggregate: active.aggregate ?? null,
    });
    return;
  }
  // After my previous fix, bundle_id carries a random suffix and is no
  // longer derivable from runId. The bundle records `run_id` directly —
  // try that lookup too so /status keeps working after activeRuns has
  // GC'd the in-memory entry. Without this, the UI's polling fallback
  // sees a 404, falls into its catch() branch, and reports the catch-all
  // "Run stream interrupted" string for a run whose bundle is actually
  // sitting on disk.
  const stored = getBundleById(runId) ?? getBundleByRunId(runId);
  if (stored) {
    sendJSON(res, 200, {
      run_id: runId,
      status: "complete",
      error: null,
      failure_stage: null,
      request: {
        task: stored.task.id,
        adapter: stored.agent.adapter,
        provider: stored.agent.provider,
        model: stored.agent.model,
        requested_adapter: stored.agent.adapter,
        requested_provider: stored.agent.provider,
        requested_model: stored.agent.model,
        routing_note: null,
        resolved_by_registry: false,
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

export async function handleRunPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  gcActiveRuns();
  const parsed = await parseJsonBody<unknown>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const v = validateRunRequest(parsed.value);
  if (!v.ok) { sendJSON(res, 400, { error: "Invalid run request", details: v.errors }); return; }
  const body = v.value;
  const dispatch = resolveRequestedDispatch(body.adapter, body.provider ?? null, body.model);
  const adapterId = dispatch.adapter;
  const requestedCount = body.count;

  // Preflight: a conversational task requires the adapter to implement chat().
  // Rejecting here stops the UI from silently reporting "completed" for a task
  // that was never actually executed (no bundle stored) — the bug that let
  // spec-only runs masquerade as broad coverage.
  const taskIsConversational = (() => {
    try { return isConversationalTask(body.task); } catch { return false; }
  })();
  if (taskIsConversational) {
    let probe;
    try {
      probe = await instantiateAdapterForRun({
        adapter: adapterId,
        model: dispatch.model,
        provider: dispatch.provider,
      });
    } catch (err) {
      sendJSON(res, 400, { error: `Adapter ${adapterId} unavailable: ${String(err).slice(0, 160)}` });
      return;
    }
    const capable = typeof probe.adapter.chat === "function" && probe.adapter.supportsChat();
    try { await probe.adapter.teardown(); } catch { /* ignore */ }
    if (!capable) {
      sendJSON(res, 422, {
        error: "adapter_cannot_run_task",
        reason: `Task ${body.task} is conversational (requires chat()), but adapter ${adapterId} does not support chat. Pick a chat-capable model or a repo-based task.`,
        task: body.task,
        adapter: adapterId,
        model: dispatch.model,
        task_kind: "conversational",
        adapter_supports_chat: false,
      });
      return;
    }
  }

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

  const runId = generateRunId();
  // Structured lifecycle log — emitted at every transition so a "later tests
  // fail instantly" pattern leaves an audit trail. The fields match the
  // operator-facing report exactly: task id, run id, status before start,
  // active-run slot count, and (later, in the IIFE) cleanup entry/exit.
  log("info", "run-lifecycle", `start runId=${runId} task=${body.task} adapter=${adapterId} model=${dispatch.model} active=${activeRuns.size}+1 sseSlots=${sseClients.size} preflightConv=${taskIsConversational}`);
  activeRuns.set(runId, {
    id: runId,
    status: "running",
    events: [],
    request: {
      task: body.task,
      adapter: adapterId,
      provider: dispatch.provider,
      model: dispatch.model,
      requested_adapter: dispatch.requested_adapter,
      requested_provider: dispatch.requested_provider,
      requested_model: dispatch.requested_model,
      routing_note: dispatch.routing_note,
      resolved_by_registry: dispatch.resolved_by_registry,
      count: requestedCount,
      judge: DETERMINISTIC_JUDGE_METADATA,
    },
  });

  sendJSON(res, 202, {
    ok: true,
    run_id: runId,
    judge: DETERMINISTIC_JUDGE_METADATA,
    requested_target: {
      adapter: dispatch.requested_adapter,
      provider: dispatch.requested_provider,
      model: dispatch.requested_model,
    },
    target: {
      adapter: adapterId,
      provider: dispatch.provider,
      model: dispatch.model,
    },
    resolved_by_registry: dispatch.resolved_by_registry,
    routing_note: dispatch.routing_note,
  });

  void (async () => {
    let failureStage: ActiveRun["failure_stage"] = "unknown";
    let failureReason = "";
    let failureProviderError: StructuredProviderError | null = null;
    try {
      let healthAdapter;
      try {
        healthAdapter = await instantiateAdapterForRun({
          adapter: adapterId,
          model: dispatch.model,
          provider: dispatch.provider,
        });
      } catch (err) {
        failureStage = "adapter_init";
        failureReason = `Adapter init failed: ${String(err).slice(0, 200)}`;
        throw err;
      }
      const health = await healthAdapter.adapter.healthCheck();
      if (!health.ok) {
        failureStage = "health_check";
        failureProviderError = health.providerError ?? null;
        // Prefer a reason that carries both the bucket ("Invalid provider
        // payload") AND the raw detail ("MiniMax error 2049: invalid api
        // key") — adapters stash the root cause in rawMessage but return
        // only the generic summary as `reason`. Without merging, the
        // operator sees a vague "Invalid provider payload" on every run and
        // can't tell a bad API key from a wrong model id.
        failureReason = failureProviderError
          ? providerErrorDetail(failureProviderError)
          : (health.reason ?? `${adapterId} unavailable`);
        throw Object.assign(new Error(failureReason), { stage: failureStage, providerError: failureProviderError });
      }
      await healthAdapter.adapter.teardown();

      broadcastSSE(runId, "step", {
        type: "task_start",
        detail: `Target ${body.task} via ${adapterId}/${dispatch.model} (${requestedCount} run${requestedCount === 1 ? "" : "s"})${dispatch.routing_note ? ` — ${dispatch.routing_note}` : ""}`,
      });

      const completedBundles: EvidenceBundle[] = [];
      for (let index = 0; index < requestedCount; index += 1) {
        const adapterInstance = await instantiateAdapterForRun({
          adapter: adapterId,
          model: dispatch.model,
          provider: dispatch.provider,
        });
        try {
          broadcastSSE(runId, "step", { type: "task_start", detail: `Run ${index + 1}/${requestedCount} executing` });
          const result = await runTask({
            taskId: body.task,
            adapter: adapterInstance.adapter,
            model: dispatch.model,
            keepWorkspace: false,
            reviewConfig,
            runId,
            // Per-question progress → SSE 'step' frames. Without this, a
            // 10-question conversational task (role-stress-001) sits silent
            // for the duration of every model call. The heartbeat keeps the
            // socket alive at the transport layer; this keeps the user-
            // visible run panel ticking and proves the run is making
            // forward progress.
            onProgress: (event) => {
              broadcastSSE(runId, "step", {
                type: event.kind === "question_start" ? "task_start" : "task_complete",
                detail: event.kind === "question_start"
                  ? `Question ${event.index + 1}/${event.total} (${event.question_id}) sending`
                  : `Question ${event.index + 1}/${event.total} (${event.question_id}) ${event.passed ? "PASS" : "FAIL"}`,
              });
            },
          });
          storeBundle(result.bundle);
          completedBundles.push(result.bundle);
        } catch (runErr) {
          failureStage = "execution";
          failureReason = `Run ${index + 1}/${requestedCount} failed: ${String(runErr).slice(0, 200)}`;
          broadcastSSE(runId, "step", {
            type: "task_error",
            detail: failureReason,
            stage: "execution",
          });
        } finally {
          await adapterInstance.adapter.teardown();
        }
      }

      if (completedBundles.length === 0) {
        if (!failureReason) {
          failureStage = "execution";
          failureReason = `All ${requestedCount} run(s) failed — no results produced`;
        }
        throw Object.assign(new Error(failureReason), { stage: failureStage });
      }
      const latestBundle = completedBundles[completedBundles.length - 1]!;
      const aggregate = summarizeRunSet(completedBundles);
      // Identity-check the entry before mutating. `activeRuns.get(runId)` can
      // return a different run's state if id generation ever collides — the
      // primary fix is `generateRunId`'s random suffix, this is the belt that
      // prevents poisoned cross-run state if anything ever slips past it.
      const active = activeRuns.get(runId);
      if (active && active.id === runId) {
        // Populate result fields but DELAY the status flip until after
        // broadcastSSE has pushed the 'complete' event into run.events.
        // Otherwise /live's fast-path (`run.status === "complete"` → write
        // cached events + res.end()) can fire between the status flip and
        // broadcastSSE, leaving the client with only step events and no
        // 'complete'. The EventSource then fires an error event with no
        // parseable data, and the run looks like "could_not_start" even
        // though the bundle is already on disk.
        active.bundle = latestBundle;
        active.bundles = completedBundles;
        active.aggregate = aggregate;
      }
      broadcastSSE(runId, "complete", {
        run_id: runId,
        bundle_id: latestBundle.bundle_id,
        bundle_ids: completedBundles.map((bundle) => bundle.bundle_id),
        score: latestBundle.score,
        pass: latestBundle.score.pass,
        verdict: normalizeBundleVerdict(latestBundle),
        verdict_presentation: presentBundleVerdict(latestBundle, normalizeBundleVerdict(latestBundle)),
        judge: latestBundle.judge,
        review: latestBundle.review,
        aggregate,
        target: {
          adapter: latestBundle.agent.adapter,
          provider: latestBundle.agent.provider,
          model: latestBundle.agent.model,
        },
        requested_target: {
          adapter: dispatch.requested_adapter,
          provider: dispatch.requested_provider,
          model: dispatch.requested_model,
        },
        resolved_by_registry: dispatch.resolved_by_registry,
        routing_note: dispatch.routing_note,
      });
      if (active && active.id === runId) active.status = "complete";
    } catch (err) {
      const stage = (typeof err === "object" && err && "stage" in err ? (err as { stage?: ActiveRun["failure_stage"] }).stage : failureStage) ?? "unknown";
      const message = failureReason || String(err);
      const providerError =
        (typeof err === "object" && err && "providerError" in err ? (err as { providerError?: StructuredProviderError | null }).providerError : null)
        ?? failureProviderError;
      const classification = stage === "execution" ? "failed" : stage === "preflight" ? "skipped_by_preflight" : "could_not_start";
      // Same identity guard as the success path — never mutate another run's
      // active entry on the strength of a colliding id.
      const active = activeRuns.get(runId);
      if (active && active.id === runId) {
        // Same ordering rule as the success path: flip status AFTER
        // broadcastSSE so /live's fast-path always sees the terminal
        // event in run.events.
        active.error = message;
        active.provider_error = providerError ?? undefined;
        active.failure_stage = stage;
      }
      // Persist a minimal failure receipt so /api/runs/<runId> can hydrate
      // the failure after activeRuns GC. Without this, the UI sees a 404
      // on the bundle and falls back to "Run state unreachable" — even
      // though the SSE error frame carried the structured cause.
      // Only persist when nothing else stored a bundle for this run (the
      // execution path's success leg already writes the real one).
      if (stage !== "execution" || !active?.bundle) {
        try {
          const failureBundle = buildPreExecutionFailureBundle({
            runId,
            taskId: body.task,
            adapterId,
            provider: dispatch.provider,
            model: dispatch.model,
            stage,
            classification,
            reason: message,
            providerError: providerError ?? null,
            startTime: new Date().toISOString(),
            endTime: new Date().toISOString(),
          });
          storeBundle(failureBundle);
          log("info", "api", `pre-execution failure receipt stored for ${runId} (bundle_id=${failureBundle.bundle_id} stage=${stage})`);
          if (active && active.id === runId) active.bundle = failureBundle;
        } catch (bundleErr) {
          // Receipt-write failure is non-fatal — the SSE error already
          // surfaced the real cause. Log loudly so we notice in CI.
          log("warn", "api", `Failed to persist pre-execution failure receipt for ${runId}: ${String(bundleErr).slice(0, 200)}`);
        }
      }
      broadcastSSE(runId, "error", { error: message, reason: message, provider_error: providerError, stage, classification });
      if (active && active.id === runId) active.status = "error";
    } finally {
      // Lifecycle log: cleanup-entered. Captures slot counts BEFORE we
      // release this run's resources, so an operator can spot a leak ("slots
      // grew but never shrunk").
      const beforeSseSlots = sseClients.get(runId)?.length ?? 0;
      log("info", "run-lifecycle", `cleanup-enter runId=${runId} sseClients=${beforeSseSlots} activeRunsSize=${activeRuns.size}`);
      const clients = sseClients.get(runId) ?? [];
      for (const client of clients) {
        try { client.end(); } catch { /* ignore */ }
      }
      sseClients.delete(runId);
      markRunSettled(runId);
      const final = activeRuns.get(runId);
      log("info", "run-lifecycle", `cleanup-exit  runId=${runId} finalStatus=${final?.status ?? "missing"} activeRunsSize=${activeRuns.size} sseSlots=${sseClients.size}`);
    }
  })();
}

/**
 * SSE heartbeat interval. Conversational tasks with many questions can sit
 * idle for tens of seconds between server-emitted events (one model call per
 * question = a long quiet stretch in between). Without a heartbeat,
 * intermediaries (browser idle timers, reverse proxies, NAT) drop the
 * connection and the client's EventSource fires an `error` event with no
 * parseable data — the UI reports it as "Run stream interrupted — no
 * evidence bundle produced", which is wrong: the run is still in flight on
 * the server, just quiet.
 *
 * 10 seconds is well under every common intermediary's idle ceiling
 * (typically 30-60s) and small enough to keep the cost negligible.
 */
const SSE_HEARTBEAT_MS = 10_000;

export async function handleRunLive(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
  // SSE stream — auth guard is in app.ts (top-level route handler enforces
  // token or session before routing here). No additional check needed.
  const runId = path.replace("/api/run/", "").replace("/live", "");
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
  const run = activeRuns.get(runId);
  if (run) {
    const eventNames = run.events.map((evt) => {
      const m = evt.match(/^event:\s*(\S+)/);
      return m ? m[1] : "?";
    }).join(",");
    log("info", "sse", `live-open runId=${runId} status=${run.status} cached=[${eventNames}]`);
    for (const evt of run.events) res.write(evt);
    // Both "complete" and "error" are terminal states — replay cached events and
    // close the stream. Previously only "complete" closed, which meant late
    // clients connecting to a failed run held the socket open forever.
    if (run.status === "complete" || run.status === "error") {
      res.end();
      return;
    }
  } else {
    log("warn", "sse", `live-open runId=${runId} NOT in activeRuns`);
  }
  if (!sseClients.has(runId)) sseClients.set(runId, []);
  sseClients.get(runId)!.push(res);

  // Heartbeat: an SSE comment line keeps the socket alive without the client
  // having to do anything special — EventSource silently swallows comment
  // lines (lines starting with `:`). Stop the timer when the request closes
  // OR when the response ends naturally (terminal frame writes res.end()).
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); }
    catch { clearInterval(heartbeat); }
  }, SSE_HEARTBEAT_MS);
  // Don't keep the event loop alive solely for heartbeats; the runner's
  // async work is what should hold the process open.
  heartbeat.unref();
  res.on("close", () => clearInterval(heartbeat));

  req.on("close", () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(runId);
    if (!clients) return;
    const idx = clients.indexOf(res);
    if (idx >= 0) clients.splice(idx, 1);
  });
}

export async function handleCrucibleLink(req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
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
  const parsed = await parseJsonBody<unknown>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const v = validateCrucibleLinkRequest(parsed.value);
  if (!v.ok) { sendJSON(res, 400, { error: "Invalid crucible link", details: v.errors }); return; }
  const link: CrucibleLink = v.value;
  // Use the resolved bundle's canonical id, not the raw path segment, for the filename.
  writeCrucibleLink(bundle.bundle_id, link);
  sendJSON(res, 200, { ok: true, link });
}
