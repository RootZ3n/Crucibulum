/**
 * Crucible — Grimoire Codex Adapter
 * Routes tasks through Squidley's Grimoire Codex mode.
 * Codex Mode = iterative inspect/edit/verify loop.
 *
 * CLI usage:
 *   --adapter grimoire-codex --model gpt-5.4
 */

import type {
  CrucibulumAdapter,
  AdapterConfig,
  ExecutionInput,
  ExecutionResult,
} from "./base.js";
import { Observer } from "../core/observer.js";
import { makeHttpProviderError, makeProviderFailureError, normalizeProviderError, providerErrorSummary } from "../core/provider-errors.js";
import { log } from "../utils/logger.js";

const DEFAULT_SQUIDLEY_URL = process.env["SQUIDLEY_URL"] ?? "http://localhost:18791";
const SUBMIT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;

interface GrimoireCodexConfig extends AdapterConfig {
  squidley_url?: string | undefined;
  model?: string | undefined;
}

interface CodexStatusResponse {
  status: "pending" | "running" | "complete" | "error";
  result?: {
    text?: string;
    files_read?: string[];
    files_written?: string[];
    tokensIn?: number;
    tokensOut?: number;
    estimatedCostUsd?: number;
    exit_reason?: string;
    error?: string;
  };
}

export class GrimoireCodexAdapter implements CrucibulumAdapter {
  id = "grimoire-codex";
  name = "Grimoire Codex";
  version = "1.0.0";

  private url: string = DEFAULT_SQUIDLEY_URL;
  private model: string = "qwen3.6-plus";

  supports(_family: "poison" | "spec" | "orchestration"): boolean {
    return true;
  }

  supportsToolCalls(): boolean {
    return true;
  }

