/**
 * Crucible — Retry-After parsing + backoff regression
 *
 * These pins live with the helpers because the UI cooldown logic and any
 * future server-side retry policy both consume them. Tests stay
 * deterministic by pinning the jitter source where backoff is involved.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseRetryAfter,
  computeBackoffMs,
  defaultBackoffConfig,
  isRateLimitError,
} from "../core/retry-after.js";

// ── parseRetryAfter ─────────────────────────────────────────────────────────

describe("parseRetryAfter", () => {
  it("seconds form: '30' → 30", () => {
    assert.equal(parseRetryAfter("30"), 30);
  });

  it("seconds form: '0' → 0", () => {
    assert.equal(parseRetryAfter("0"), 0);
  });

  it("seconds form: surrounding whitespace tolerated", () => {
    assert.equal(parseRetryAfter("   45  "), 45);
  });

  it("HTTP-date form: future date → positive seconds", () => {
    const nowMs = Date.parse("Sun, 06 Nov 1994 08:49:37 GMT");
    const headerDate = "Sun, 06 Nov 1994 08:49:47 GMT"; // 10 s in future
    assert.equal(parseRetryAfter(headerDate, { nowMs }), 10);
  });

  it("HTTP-date form: past date clamps to 0", () => {
    const nowMs = Date.parse("Sun, 06 Nov 1994 08:50:00 GMT");
    const headerDate = "Sun, 06 Nov 1994 08:49:00 GMT"; // 60s ago
    assert.equal(parseRetryAfter(headerDate, { nowMs }), 0);
  });

  it("invalid / missing / blank → null", () => {
    assert.equal(parseRetryAfter(null), null);
    assert.equal(parseRetryAfter(undefined), null);
    assert.equal(parseRetryAfter(""), null);
    assert.equal(parseRetryAfter("   "), null);
    assert.equal(parseRetryAfter("not-a-number"), null);
    assert.equal(parseRetryAfter("12abc"), null);
  });

  it("clamps absurdly large values to the supplied ceiling", () => {
    // Default ceiling is 24h = 86400 seconds.
    assert.equal(parseRetryAfter("99999999"), 86_400);
    assert.equal(parseRetryAfter("99999999", { maxSeconds: 60 }), 60);
  });

  it("non-digit-only strings that happen to be parseable falls through to HTTP-date branch and clamps to 0 (no negative results)", () => {
    // delta-seconds is digits-only per RFC; "-5" fails the digit-only test
    // and falls through to Date.parse, which on most engines parses it as
    // an epoch-relative timestamp. The result is clamped to [0, maxSec] so
    // a negative figure never escapes. The pin matters: parseRetryAfter
    // must NEVER return a negative number; callers depend on that.
    const result = parseRetryAfter("-5");
    assert.ok(result === null || (typeof result === "number" && result >= 0), `expected null or non-negative; got ${result}`);
  });
});

// ── computeBackoffMs ────────────────────────────────────────────────────────

describe("computeBackoffMs", () => {
  it("first hit returns ~minMs (no provider hint, jitter=0)", () => {
    const cfg = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0.5 });
    // rng=0.5 → jitter contribution = 0 (the midpoint of [-1, +1]).
    const wait = computeBackoffMs(1, null, cfg);
    assert.equal(wait, 10_000);
  });

  it("second consecutive hit scales by factor", () => {
    const cfg = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0.5 });
    const wait = computeBackoffMs(2, null, cfg);
    assert.equal(wait, 25_000);
  });

  it("third consecutive hit continues to scale", () => {
    const cfg = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0.5 });
    const wait = computeBackoffMs(3, null, cfg);
    assert.equal(wait, 62_500);
  });

  it("ceiling caps consecutive scaling", () => {
    const cfg = defaultBackoffConfig({ minMs: 10_000, maxMs: 30_000, factor: 2.5, rng: () => 0.5 });
    const wait = computeBackoffMs(10, null, cfg);
    assert.equal(wait, 30_000);
  });

  it("provider Retry-After hint wins over computed backoff", () => {
    const cfg = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0.5 });
    const wait = computeBackoffMs(5, 7, cfg); // provider says 7s, but minMs is 10s
    assert.equal(wait, 10_000, "provider hint is clamped up to minMs");

    const longWait = computeBackoffMs(5, 90, cfg); // provider says 90s
    assert.equal(longWait, 90_000);

    const tooLong = computeBackoffMs(5, 500, cfg); // provider says 500s but ceiling is 120s
    assert.equal(tooLong, 120_000);
  });

  it("jitter stays within ±20% of capped base", () => {
    // Pin a deterministic rng that returns the extremes; verify clamping
    // keeps results inside [minMs, maxMs].
    const cfgLow = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0 });   // -20% jitter
    const cfgHigh = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0.999 }); // +~20% jitter
    const low = computeBackoffMs(2, null, cfgLow);  // base = 25000, jitter = -5000 → 20000
    const high = computeBackoffMs(2, null, cfgHigh); // base = 25000, jitter ≈ +5000 → ~30000
    assert.ok(low >= 10_000 && low <= 120_000, `low=${low} out of bounds`);
    assert.ok(high >= 10_000 && high <= 120_000, `high=${high} out of bounds`);
    assert.equal(low, 20_000);
  });

  it("never returns below minMs even with negative jitter", () => {
    const cfg = defaultBackoffConfig({ minMs: 10_000, maxMs: 120_000, factor: 2.5, rng: () => 0 });
    const wait = computeBackoffMs(1, null, cfg); // base = 10000, jitter = -2000 → would be 8000 but clamped to 10000
    assert.equal(wait, 10_000);
  });
});

// ── isRateLimitError ───────────────────────────────────────────────────────

describe("isRateLimitError", () => {
  it("kind = RATE_LIMIT → true", () => {
    assert.equal(isRateLimitError({ kind: "RATE_LIMIT" }), true);
  });

  it("statusCode 429 → true even when kind is not normalised", () => {
    assert.equal(isRateLimitError({ statusCode: 429 }), true);
    assert.equal(isRateLimitError({ kind: "PROVIDER_FAILURE", statusCode: 429 }), true);
  });

  it("non-rate-limit error → false", () => {
    assert.equal(isRateLimitError({ kind: "AUTH", statusCode: 401 }), false);
    assert.equal(isRateLimitError({ kind: "HTTP_5XX", statusCode: 503 }), false);
  });

  it("null / undefined → false", () => {
    assert.equal(isRateLimitError(null), false);
    assert.equal(isRateLimitError(undefined), false);
  });
});
