/**
 * Luak — Retry-After parsing + provider-rate-limit backoff
 *
 * When a provider rate-limits us, two questions matter:
 *   1. how long did *they* ask us to wait? (RFC 9110 `Retry-After`)
 *   2. when the provider didn't tell us, how long should we wait?
 *
 * Both are pure functions; both are deterministic when callers pin the
 * jitter source. They live here instead of duplicating the math in the
 * UI and in adapters so the constants stay synchronised across layers.
 *
 * Defaults are intentionally polite — first hit waits ~10 s, third hit
 * waits ~80 s, and we cap at 120 s. Operators who want to tune this can
 * pass an override config.
 */

// ── Retry-After header parsing ──────────────────────────────────────────────

/**
 * RFC 9110 §10.2.3: `Retry-After` is either a non-negative integer
 * (seconds) or an HTTP-date. We accept both; anything else returns null.
 * Negative values are clamped to 0. Wildly large values are clamped to
 * the caller's `maxSeconds` ceiling — providers occasionally emit a year
 * in seconds and we don't want a benchmark batch stuck for a decade.
 */
export function parseRetryAfter(header: string | null | undefined, opts: { nowMs?: number; maxSeconds?: number } = {}): number | null {
  if (header == null) return null;
  const trimmed = String(header).trim();
  if (trimmed === "") return null;
  const maxSec = opts.maxSeconds ?? 24 * 60 * 60; // 24h ceiling
  const nowMs = opts.nowMs ?? Date.now();
  // delta-seconds form — purely numeric.
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec)) return null;
    return clamp(sec, 0, maxSec);
  }
  // HTTP-date form — RFC 1123 / RFC 850 / asctime. Date.parse handles all
  // three formats on every supported Node runtime.
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const deltaSec = Math.ceil((parsed - nowMs) / 1000);
  return clamp(deltaSec, 0, maxSec);
}

function clamp(value: number, lo: number, hi: number): number {
  if (Number.isNaN(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

// ── Backoff policy ──────────────────────────────────────────────────────────

export interface BackoffConfig {
  /** Floor of the first retry wait. Defaults to 10_000 ms. */
  minMs: number;
  /** Ceiling for any retry wait, including consecutive escalations. Defaults to 120_000 ms. */
  maxMs: number;
  /** Multiplier per consecutive rate-limit. Defaults to 2.5. */
  factor: number;
  /**
   * Jitter source returning a value in [0, 1). Pin to a constant for
   * deterministic tests (`() => 0`). Defaults to `Math.random`.
   */
  rng: () => number;
}

export function defaultBackoffConfig(overrides: Partial<BackoffConfig> = {}): BackoffConfig {
  return {
    // Bumped from 10s/120s after operator observation that real provider
    // (OpenRouter / DeepSeek-V4-Pro) per-minute quotas didn't clear within
    // a 10-15s wait. 30s minimum, 180s ceiling.
    minMs: 30_000,
    maxMs: 180_000,
    factor: 2,
    rng: Math.random,
    ...overrides,
  };
}

/**
 * Compute the next cooldown duration in milliseconds.
 *
 * Inputs:
 *   - `consecutiveCount` is 1 for the first rate-limit hit, 2 for the
 *     second consecutive one without a successful run in between, etc.
 *   - `retryAfterSec` is the provider's hint (null when unknown).
 *   - `config` tunes the floor/ceiling/factor.
 *
 * Behaviour:
 *   - If the provider supplies Retry-After, honour it (clamped to maxMs).
 *   - Otherwise: `minMs × factor^(consecutiveCount-1)`, clamped to maxMs,
 *     with ±20 % jitter to break thundering herds.
 */
export function computeBackoffMs(consecutiveCount: number, retryAfterSec: number | null | undefined, config: BackoffConfig): number {
  const safeCount = Math.max(1, Math.floor(consecutiveCount));
  // Provider hint wins, but never below our minimum (a provider that says
  // "wait 1s" against repeated rate-limits is asking us to thrash).
  if (typeof retryAfterSec === "number" && Number.isFinite(retryAfterSec) && retryAfterSec >= 0) {
    return Math.max(config.minMs, Math.min(config.maxMs, Math.ceil(retryAfterSec * 1000)));
  }
  const base = config.minMs * Math.pow(config.factor, safeCount - 1);
  const capped = Math.min(config.maxMs, base);
  // ±20% jitter around `capped`.
  const jitterRange = capped * 0.2;
  const jitter = (config.rng() * 2 - 1) * jitterRange;
  return Math.max(config.minMs, Math.min(config.maxMs, Math.round(capped + jitter)));
}

// ── Predicates ──────────────────────────────────────────────────────────────

/**
 * True if a structured provider-error or terminal SSE payload describes a
 * provider-side rate limit we should cool down for. Tolerates the loose
 * "provider says 429 but isn't tagged RATE_LIMIT" shape — some adapters
 * normalise 429 into AUTH or PROVIDER_FAILURE with statusCode preserved.
 */
export function isRateLimitError(provider_error: { kind?: string; statusCode?: number | null } | null | undefined): boolean {
  if (!provider_error) return false;
  if (provider_error.kind === "RATE_LIMIT") return true;
  if (provider_error.statusCode === 429) return true;
  return false;
}
