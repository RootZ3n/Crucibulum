/**
 * Crucible — Suite Routes
 * Suite execution with flake detection and status.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJSON, readBody, parseJsonBody, log, canonicalPercent } from "./shared.js";
import { validateRunSuiteRequest } from "../validators.js";
import { instantiateAdapterForRun } from "../../adapters/registry.js";
import { runTask } from "../../core/runner.js";
import { runTaskWithRetries, type FlakeResult } from "../../core/flake.js";
import { storeBundle } from "../../core/bundle.js";
import { DETERMINISTIC_JUDGE_METADATA } from "../../core/judge.js";
import { listTaskDetails } from "./shared.js";
import { requireAuth } from "../auth.js";
import { resolveFlakeConfig, computeConfidence } from "../../core/suite-loader.js";

export interface SuiteTaskResult {
  task_id: string;
  bundle_id: string;
  score: number;
  pass: boolean;
  duration_sec: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  error?: string | undefined;
  // Flake detection fields
  attempts?: number | undefined;
  pass_count?: number | undefined;
  fail_count?: number | undefined;
  pass_rate?: number | undefined;
  is_flaky?: boolean | undefined;
  outcome?: "stable_pass" | "stable_fail" | "flaky_pass" | "flaky_fail" | undefined;
  confidence?: "high" | "medium" | "low" | undefined;
  first_run_result?: { passed: boolean; score: number; bundle_id: string } | undefined;
  aggregate_result?: { passed: boolean; score: number } | undefined;
}

export interface SuiteFlakeSummary {
  stable_passes: number;
  stable_fails: number;
  flaky_passes: number;
  flaky_fails: number;
  average_pass_rate: number;
  overall_outcome: "stable_pass" | "stable_fail" | "mixed" | "flaky_mixed";
  percentage_stable: number;
  percentage_flaky: number;
}

export interface ActiveSuiteRun {
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
    // Flake-aware aggregation
    flake_summary?: SuiteFlakeSummary | undefined;
    confidence?: "high" | "medium" | "low" | undefined;
  } | null;
  error?: string | undefined;
}

export const activeSuiteRuns = new Map<string, ActiveSuiteRun>();

export async function handleRunSuitePost(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!requireAuth(req, res)) return;
  const parsed = await parseJsonBody<unknown>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const v = validateRunSuiteRequest(parsed.value);
  if (!v.ok) { sendJSON(res, 400, { error: "Invalid run-suite request", details: v.errors }); return; }
  const body = v.value;
  const adapterId = body.adapter;

  const allTasks = listTaskDetails();
  const suiteRunId = `suite_${Date.now().toString(36)}`;

  // Resolve flake config: suite manifest > request override > defaults
  const flakeConfig = resolveFlakeConfig(body.suite_id, body.flake_detection);
  const useFlakeDetection = flakeConfig.enabled && flakeConfig.retries > 1;

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

  activeSuiteRuns.set(suiteRunId, {
    id: suiteRunId,
    status: "running",
    total: allTasks.length,
    completed: 0,
    results: [],
    summary: null,
  });

  sendJSON(res, 202, {
    ok: true,
    suite_id: suiteRunId,
    total_tasks: allTasks.length,
    flake_detection: { enabled: useFlakeDetection, retries: flakeConfig.retries },
    judge: DETERMINISTIC_JUDGE_METADATA,
  });

  void (async () => {
    const suite = activeSuiteRuns.get(suiteRunId)!;
    let adapterInstance: Awaited<ReturnType<typeof instantiateAdapterForRun>> | null = null;

    try {
      adapterInstance = await instantiateAdapterForRun({
        adapter: adapterId,
        model: body.model,
        provider: body.provider ?? null,
      });
      const health = await adapterInstance.adapter.healthCheck();
      if (!health.ok) throw new Error(health.reason ?? `${adapterId} unavailable`);

      for (const task of allTasks) {
        const taskId = task.id as string;
        try {
          const taskAdapter = await instantiateAdapterForRun({
            adapter: adapterId,
            model: body.model,
            provider: body.provider ?? null,
          });

          let taskResult: SuiteTaskResult;

          if (useFlakeDetection) {
            // Run with flake detection
            const { result, flake } = await runTaskWithRetries({
              taskId,
              adapter: taskAdapter.adapter,
              model: body.model,
              keepWorkspace: false,
              reviewConfig,
              retry_count: flakeConfig.retries,
            });

            storeBundle(result.bundle);
            const durationSec = Math.round((new Date(result.bundle.environment.timestamp_end).getTime() - new Date(result.bundle.environment.timestamp_start).getTime()) / 1000);

            taskResult = {
              task_id: taskId,
              bundle_id: result.bundle.bundle_id,
              score: canonicalPercent(flake.aggregate.score),
              pass: flake.aggregate.passed,
              duration_sec: durationSec,
              tokens_in: result.bundle.usage.tokens_in,
              tokens_out: result.bundle.usage.tokens_out,
              cost_usd: result.bundle.usage.estimated_cost_usd,
              // Flake fields
              attempts: flake.total_attempts,
              pass_count: flake.pass_count,
              fail_count: flake.fail_count,
              pass_rate: flake.pass_rate,
              is_flaky: flake.is_flaky,
              outcome: flake.outcome,
              confidence: computeConfidence(flake.pass_rate, flake.is_flaky),
              first_run_result: {
                passed: flake.first_run.passed,
                score: canonicalPercent(flake.first_run.score),
                bundle_id: flake.first_run.bundle_id,
              },
              aggregate_result: {
                passed: flake.aggregate.passed,
                score: canonicalPercent(flake.aggregate.score),
              },
            };
          } else {
            // Single run (no flake detection)
            const result = await runTask({
              taskId,
              adapter: taskAdapter.adapter,
              model: body.model,
              keepWorkspace: false,
              reviewConfig,
            });

            storeBundle(result.bundle);
            const durationSec = Math.round((new Date(result.bundle.environment.timestamp_end).getTime() - new Date(result.bundle.environment.timestamp_start).getTime()) / 1000);

            taskResult = {
              task_id: taskId,
              bundle_id: result.bundle.bundle_id,
              score: canonicalPercent(result.bundle.score.total),
              pass: result.bundle.score.pass,
              duration_sec: durationSec,
              tokens_in: result.bundle.usage.tokens_in,
              tokens_out: result.bundle.usage.tokens_out,
              cost_usd: result.bundle.usage.estimated_cost_usd,
              // Single-run: treated as stable
              attempts: 1,
              pass_count: result.passed ? 1 : 0,
              fail_count: result.passed ? 0 : 1,
              pass_rate: result.passed ? 1 : 0,
              is_flaky: false,
              outcome: result.passed ? "stable_pass" : "stable_fail",
              confidence: computeConfidence(result.passed ? 1 : 0, false),
              first_run_result: {
                passed: result.passed,
                score: canonicalPercent(result.bundle.score.total),
                bundle_id: result.bundle.bundle_id,
              },
              aggregate_result: {
                passed: result.passed,
                score: canonicalPercent(result.bundle.score.total),
              },
            };
          }

          suite.results.push(taskResult);
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
            attempts: 1,
            pass_count: 0,
            fail_count: 1,
            pass_rate: 0,
            is_flaky: false,
            outcome: "stable_fail",
            confidence: "low",
          });
        }
        suite.completed = suite.results.length;
      }

      // Compute summary with flake-aware aggregation
      const passed = suite.results.filter((r) => r.pass).length;
      const failed = suite.results.length - passed;
      const avgScore = suite.results.length > 0
        ? Math.round((suite.results.reduce((sum, r) => sum + r.score, 0) / suite.results.length) * 100) / 100
        : 0;
      const totalTime = suite.results.reduce((sum, r) => sum + r.duration_sec, 0);
      const totalTokens = suite.results.reduce((sum, r) => sum + r.tokens_in + r.tokens_out, 0);
      const totalCost = suite.results.reduce((sum, r) => sum + r.cost_usd, 0);

      // Flake summary
      const stablePasses = suite.results.filter((r) => r.outcome === "stable_pass").length;
      const stableFails = suite.results.filter((r) => r.outcome === "stable_fail").length;
      const flakyPasses = suite.results.filter((r) => r.outcome === "flaky_pass").length;
      const flakyFails = suite.results.filter((r) => r.outcome === "flaky_fail").length;
      const avgPassRate = suite.results.length > 0
        ? Math.round((suite.results.reduce((sum, r) => sum + (r.pass_rate ?? (r.pass ? 1 : 0)), 0) / suite.results.length) * 100) / 100
        : 0;

      const flakyCount = suite.results.filter((r) => r.is_flaky).length;
      const suiteConfidence = computeConfidence(avgPassRate, flakyCount > 0);
      const totalTasks = suite.results.length;
      const percentageStable = totalTasks > 0 ? Math.round(((stablePasses + stableFails) / totalTasks) * 100) : 0;
      const percentageFlaky = totalTasks > 0 ? Math.round((flakyCount / totalTasks) * 100) : 0;
      // Compute overall outcome
      let overallOutcome: "stable_pass" | "stable_fail" | "mixed" | "flaky_mixed";
      if (flakyCount > 0 && (flakyPasses > 0 || flakyFails > 0)) {
        overallOutcome = (stablePasses > 0 || stableFails > 0) ? "flaky_mixed" : "mixed";
      } else if (passed === totalTasks && totalTasks > 0) {
        overallOutcome = "stable_pass";
      } else if (failed === totalTasks && totalTasks > 0) {
        overallOutcome = "stable_fail";
      } else {
        overallOutcome = "mixed";
      }

      suite.summary = {
        total: suite.results.length,
        passed,
        failed,
        pass_rate: suite.results.length > 0 ? Math.round((passed / suite.results.length) * 100) : 0,
        avg_score: avgScore,
        total_time_sec: totalTime,
        total_tokens: totalTokens,
        total_cost_usd: Math.round(totalCost * 10000) / 10000,
        flake_summary: {
          stable_passes: stablePasses,
          stable_fails: stableFails,
          flaky_passes: flakyPasses,
          flaky_fails: flakyFails,
          average_pass_rate: avgPassRate,
          overall_outcome: overallOutcome,
          percentage_stable: percentageStable,
          percentage_flaky: percentageFlaky,
        },
        confidence: suiteConfidence,
      };
      suite.status = "complete";
      log("info", "api", `Suite ${suiteRunId} complete: ${passed}/${suite.results.length} passed, flake_rate=${flakyCount}`);
    } catch (err) {
      suite.status = "error";
      suite.error = String(err);
      log("error", "api", `Suite ${suiteRunId} failed: ${String(err)}`);
    } finally {
      if (adapterInstance) await adapterInstance.adapter.teardown();
    }
  })();
}

export async function handleRunSuiteStatus(_req: IncomingMessage, res: ServerResponse, path: string): Promise<void> {
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
}
