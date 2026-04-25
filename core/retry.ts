import type { ProviderAttemptRecord } from "../adapters/base.js";
import type { StructuredProviderError } from "../types/provider-error.js";
import { normalizeProviderError } from "./provider-errors.js";

export interface RetryOptions {
  retries: number;
  baseDelayMs?: number | undefined;
  maxDelayMs?: number | undefined;
  jitterMs?: number | undefined;
  onAttempt?: (attempt: ProviderAttemptRecord) => void;
  classifyError?: (error: unknown, attempt: number, durationMs: number) => StructuredProviderError;
}

export interface RetryResult<T> {
  value: T;
  attempts: ProviderAttemptRecord[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function delayFor(attempt: number, options: RetryOptions): number {
  const base = options.baseDelayMs ?? 750;
  const max = options.maxDelayMs ?? 8_000;
  const jitter = Math.floor(Math.random() * (options.jitterMs ?? 250));
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1)) + jitter;
}

export async function withProviderRetries<T>(
  fn: (attempt: number) => Promise<T>,
  context: { provider: string; adapter: string },
  options: RetryOptions,
): Promise<RetryResult<T>> {
  const retries = Math.max(0, Math.floor(options.retries));
  const attempts: ProviderAttemptRecord[] = [];
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    const started = new Date().toISOString();
    const startMs = Date.now();
    try {
      const value = await fn(attempt);
      const record: ProviderAttemptRecord = {
        attempt,
        started_at: started,
        duration_ms: Date.now() - startMs,
        error_type: null,
        retry_decision: "success",
      };
      attempts.push(record);
      options.onAttempt?.(record);
      return { value, attempts };
    } catch (err) {
      const structured = options.classifyError
        ? options.classifyError(err, attempt, Date.now() - startMs)
        : normalizeProviderError(err, { provider: context.provider, adapter: context.adapter, attempt, durationMs: Date.now() - startMs });
      const canRetry = structured.retryable && attempt <= retries;
      const record: ProviderAttemptRecord = {
        attempt,
        started_at: started,
        duration_ms: Date.now() - startMs,
        error_type: structured.kind,
        retry_decision: canRetry ? "retry" : structured.retryable ? "stop" : "not_retryable",
        provider_error: { ...structured, attempt, durationMs: Date.now() - startMs },
      };
      attempts.push(record);
      options.onAttempt?.(record);
      if (!canRetry) {
        throw err;
      }
      await sleep(delayFor(attempt, options));
    }
  }
  throw new Error("retry loop exited unexpectedly");
}
