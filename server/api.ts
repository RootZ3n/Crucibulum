/**
 * Crucibulum — API Server
 * Serves the web UI and structured evaluation APIs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { EvidenceBundle } from "../adapters/base.js";
import { instantiateAdapterForRun, getAdapterCatalog, listFlattenedModels, getProviderCatalog } from "../adapters/registry.js";
import { loadManifest, listTasks } from "../core/manifest.js";
import { runTask } from "../core/runner.js";
import { storeBundle } from "../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../core/judge.js";
import { summarizeBundle, countRepeatRuns, getRelatedBundles, summarizeRunSet, type CrucibleLink } from "./contracts.js";
import { readCrucibleLink, writeCrucibleLink } from "./validation-links.js";
import { log } from "../utils/logger.js";
import { storeScores, queryScores, getLeaderboard } from "../core/score-store.js";
import type { ModelScore, ScoreFamily, ScoreSource } from "../types/scores.js";

const PORT = parseInt(process.env["CRUCIBULUM_PORT"] ?? "18795", 10);
const RUNS_DIR = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
const UI_PATH = join(import.meta.dirname, "..", "..", "ui", "index.html");

interface ActiveRun {
  id: string;
  status: "running" | "complete" | "error";
  events: string[];
  bundle?: EvidenceBundle | undefined;
  bundles?: EvidenceBundle[] | undefined;
  aggregate?: ReturnType<typeof summarizeRunSet> | undefined;
  error?: string | undefined;
  request?: {
    task: string;
    adapter: string;
    provider: string | null;
    model: string;
    count: number;
    judge: typeof DETERMINISTIC_JUDGE_METADATA;
  } | undefined;
}

const activeRuns = new Map<string, ActiveRun>();
const sseClients = new Map<string, ServerResponse[]>();

interface SuiteTaskResult {
  task_id: string;
  bundle_id: string;
  score: number;
  pass: boolean;
  duration_sec: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error?: string | undefined;
}

interface ActiveSuiteRun {
  id: string;
  status: "running" | "complete" | "error";
  total: number;
  completed: number;
  results: SuiteTaskResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    pass_rate: number;
    avg_score: number;
    total_time_sec: number;
    total_tokens: number;
    total_cost_usd: number;
  } | null;
  error?: string | undefined;
}

const activeSuiteRuns = new Map<string, ActiveSuiteRun>();

function broadcastSSE(runId: string, event: string, data: unknown): void {
  const clients = sseClients.get(runId) ?? [];
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch { /* ignore */ }
  }
  const run = activeRuns.get(runId);
  if (run) {
    run.events.push(msg);
  }
}