  supportsChat(): boolean {
    return false;
  }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as GrimoireCodexConfig;
    if (c.squidley_url) this.url = c.squidley_url;
    if (c.model) this.model = c.model;
  }

  async healthCheck() {
    try {
      const res = await fetch(`${this.url}/health`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        const providerError = makeHttpProviderError(res, await res.text().catch(() => ""), { provider: "grimoire-codex", adapter: this.id }).structured;
        return { ok: false, reason: providerErrorSummary(providerError), providerError };
      }
      return { ok: true };
    } catch (err) {
      const providerError = normalizeProviderError(err, { provider: "grimoire-codex", adapter: this.id });
      return { ok: false, reason: providerErrorSummary(providerError), providerError };
    }
  }

  async teardown(): Promise<void> { /* nothing to clean up */ }

  async execute(input: ExecutionInput): Promise<ExecutionResult> {
    const observer = new Observer();
    observer.taskStart();
    const startMs = Date.now();
    const timeLimitMs = input.budget.time_limit_sec * 1000;

    // Submit the Codex job
    log("info", "grimoire-codex", `Submitting Codex job: ${this.model}`);

    let jobId: string;
    try {
      const res = await fetch(`${this.url}/grimoire/codex`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task: buildTaskPrompt(input),
          workspace: input.workspace_path,
          model: this.model,
        }),
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw makeHttpProviderError(res, errText, { provider: "grimoire-codex", adapter: this.id });
      }

      const data = (await res.json()) as { jobId?: string; job_id?: string; id?: string };
      jobId = data.jobId ?? data.job_id ?? data.id ?? "";
      if (!jobId) throw makeProviderFailureError({
        kind: "INVALID_RESPONSE",
        origin: "ADAPTER",
        provider: "grimoire-codex",
        adapter: this.id,
        rawMessage: "No jobId in Grimoire Codex response",
        retryable: false,
      });

      log("info", "grimoire-codex", `Codex job submitted: ${jobId}`);
    } catch (err) {
      const providerError = normalizeProviderError(err, { provider: "grimoire-codex", adapter: this.id });
      log("error", "grimoire-codex", `Submit failed: ${providerError.rawMessage.slice(0, 200)}`);
      observer.recordError(`Submit failed: ${providerError.rawMessage.slice(0, 200)}`, providerError);
      return buildErrorResult(observer, startMs, this);
    }

    // Poll for completion
    let status: CodexStatusResponse = { status: "pending" };

    while (Date.now() - startMs < timeLimitMs) {
      await sleep(POLL_INTERVAL_MS);

      try {
        const res = await fetch(`${this.url}/grimoire/codex/status/${jobId}`, {
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          log("warn", "grimoire-codex", `Poll returned ${res.status}`);
          continue;
        }
        status = (await res.json()) as CodexStatusResponse;
        log("info", "grimoire-codex", `Job ${jobId}: ${status.status}`);

        if (status.status === "complete" || status.status === "error") break;
      } catch (err) {
        log("warn", "grimoire-codex", `Poll error: ${String(err).slice(0, 100)}`);
      }
    }

    const totalDuration = Date.now() - startMs;

    if (status.status !== "complete" && status.status !== "error") {
      log("warn", "grimoire-codex", `Job timed out after ${Math.round(totalDuration / 1000)}s`);
      observer.recordError("Codex job timed out", makeProviderFailureError({
        kind: "TIMEOUT",
        origin: "PROVIDER",
        provider: "grimoire-codex",
        adapter: this.id,
        rawMessage: "Codex job timed out",
        retryable: true,
      }).structured);
      return {
        exit_reason: "timeout",
        timeline: observer.getTimeline(),
        provider_error: observer.getProviderError() ?? undefined,
        duration_ms: totalDuration,
        steps_used: observer.getStepCount(),
        files_read: [],
        files_written: [],
        tokens_in: 0,
        tokens_out: 0,
        adapter_metadata: {
          adapter_id: this.id,
          adapter_version: this.version,
          system_version: "squidley-v2",
          model: this.model,
          provider: "grimoire-codex",
        },
      };
    }

    const result = status.result ?? {};
    const exitReason: ExecutionResult["exit_reason"] =
      status.status === "error" ? "error" : (result.exit_reason as ExecutionResult["exit_reason"]) ?? "complete";

    if (result.files_read) result.files_read.forEach(f => observer.fileRead(f));
    if (result.files_written) result.files_written.forEach(f => observer.fileWrite(f));
    if (status.status === "error") {
      observer.recordError(
        result.error ? `Codex job failed: ${result.error.slice(0, 200)}` : "Codex job failed",
        normalizeProviderError(result.error ?? "Codex job failed", { provider: "grimoire-codex", adapter: this.id }),
      );
    }
    if (exitReason === "complete") observer.taskComplete();

    log("info", "grimoire-codex", `Run complete: ${exitReason} in ${Math.round(totalDuration / 1000)}s`);

    return {
      exit_reason: exitReason,
      timeline: observer.getTimeline(),
      provider_error: observer.getProviderError() ?? undefined,
      duration_ms: totalDuration,
      steps_used: observer.getStepCount(),
      files_read: result.files_read ?? [],
      files_written: result.files_written ?? [],
      tokens_in: result.tokensIn ?? 0,
      tokens_out: result.tokensOut ?? 0,
      adapter_metadata: {
        adapter_id: this.id,
        adapter_version: this.version,
        system_version: "squidley-v2",
        model: this.model,
        provider: "grimoire-codex",
      },
    };
  }
}

function buildTaskPrompt(input: ExecutionInput): string {
  return [
    input.task.task.title,
    "",
    input.task.task.description,
    "",
    `Entrypoints: ${input.task.task.entrypoints.join(", ")}`,
    input.task.verification.public_tests_command ? `Tests: ${input.task.verification.public_tests_command}` : "",
    input.task.verification.build_command ? `Build: ${input.task.verification.build_command}` : "",
  ].filter(Boolean).join("\n");
}

function buildErrorResult(observer: Observer, startMs: number, adapter: GrimoireCodexAdapter): ExecutionResult {
  return {
    exit_reason: "error",
    timeline: observer.getTimeline(),
    provider_error: observer.getProviderError() ?? undefined,
    duration_ms: Date.now() - startMs,
    steps_used: observer.getStepCount(),
    files_read: [],
    files_written: [],
    tokens_in: 0,
    tokens_out: 0,
    adapter_metadata: {
      adapter_id: adapter.id,
      adapter_version: adapter.version,
      system_version: "squidley-v2",
      model: "unknown",
      provider: "grimoire-codex",
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
