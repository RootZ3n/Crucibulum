import type { StructuredProviderError, ProviderErrorKind, ProviderErrorOrigin } from "../types/provider-error.js";

interface ProviderErrorContext {
  provider?: string | null;
  adapter?: string | null;
  attempt?: number | null;
  durationMs?: number | null;
  requestId?: string | null;
  origin?: ProviderErrorOrigin | null;
}

interface ProviderFailureErrorOptions extends ProviderErrorContext {
  kind: ProviderErrorKind;
  origin: ProviderErrorOrigin;
  statusCode?: number | null;
  retryable?: boolean;
  rawMessage: string;
  rawCode?: string | null;
  cause?: string | null;
}

export class ProviderFailureError extends Error {
  readonly structured: StructuredProviderError;

  constructor(options: ProviderFailureErrorOptions) {
    super(options.rawMessage);
    this.name = "ProviderFailureError";
    this.structured = {
      kind: options.kind,
      origin: options.origin,
      provider: options.provider ?? null,
      adapter: options.adapter ?? null,
      statusCode: options.statusCode ?? null,
      retryable: options.retryable ?? isRetryable(options.kind, options.statusCode ?? null),
      rawMessage: options.rawMessage,
      rawCode: options.rawCode ?? null,
      cause: options.cause ?? null,
      attempt: options.attempt ?? null,
      durationMs: options.durationMs ?? null,
      requestId: options.requestId ?? null,
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function errorString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message || String(value);
  return String(value);
}

function pullRequestId(headers: Headers): string | null {
  return headers.get("x-request-id")
    ?? headers.get("request-id")
    ?? headers.get("anthropic-request-id")
    ?? headers.get("openai-request-id")
    ?? null;
}

function isRetryable(kind: ProviderErrorKind, statusCode: number | null): boolean {
  if (kind === "TIMEOUT" || kind === "NETWORK" || kind === "CONNECTION_RESET" || kind === "DNS" || kind === "UNAVAILABLE") return true;
  if (kind === "RATE_LIMIT" || kind === "HTTP_5XX") return true;
  if (statusCode === 408 || statusCode === 429) return true;
  return false;
}

function classifyHttpKind(statusCode: number): { kind: ProviderErrorKind; origin: ProviderErrorOrigin; retryable: boolean } {
  if (statusCode === 401 || statusCode === 403) return { kind: "AUTH", origin: "PROVIDER", retryable: false };
  if (statusCode === 408) return { kind: "TIMEOUT", origin: "PROVIDER", retryable: true };
  if (statusCode === 429) return { kind: "RATE_LIMIT", origin: "PROVIDER", retryable: true };
  if (statusCode === 503) return { kind: "UNAVAILABLE", origin: "PROVIDER", retryable: true };
  if (statusCode >= 500) return { kind: "HTTP_5XX", origin: "PROVIDER", retryable: true };
  if (statusCode >= 400) return { kind: "HTTP_4XX", origin: "PROVIDER", retryable: false };
  return { kind: "UNKNOWN", origin: "PROVIDER", retryable: false };
}

export function makeHttpProviderError(
  response: Response,
  rawBody: string,
  context: ProviderErrorContext,
  fallbackMessage?: string,
): ProviderFailureError {
  const classification = classifyHttpKind(response.status);
  const rawMessage = fallbackMessage ?? `${context.provider ?? "Provider"} returned HTTP ${response.status}: ${rawBody.slice(0, 400)}`;
  return new ProviderFailureError({
    ...context,
    kind: classification.kind,
    origin: classification.origin,
    statusCode: response.status,
    retryable: classification.retryable,
    rawMessage,
    requestId: context.requestId ?? pullRequestId(response.headers),
  });
}

export function makeProviderFailureError(options: ProviderFailureErrorOptions): ProviderFailureError {
  return new ProviderFailureError(options);
}

export function makeEmptyResponseError(context: ProviderErrorContext, rawMessage: string): ProviderFailureError {
  return new ProviderFailureError({
    ...context,
    kind: "EMPTY_RESPONSE",
    origin: context.origin ?? "PROVIDER",
    retryable: true,
    rawMessage,
  });
}

export function makeInvalidResponseError(context: ProviderErrorContext, rawMessage: string): ProviderFailureError {
  return new ProviderFailureError({
    ...context,
    kind: "INVALID_RESPONSE",
    origin: context.origin ?? "PROVIDER",
    retryable: false,
    rawMessage,
  });
}

export function makeProcessProviderError(
  context: ProviderErrorContext,
  rawMessage: string,
  rawCode?: string | null,
): ProviderFailureError {
  return new ProviderFailureError({
    ...context,
    kind: "PROCESS_ERROR",
    origin: context.origin ?? "LOCAL_RUNTIME",
    retryable: false,
    rawMessage,
    rawCode: rawCode ?? null,
  });
}

export function getStructuredProviderError(error: unknown): StructuredProviderError | null {
  if (error instanceof ProviderFailureError) return error.structured;
  if (isObject(error) && isObject(error["structured"])) {
    const structured = error["structured"] as Record<string, unknown>;
    if (typeof structured["kind"] === "string" && typeof structured["origin"] === "string" && typeof structured["rawMessage"] === "string") {
      return structured as unknown as StructuredProviderError;
    }
  }
  return null;
}

export function normalizeProviderError(error: unknown, context: ProviderErrorContext): StructuredProviderError {
  const existing = getStructuredProviderError(error);
  if (existing) {
    return {
      ...existing,
      provider: existing.provider ?? context.provider ?? null,
      adapter: existing.adapter ?? context.adapter ?? null,
      attempt: existing.attempt ?? context.attempt ?? null,
      durationMs: existing.durationMs ?? context.durationMs ?? null,
      requestId: existing.requestId ?? context.requestId ?? null,
    };
  }

  const message = errorString(error);
  const code = isObject(error) && typeof error["code"] === "string" ? error["code"] : null;
  const cause = isObject(error) && error["cause"] != null ? errorString(error["cause"]) : null;
  const lower = `${message} ${cause ?? ""}`.toLowerCase();
  let kind: ProviderErrorKind = "UNKNOWN";
  let origin: ProviderErrorOrigin = context.origin ?? "ADAPTER";

  if (code === "ECONNRESET" || lower.includes("econnreset") || lower.includes("connection reset") || lower.includes("socket hang up")) {
    kind = "CONNECTION_RESET";
    origin = "NETWORK";
  } else if (code === "ENOTFOUND" || code === "EAI_AGAIN" || lower.includes("enotfound") || lower.includes("eai_again") || lower.includes("dns")) {
    kind = "DNS";
    origin = "NETWORK";
  } else if (code === "ETIMEDOUT" || lower.includes("timeout") || lower.includes("timed out") || lower.includes("aborterror")) {
    kind = "TIMEOUT";
    origin = context.origin ?? "PROVIDER";
  } else if (lower.includes("fetch failed") || lower.includes("network error") || lower.includes("unreachable")) {
    kind = "NETWORK";
    origin = "NETWORK";
  } else if (code === "ENOENT" || code === "EACCES" || code === "EPERM" || lower.includes("spawn")) {
    kind = "PROCESS_ERROR";
    origin = "LOCAL_RUNTIME";
  } else if (lower.includes("cancel")) {
    kind = "CANCELLED";
  }

  return {
    kind,
    origin,
    provider: context.provider ?? null,
    adapter: context.adapter ?? null,
    statusCode: null,
    retryable: isRetryable(kind, null),
    rawMessage: message,
    rawCode: code,
    cause,
    attempt: context.attempt ?? null,
    durationMs: context.durationMs ?? null,
    requestId: context.requestId ?? null,
  };
}

/**
 * Operator-facing failure text that preserves both the error bucket ("Invalid
 * provider payload") AND the detailed rawMessage ("MiniMax error 2049: invalid
 * api key (base=…)"). The UI previously displayed only the summary bucket,
 * which was actively misleading — an operator seeing "Invalid provider
 * payload" on every run had no way to know whether it was a bad API key, a
 * wrong model id, or a regional endpoint mismatch. Use this anywhere the raw
 * message adds information the summary doesn't.
 */
export function providerErrorDetail(error: StructuredProviderError): string {
  const summary = providerErrorSummary(error);
  const raw = (error.rawMessage || "").trim();
  if (!raw) return summary;
  // Don't double up if the raw message already starts with the summary text.
  if (raw.toLowerCase().startsWith(summary.toLowerCase())) return raw;
  // Keep the combined line operator-readable: bucket first, then the detail
  // the bucket is hiding. Trim rawMessage to keep the line scannable.
  const detail = raw.length > 320 ? raw.slice(0, 320) + "…" : raw;
  return `${summary} — ${detail}`;
}

export function providerErrorSummary(error: StructuredProviderError): string {
  switch (error.kind) {
    case "TIMEOUT":
      return "Provider request timed out";
    case "RATE_LIMIT":
      return error.statusCode ? `Rate limited (${error.statusCode})` : "Rate limited";
    case "CONNECTION_RESET":
      return "Connection reset";
    case "DNS":
      return "DNS resolution failed";
    case "NETWORK":
      return "Network request failed";
    case "HTTP_5XX":
      return error.statusCode ? `Provider HTTP ${error.statusCode}` : "Provider 5xx error";
    case "HTTP_4XX":
      return error.statusCode ? `Provider HTTP ${error.statusCode}` : "Provider 4xx error";
    case "AUTH":
      return error.statusCode ? `Authentication failed (${error.statusCode})` : "Authentication failed";
    case "UNAVAILABLE":
      return error.statusCode ? `Provider unavailable (${error.statusCode})` : "Provider unavailable";
    case "EMPTY_RESPONSE":
      return "Empty response";
    case "INVALID_RESPONSE":
      return "Invalid provider payload";
    case "PROCESS_ERROR":
      return "Process/runtime failure";
    case "CANCELLED":
      return "Request cancelled";
    default:
      return "Provider or adapter failure";
  }
}
