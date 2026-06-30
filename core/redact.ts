/**
 * Luak — secret redaction for operator-facing output.
 *
 * Provider errors, raw env values, and request metadata can carry credentials:
 * `Authorization` headers, bare `Bearer` tokens, the `OPENROUTER_API_KEY` env
 * value, OpenRouter `sk-or-v1-*` keys, and generic `apiKey` / `api_key` /
 * `token` / `secret` fields. Anything written to the terminal, a receipt, or a
 * report MUST pass through {@link redactSecrets} first.
 *
 * The companion {@link safeProviderError} projection is the only sanctioned way
 * to persist a provider error: it keeps a small allow-list of safe fields
 * (provider, model, status code, a bucketed message, the provider error code,
 * and a request id only when it is demonstrably opaque) and never the raw
 * provider message, request headers, or env values.
 */

import type { StructuredProviderError } from "../types/provider-error.js";
import { providerErrorSummary } from "./provider-errors.js";

export const REDACTED = "[redacted]";

/**
 * Redact credentials from an arbitrary value, returning a string safe to print
 * or persist. Idempotent: running it twice yields the same output. Patterns are
 * applied most-specific first so a key embedded in a header is masked before
 * the surrounding header value is collapsed.
 */
export function redactSecrets(input: unknown): string {
  let s = typeof input === "string" ? input : stringifySafely(input);
  if (!s) return s;

  // 1. OpenRouter keys (`sk-or-v1-…`) — the highest-value secret, masked first
  //    so it is gone even if no surrounding `apiKey:`/`Bearer` context exists.
  s = s.replace(/sk-or-v1-[A-Za-z0-9._-]+/gi, REDACTED);
  // 1b. Anthropic keys (`sk-ant-…`) — hyphens mean the generic sk- rule below
  //     stops at the first dash, so match these explicitly first.
  s = s.replace(/sk-ant-[A-Za-z0-9._-]+/gi, REDACTED);
  // 1c. MiniMax keys (`sk-api-…`).
  s = s.replace(/sk-api-[A-Za-z0-9._-]+/gi, REDACTED);
  // 1d. Google API keys (`AIza…`, ~39 chars) and JWTs (`eyJ…` three segments).
  s = s.replace(/AIza[0-9A-Za-z._-]{20,}/g, REDACTED);
  s = s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED);
  // 1e. Google-style `?key=`/`&key=` URL credential params.
  s = s.replace(/([?&]key=)[^&\s"',}]+/gi, `$1${REDACTED}`);
  // 1f. Base64-encoded secrets that decode to API key patterns.
  //     Match long base64 strings (40+ chars) and check if they decode to sk-*.
  s = s.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, (match) => {
    try {
      const decoded = Buffer.from(match, "base64").toString("utf-8");
      if (/^sk-[a-zA-Z0-9._-]{10,}/.test(decoded)) return REDACTED;
    } catch { /* not valid base64, leave as-is */ }
    return match;
  });
  // 2. Other OpenAI-style `sk-…` keys (length-gated to avoid masking prose).
  s = s.replace(/sk-[A-Za-z0-9]{20,}/gi, REDACTED);
  // 3. Authorization header values, with or without a `Bearer` prefix and in
  //    either `Authorization: x` or `"authorization":"x"` shapes.
  s = s.replace(/(authorization)(["']?\s*[:=]\s*["']?)(?:bearer\s+)?[^\s"',}]+/gi, `$1$2${REDACTED}`);
  // 4. Bare `Bearer <token>` tokens anywhere in the text — but only when the
  //    token looks like an actual credential (20+ chars), not common prose
  //    like "bearer of news" or "bearer of bad tidings".
  s = s.replace(/bearer\s+([A-Za-z0-9._~+/=-]{20,})/gi, `Bearer ${REDACTED}`);
  // 5. Secret-bearing env var assignments: OPENROUTER_API_KEY=…, FOO_TOKEN=…
  s = s.replace(
    /\b([A-Z][A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*)(\s*[:=]\s*)(["']?)[^\s"',}]+\3/gi,
    `$1$2${REDACTED}`,
  );
  // 6. Generic secret key/value fields: apiKey, api_key, apikey, token, secret,
  //    password — in JSON (`"token":"x"`) or shell (`token=x`) shapes.
  s = s.replace(
    /(["']?\b(?:api[_-]?key|apikey|token|secret|password)\b["']?\s*[:=]\s*["']?)[^\s"',}]+/gi,
    `$1${REDACTED}`,
  );
  return s;
}

/**
 * Recursively redact every string value in a JSON-serializable structure,
 * preserving shape. Used to scrub provider-error subtrees before they are
 * hashed into and persisted in an evidence bundle. (Audit H2.)
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redactSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}

function stringifySafely(input: unknown): string {
  if (input == null) return "";
  if (input instanceof Error) return input.message || String(input);
  if (typeof input === "object") {
    try {
      return JSON.stringify(input);
    } catch {
      return String(input);
    }
  }
  return String(input);
}

/**
 * The redacted projection of a provider error that is safe to print and to
 * persist in receipts/reports. Deliberately excludes `rawMessage`, `cause`,
 * request headers, and any raw env values.
 */
export interface SafeProviderError {
  provider: string | null;
  model: string | null;
  kind: string;
  origin: string;
  statusCode: number | null;
  /** Provider-supplied error code, redacted defensively. */
  code: string | null;
  /** Bucketed, secret-free summary (never the raw provider message). */
  message: string;
  /** Request id, only when it is short and demonstrably opaque. */
  requestId: string | null;
  retryable: boolean;
}

/**
 * A request id is only safe to surface when it cannot itself be a credential:
 * short, drawn from an opaque alphabet, and unchanged by redaction.
 */
function safeRequestId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = String(id);
  if (s.length === 0 || s.length > 128) return null;
  if (!/^[A-Za-z0-9._:-]+$/.test(s)) return null;
  if (redactSecrets(s) !== s) return null;
  return s;
}

/**
 * Project a {@link StructuredProviderError} onto the safe allow-list. Uses the
 * bucketed {@link providerErrorSummary} (not the raw message) as the message,
 * and runs every preserved string through {@link redactSecrets} defensively.
 */
export function safeProviderError(
  error: StructuredProviderError,
  model?: string | null,
): SafeProviderError {
  return {
    provider: error.provider ?? null,
    model: model ?? null,
    kind: error.kind,
    origin: error.origin,
    statusCode: error.statusCode ?? null,
    code: error.rawCode ? redactSecrets(error.rawCode) : null,
    message: redactSecrets(providerErrorSummary(error)),
    requestId: safeRequestId(error.requestId),
    retryable: !!error.retryable,
  };
}