function sendJSON(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function loadBundles(): EvidenceBundle[] {
  try {
    const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
    return files.map((f) => {
      try {
        return JSON.parse(readFileSync(join(RUNS_DIR, f), "utf-8")) as EvidenceBundle;
      } catch {
        return null;
      }
    }).filter((bundle): bundle is EvidenceBundle => bundle !== null);
  } catch {
    return [];
  }
}

function getBundleById(id: string): EvidenceBundle | null {
  const filePath = join(RUNS_DIR, `${id}.json`);
  if (!existsSync(filePath)) {
    return null;
  }
  return JSON.parse(readFileSync(filePath, "utf-8")) as EvidenceBundle;
}

function getStats(bundles: EvidenceBundle[]): Record<string, unknown> {
  if (bundles.length === 0) {
    return { total_runs: 0, pass_rate: 0, avg_score: 0, avg_time_sec: 0, total_tokens: 0, total_cost_usd: 0 };
  }
  const passed = bundles.filter((b) => b.score.pass).length;
  const avgScore = bundles.reduce((s, b) => s + b.score.total, 0) / bundles.length;
  const avgTime = bundles.reduce((s, b) => {
    return s + (new Date(b.environment.timestamp_end).getTime() - new Date(b.environment.timestamp_start).getTime()) / 1000;
  }, 0) / bundles.length;
  const totalTokens = bundles.reduce((s, b) => s + b.usage.tokens_in + b.usage.tokens_out, 0);
  const totalCost = bundles.reduce((s, b) => s + b.usage.estimated_cost_usd, 0);
  return {
    total_runs: bundles.length,
    pass_rate: Math.round((passed / bundles.length) * 100),
    avg_score: Math.round(avgScore * 100),
    avg_time_sec: Math.round(avgTime),
    total_tokens: totalTokens,
    total_cost_usd: Math.round(totalCost * 10000) / 10000,
  };
}

function listTaskDetails(): Array<Record<string, unknown>> {
  return listTasks().map((task) => {
    const manifest = loadManifest(task.id);
    return {
      id: manifest.id,
      suite_id: "v1",
      family: manifest.family,
      title: manifest.task.title,
      difficulty: manifest.difficulty,
      time_limit_sec: manifest.constraints.time_limit_sec,
      max_steps: manifest.constraints.max_steps,
      network_allowed: manifest.constraints.network_allowed,
      public_tests_command: manifest.verification.public_tests_command,
      build_command: manifest.verification.build_command,
      diagnostic_purpose: manifest.metadata.diagnostic_purpose,
      tags: manifest.metadata.tags,
    };
  });
}

function listSuites(): Array<Record<string, unknown>> {
  const tasks = listTasks();
  const byFamily = new Map<string, number>();
  for (const task of tasks) {
    byFamily.set(task.family, (byFamily.get(task.family) ?? 0) + 1);
  }
  return [{
    id: "v1",
    label: "Crucibulum v1",
    task_count: tasks.length,
    families: Array.from(byFamily.entries()).map(([family, count]) => ({ family, count })),
  }];
}

function bundleSummary(bundle: EvidenceBundle, allBundles: EvidenceBundle[]): ReturnType<typeof summarizeBundle> {
  const relatedBundles = getRelatedBundles(allBundles, bundle);
  const repeats = countRepeatRuns(allBundles, bundle.task.id, bundle.agent.adapter, bundle.agent.model, bundle.agent.provider);
  return summarizeBundle(bundle, repeats, readCrucibleLink(bundle.bundle_id), relatedBundles);
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    if (path === "/" || path === "/index.html") {
      if (existsSync(UI_PATH)) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(readFileSync(UI_PATH, "utf-8"));
      } else {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<html><body><h1>Crucibulum</h1><p>UI not built yet.</p></body></html>");
      }
      return;
    }

    if (path === "/api/judge" && method === "GET") {
      sendJSON(res, 200, { judge: DETERMINISTIC_JUDGE_METADATA });
      return;
    }

    if (path === "/api/suites" && method === "GET") {
      sendJSON(res, 200, { suites: listSuites() });
      return;
    }

    if (path === "/api/tasks" && method === "GET") {
      sendJSON(res, 200, { tasks: listTaskDetails() });
      return;
    }

    if (path === "/api/adapters" && method === "GET") {
      const adapters = await getAdapterCatalog();
      sendJSON(res, 200, {
        adapters,
        judge: DETERMINISTIC_JUDGE_METADATA,
      });
      return;
    }

    if (path === "/api/models" && method === "GET") {
      const models = await listFlattenedModels();
      sendJSON(res, 200, { models });
      return;
    }

    if (path === "/api/providers" && method === "GET") {
      const catalog = await getProviderCatalog();
      sendJSON(res, 200, catalog);
      return;
    }

    if (path === "/api/runs" && method === "GET") {
      const bundles = loadBundles();
      bundles.sort((a, b) => new Date(b.environment.timestamp_start).getTime() - new Date(a.environment.timestamp_start).getTime());
      const runs = bundles.map((bundle) => {
        const summary = bundleSummary(bundle, bundles);
        return {
          bundle_id: bundle.bundle_id,
          bundle_hash: bundle.bundle_hash,
          task_id: bundle.task.id,
          family: bundle.task.family,
          difficulty: bundle.task.difficulty,
          model: bundle.agent.model,
          provider: bundle.agent.provider,
          adapter: bundle.agent.adapter,
          score: bundle.score.total,
          pass: bundle.score.pass,
          pass_threshold: bundle.score.pass_threshold,
          integrity_violations: bundle.score.integrity_violations,
          breakdown: bundle.score.breakdown,
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
      sendJSON(res, 200, { runs });
      return;
    }

    if (path.startsWith("/api/runs/") && path.endsWith("/summary") && method === "GET") {
      const id = path.replace("/api/runs/", "").replace("/summary", "");
      const bundle = getBundleById(id);
      if (!bundle) {
        sendJSON(res, 404, { error: "Run not found" });
        return;
      }
      const bundles = loadBundles();
      sendJSON(res, 200, { summary: bundleSummary(bundle, bundles) });
      return;
    }

    if (path.startsWith("/api/runs/") && !path.includes("/live") && method === "GET") {
      const id = path.replace("/api/runs/", "");
      const bundle = getBundleById(id);
      if (!bundle) {
        sendJSON(res, 404, { error: "Run not found" });
        return;
      }
      const bundles = loadBundles();
      sendJSON(res, 200, { bundle, summary: bundleSummary(bundle, bundles) });
      return;
    }

    if (path === "/api/stats" && method === "GET") {
      sendJSON(res, 200, getStats(loadBundles()));
      return;
    }

    if (path === "/api/receipts" && method === "GET") {
      const bundles = loadBundles();
      bundles.sort((a, b) => new Date(b.environment.timestamp_start).getTime() - new Date(a.environment.timestamp_start).getTime());
      const receipts = bundles.map((bundle) => ({
        run_id: bundle.bundle_id,
        task_id: bundle.task.id,
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
        score: bundle.score.total,
        timestamp: bundle.environment.timestamp_start,
      }));
      const totalCost = receipts.reduce((s, r) => s + r.cost_usd, 0);
      const totalTokens = receipts.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0);
      sendJSON(res, 200, {
        receipts,
        summary: {
          total_runs: receipts.length,
          total_cost_usd: totalCost,
          total_tokens: totalTokens,
          judge: DETERMINISTIC_JUDGE_METADATA,
        },
      });
      return;
    }

    if (path === "/api/compare" && method === "GET") {
      const taskId = url.searchParams.get("task") ?? "";
      const suiteId = url.searchParams.get("suite") ?? "v1";
      const bundles = loadBundles();
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
          pass_rate: Math.round(aggregate.pass_rate * 100),
          pass_at: aggregate.pass_at,
          avg_score: Math.round(aggregate.avg_score * 100),
          avg_cost_usd: aggregate.run_count ? Math.round((aggregate.total_cost_usd / aggregate.run_count) * 10000) / 10000 : 0,
          avg_duration_sec: aggregate.run_count ? Math.round(aggregate.total_time_sec / aggregate.run_count) : 0,
          qc_disagreement_rate: aggregate.qc_disagreement_rate,
          review_blocked_rate: aggregate.review_blocked_rate,
          reliability: aggregate.reliability,
        };
      }).sort((a, b) => b.avg_score - a.avg_score);
      sendJSON(res, 200, { comparisons, task_id: taskId || null, suite_id: suiteId });
      return;
    }

    if (path.startsWith("/api/run/") && path.endsWith("/status") && method === "GET") {
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
      return;
    }

    if (path === "/api/run" && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}") as {
        task: string;
        model: string;
        adapter?: string;
        provider?: string | null;
        providerId?: string;
        count?: number;
        secondOpinion?: { enabled?: boolean; provider?: string; model?: string };
        qcReview?: { enabled?: boolean; provider?: string; model?: string };
      };
      // Accept either adapter or providerId (provider-first flow sends providerId as the adapter key)
      const adapterId = body.adapter || body.providerId || "";
      if (!body.task || !body.model || !adapterId) {
        sendJSON(res, 400, { error: "task, model, and adapter (or providerId) are required" });
        return;
      }
      const requestedCount = Math.min(Math.max(Math.floor(body.count ?? 1), 1), 10);

      // Build review config from request
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

      sendJSON(res, 202, {
        ok: true,
        run_id: runId,
        judge: DETERMINISTIC_JUDGE_METADATA,
      });

      void (async () => {
        try {
          const healthAdapter = await instantiateAdapterForRun({
            adapter: adapterId,
            model: body.model,
            provider: body.provider ?? null,
          });
          const health = await healthAdapter.adapter.healthCheck();
          if (!health.ok) {
            throw new Error(health.reason ?? `${adapterId} unavailable`);
          }
          await healthAdapter.adapter.teardown();

          broadcastSSE(runId, "step", {
            type: "task_start",
            detail: `Target ${body.task} via ${adapterId}/${body.model} (${requestedCount} run${requestedCount === 1 ? "" : "s"})`,
          });

          const completedBundles: EvidenceBundle[] = [];
          for (let index = 0; index < requestedCount; index += 1) {
            const adapterInstance = await instantiateAdapterForRun({
              adapter: adapterId,
              model: body.model,
              provider: body.provider ?? null,
            });
            try {
              broadcastSSE(runId, "step", {
                type: "task_start",
                detail: `Run ${index + 1}/${requestedCount} executing`,
              });

              const result = await runTask({
                taskId: body.task,
                adapter: adapterInstance.adapter,
                model: body.model,
                keepWorkspace: false,
                reviewConfig,
              });

              storeBundle(result.bundle);
              completedBundles.push(result.bundle);
            } finally {
              await adapterInstance.adapter.teardown();
            }
          }

          const latestBundle = completedBundles[completedBundles.length - 1]!;
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
        } catch (err) {
          const active = activeRuns.get(runId);
          if (active) {
            active.status = "error";
            active.error = String(err);
          }
          broadcastSSE(runId, "error", { error: String(err) });
        } finally {
          const clients = sseClients.get(runId) ?? [];
          for (const client of clients) {
            try { client.end(); } catch { /* ignore */ }
          }
          sseClients.delete(runId);
        }
      })();
      return;
    }

    if (path.startsWith("/api/run/") && path.endsWith("/live") && method === "GET") {
      const runId = path.replace("/api/run/", "").replace("/live", "");
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      const run = activeRuns.get(runId);
      if (run) {
        for (const evt of run.events) {
          res.write(evt);
        }
        if (run.status === "complete") {
          res.end();
          return;
        }
      }
      if (!sseClients.has(runId)) {
        sseClients.set(runId, []);
      }
      sseClients.get(runId)!.push(res);
      req.on("close", () => {
        const clients = sseClients.get(runId);
        if (!clients) return;
        const idx = clients.indexOf(res);
        if (idx >= 0) clients.splice(idx, 1);
      });
      return;
    }

    // ── Suite run endpoints ────────────────────────────────────────────

    if (path === "/api/run-suite" && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}") as {
        model: string;
        adapter?: string;
        provider?: string | null;
        providerId?: string;
        secondOpinion?: { enabled?: boolean; provider?: string; model?: string };
        qcReview?: { enabled?: boolean; provider?: string; model?: string };
      };
      const adapterId = body.adapter || body.providerId || "";
      if (!body.model || !adapterId) {
        sendJSON(res, 400, { error: "model and adapter (or providerId) are required" });
        return;
      }

      const allTasks = listTaskDetails();
      const suiteId = `suite_${Date.now().toString(36)}`;

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

      activeSuiteRuns.set(suiteId, {
        id: suiteId,
        status: "running",
        total: allTasks.length,
        completed: 0,
        results: [],
        summary: null,
      });

      sendJSON(res, 202, {
        ok: true,
        suite_id: suiteId,
        total_tasks: allTasks.length,
        judge: DETERMINISTIC_JUDGE_METADATA,
      });

      // Run tasks sequentially in background
      void (async () => {
        const suite = activeSuiteRuns.get(suiteId)!;
        let adapterInstance: Awaited<ReturnType<typeof instantiateAdapterForRun>> | null = null;

        try {
          adapterInstance = await instantiateAdapterForRun({
            adapter: adapterId,
            model: body.model,
            provider: body.provider ?? null,
          });
          const health = await adapterInstance.adapter.healthCheck();
          if (!health.ok) {
            throw new Error(health.reason ?? `${adapterId} unavailable`);
          }

          for (const task of allTasks) {
            const taskId = task.id as string;
            try {
              // Create fresh adapter instance per task to avoid state leaks
              const taskAdapter = await instantiateAdapterForRun({
                adapter: adapterId,
                model: body.model,
                provider: body.provider ?? null,
              });

              const result = await runTask({
                taskId,
                adapter: taskAdapter.adapter,
                model: body.model,
                keepWorkspace: false,
                reviewConfig,
              });

              storeBundle(result.bundle);

              const durationSec = Math.round(
                (new Date(result.bundle.environment.timestamp_end).getTime() -
                 new Date(result.bundle.environment.timestamp_start).getTime()) / 1000
              );

              suite.results.push({
                task_id: taskId,
                bundle_id: result.bundle.bundle_id,
                score: result.bundle.score.total,
                pass: result.bundle.score.pass,
                duration_sec: durationSec,
                tokens_in: result.bundle.usage.tokens_in,
                tokens_out: result.bundle.usage.tokens_out,
                cost_usd: result.bundle.usage.estimated_cost_usd,
              });

              await taskAdapter.adapter.teardown();
            } catch (err) {
              suite.results.push({
                task_id: taskId,
                bundle_id: "",
                score: 0,
                pass: false,
                duration_sec: 0,
                tokens_in: 0,
                tokens_out: 0,
                cost_usd: 0,
                error: String(err).slice(0, 200),
              });
            }
            suite.completed = suite.results.length;
          }

          // Compute summary
          const passed = suite.results.filter((r) => r.pass).length;
          const failed = suite.results.length - passed;
          const avgScore = suite.results.length > 0
            ? Math.round(suite.results.reduce((s, r) => s + r.score, 0) / suite.results.length * 100)
            : 0;
          const totalTime = suite.results.reduce((s, r) => s + r.duration_sec, 0);
          const totalTokens = suite.results.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0);
          const totalCost = suite.results.reduce((s, r) => s + r.cost_usd, 0);

          suite.summary = {
            total: suite.results.length,
            passed,
            failed,
            pass_rate: suite.results.length > 0 ? Math.round((passed / suite.results.length) * 100) : 0,
            avg_score: avgScore,
            total_time_sec: totalTime,
            total_tokens: totalTokens,
            total_cost_usd: Math.round(totalCost * 10000) / 10000,
          };
          suite.status = "complete";

          log("info", "api", `Suite ${suiteId} complete: ${passed}/${suite.results.length} passed`);
        } catch (err) {
          suite.status = "error";
          suite.error = String(err);
          log("error", "api", `Suite ${suiteId} failed: ${String(err)}`);
        } finally {
          if (adapterInstance) {
            await adapterInstance.adapter.teardown();
          }
        }
      })();
      return;
    }

    if (path.startsWith("/api/run-suite/") && path.endsWith("/status") && method === "GET") {
      const suiteId = path.replace("/api/run-suite/", "").replace("/status", "");
      const suite = activeSuiteRuns.get(suiteId);
      if (!suite) {
        sendJSON(res, 404, { error: "Suite run not found" });
        return;
      }
      sendJSON(res, 200, {
        suite_id: suite.id,
        status: suite.status,
        total: suite.total,
        completed: suite.completed,
        results: suite.results,
        summary: suite.summary,
        error: suite.error ?? null,
      });
      return;
    }

    if (path.startsWith("/api/runs/") && path.endsWith("/crucible-link") && method === "POST") {
      const id = path.replace("/api/runs/", "").replace("/crucible-link", "");
      const bundle = getBundleById(id);
      if (!bundle) {
        sendJSON(res, 404, { error: "Run not found" });
        return;
      }
      const body = JSON.parse(await readBody(req) || "{}") as CrucibleLink;
      const link: CrucibleLink = {
        profile_id: body.profile_id ?? null,
        benchmark_score: typeof body.benchmark_score === "number" ? body.benchmark_score : null,
        benchmark_label: body.benchmark_label ?? null,
      };
      writeCrucibleLink(id, link);
      sendJSON(res, 200, { ok: true, link });
      return;
    }

    // ── Score sync API ────────────────────────────────────────────────

    if (path === "/api/scores/sync" && method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}") as {
        scores?: ModelScore[];
        source?: string;
        runId?: string;
      };

      if (!body.scores || !Array.isArray(body.scores) || body.scores.length === 0) {
        sendJSON(res, 400, { ok: false, stored: 0, errors: ["scores array is required and must be non-empty"] });
        return;
      }

      const validSources: ScoreSource[] = ["crucible", "crucibulum", "veritor"];
      const source = (validSources.includes(body.source as ScoreSource) ? body.source : "crucibulum") as ScoreSource;

      // Validate each score
      const validFamilies = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
      const validationErrors: string[] = [];
      const validScores: ModelScore[] = [];

      for (let i = 0; i < body.scores.length; i++) {
        const s = body.scores[i]!;
        if (!s.modelId || !s.taskId || !s.family || !s.timestamp) {
          validationErrors.push(`scores[${i}]: missing required fields (modelId, taskId, family, timestamp)`);
          continue;
        }
        if (!validFamilies.has(s.family)) {
          validationErrors.push(`scores[${i}]: invalid family '${s.family}'`);
          continue;
        }
        if (typeof s.score !== "number" || s.score < 0 || s.score > 100) {
          validationErrors.push(`scores[${i}]: score must be 0-100`);
          continue;
        }
        validScores.push(s);
      }

      const result = storeScores(validScores, source, body.runId);
      sendJSON(res, 200, {
        ok: result.errors.length === 0 && validationErrors.length === 0,
        stored: result.stored,
        errors: [...validationErrors, ...result.errors],
      });
      return;
    }

    if (path === "/api/scores" && method === "GET") {
      const modelId = url.searchParams.get("modelId") ?? undefined;
      const family = url.searchParams.get("family") ?? undefined;
      const taskId = url.searchParams.get("taskId") ?? undefined;
      const source = url.searchParams.get("source") ?? undefined;
      const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);

      const scores = queryScores({ modelId, family, taskId, source, limit });
      sendJSON(res, 200, { scores, count: scores.length });
      return;
    }

    if (path === "/api/scores/leaderboard" && method === "GET") {
      const entries = getLeaderboard();
      sendJSON(res, 200, { leaderboard: entries });
      return;
    }

    sendJSON(res, 404, { error: "Not found" });
  } catch (err) {
    log("error", "api", `Request error: ${String(err)}`);
    sendJSON(res, 500, { error: String(err) });
  }
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch((err) => {
    log("error", "api", String(err));
    res.writeHead(500);
    res.end("Internal error");
  });
});

server.listen(PORT, "0.0.0.0", () => {
  log("info", "api", `Crucibulum server running on http://localhost:${PORT}`);
  log("info", "api", `UI: http://localhost:${PORT}/`);
  log("info", "api", `API: http://localhost:${PORT}/api/`);
});
