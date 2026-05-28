/**
 * Luak — Claude Code Adapter (DEPRECATED)
 *
 * Claude Code subscription cancelled. This adapter is retained so that
 * existing registry entries, tests, and CLI references compile and
 * report honest "unavailable/deprecated" status instead of crashing.
 *
 * Replacement: use --adapter codex, --adapter squidley, or --adapter openrouter.
 *
 * The full implementation was removed in the post-Claude cutover (2026-05-05).
 * The original spawned `claude --print` and parsed stdout heuristically.
 */

import type { CrucibulumAdapter, AdapterConfig, HealthCheckResult, ExecutionInput, ExecutionResult } from "./base.js";
import { makeProviderFailureError, providerErrorSummary } from "../core/provider-errors.js";
import { log } from "../utils/logger.js";

interface ClaudeCodeConfig extends AdapterConfig {
  binary_path?: string | undefined;
  model?: string | undefined;
}

export class ClaudeCodeAdapter implements CrucibulumAdapter {
  id = "claudecode";
  name = "Claude Code (deprecated)";
  version = "2.0.0-deprecated";

  private model: string | null = null;

  supports(_family: "poison" | "spec" | "orchestration"): boolean { return false; }
  supportsToolCalls(): boolean { return false; }
  supportsChat(): boolean { return false; }

  async init(config: AdapterConfig): Promise<void> {
    const c = config as ClaudeCodeConfig;
    if (c.model) this.model = c.model;
    log("warn", "claudecode", "Claude Code adapter is deprecated. Use codex, squidley, or openrouter instead.");
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const providerError = makeProviderFailureError({
      kind: "PROCESS_ERROR",
      origin: "LOCAL_RUNTIME",
      provider: "claudecode",
      adapter: this.id,
      rawMessage: "Claude Code adapter deprecated — binary dependency removed. Use --adapter codex, squidley, or openrouter.",
    }).structured;
    return { ok: false, reason: providerErrorSummary(providerError), providerError };
  }

  async teardown(): Promise<void> {}

  async execute(_input: ExecutionInput): Promise<ExecutionResult> {
    const providerError = makeProviderFailureError({
      kind: "PROCESS_ERROR",
      origin: "LOCAL_RUNTIME",
      provider: "claudecode",
      adapter: this.id,
      rawMessage: "Claude Code adapter deprecated. Use --adapter codex, squidley, or openrouter.",
    }).structured;
    return {
      exit_reason: "error",
      timeline: [{ t: Date.now(), type: "error", detail: "Claude Code adapter deprecated" }],
      provider_error: providerError,
      duration_ms: 0,
      steps_used: 0,
      files_read: [],
      files_written: [],
      adapter_metadata: {
        adapter_id: this.id,
        adapter_version: this.version,
        system_version: "deprecated",
        model: this.model ?? "none",
        provider: "claudecode",
      },
    };
  }
}
