/**
 * Crucible — Circuit Breaker & Rate Limiter
 * Prevents cascading failures and retry storms against model providers.
 */

import { log } from "../utils/logger.js";

// ─── Circuit Breaker ───────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerConfig {
  failureThreshold: number;
  cooldownMs: number;
  successThreshold: number;
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  cooldownMs: 30_000,
  successThreshold: 3,
};

interface CircuitRecord {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number | null;
  openedAt: number | null;
}

const circuits = new Map<string, CircuitRecord>();

function getCircuit(id: string): CircuitRecord {
  let c = circuits.get(id);
  if (!c) {
    c = { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null };
    circuits.set(id, c);
  }
  return c;
}

export function getCircuitState(id: string): { state: CircuitState; failures: number; lastFailureAt: number | null } {
  const c = getCircuit(id);
  return { state: c.state, failures: c.failures, lastFailureAt: c.lastFailureAt };
}

/** Check if a request is allowed through the circuit breaker */
export function circuitAllow(id: string, config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG): boolean {
  const c = getCircuit(id);

  if (c.state === "closed") return true;

  if (c.state === "open") {
    if (c.openedAt && Date.now() - c.openedAt >= config.cooldownMs) {
      c.state = "half-open";
      c.successes = 0;
      log("info", "circuit-breaker", `Circuit ${id}: open -> half-open (cooldown expired)`);
      return true;
    }
    return false;
  }

  // half-open: allow through to test
  return true;
}

/** Record a successful request */
export function circuitSuccess(id: string, config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG): void {
  const c = getCircuit(id);

  if (c.state === "half-open") {
    c.successes++;
    if (c.successes >= config.successThreshold) {
      c.state = "closed";
      c.failures = 0;
      c.successes = 0;
      c.openedAt = null;
      log("info", "circuit-breaker", `Circuit ${id}: half-open -> closed (recovered)`);
    }
  } else {
    c.failures = 0;
  }
}

/** Record a failed request */
export function circuitFailure(id: string, config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG): void {
  const c = getCircuit(id);
  c.failures++;
  c.lastFailureAt = Date.now();

  if (c.state === "half-open") {
    c.state = "open";
    c.openedAt = Date.now();
    log("warn", "circuit-breaker", `Circuit ${id}: half-open -> open (test failed)`);
  } else if (c.failures >= config.failureThreshold) {
    c.state = "open";
    c.openedAt = Date.now();
    log("warn", "circuit-breaker", `Circuit ${id}: closed -> open (${c.failures} failures)`, {
      failureThreshold: config.failureThreshold,
    });
  }
}

/** Force-reset a circuit (manual recovery) */
export function circuitReset(id: string): void {
  circuits.set(id, { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null });
  log("info", "circuit-breaker", `Circuit ${id}: manually reset`);
}

// ─── Rate Limiter ──────────────────────────────────────────────────

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

// Ceiling meant to catch runaway loops, not throttle legitimate benchmarking.
// A single conversational run can issue 10-30 chat calls (one per step), and a
// user commonly fires a batch of 5-20 tasks back-to-back. The prior 30/60s
// cap pegged after the first batch. Paid APIs enforce their own per-key
// quotas upstream, so this local guard can sit much higher.
const DEFAULT_RATE_CONFIG: RateLimiterConfig = {
  maxRequests: 600,
  windowMs: 60_000,
};

interface RateRecord {
  requests: number[];
}

const rateLimiters = new Map<string, RateRecord>();

function getRateState(id: string): RateRecord {
  let s = rateLimiters.get(id);
  if (!s) {
    s = { requests: [] };
    rateLimiters.set(id, s);
  }
  return s;
}

/** Check if a request is within the rate limit */
export function rateLimitAllow(id: string, config: RateLimiterConfig = DEFAULT_RATE_CONFIG): boolean {
  const s = getRateState(id);
  const now = Date.now();
  const windowStart = now - config.windowMs;

  s.requests = s.requests.filter(t => t > windowStart);

  if (s.requests.length >= config.maxRequests) {
    log("warn", "rate-limiter", `Rate limit exceeded for ${id}`, {
      count: s.requests.length,
      limit: config.maxRequests,
      windowMs: config.windowMs,
    });
    return false;
  }

  s.requests.push(now);
  return true;
}

/** Get current rate limit status */
export function rateLimitStatus(id: string, config: RateLimiterConfig = DEFAULT_RATE_CONFIG): {
  count: number;
  limit: number;
  remaining: number;
  resetsInMs: number;
} {
  const s = getRateState(id);
  const now = Date.now();
  const windowStart = now - config.windowMs;
  const recent = s.requests.filter(t => t > windowStart);

  return {
    count: recent.length,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - recent.length),
    resetsInMs: recent.length > 0 ? Math.max(0, config.windowMs - (now - Math.min(...recent))) : 0,
  };
}

// ─── Combined protection wrapper ───────────────────────────────────

/**
 * Wrap an async operation with circuit breaker + rate limiter.
 * Throws with clear error messages when blocked.
 */
export async function runWithProtection<T>(adapterId: string, fn: () => Promise<T>): Promise<T> {
  if (!circuitAllow(adapterId)) {
    const cs = getCircuitState(adapterId);
    throw new Error(
      `Circuit breaker OPEN for adapter '${adapterId}' (${cs.failures} failures). ` +
      `Cooling down — retry after ${DEFAULT_CIRCUIT_CONFIG.cooldownMs / 1000}s. ` +
      `Check /api/health/adapters for status.`,
    );
  }

  if (!rateLimitAllow(adapterId)) {
    const rs = rateLimitStatus(adapterId);
    throw new Error(
      `Rate limit exceeded for adapter '${adapterId}' ` +
      `(${rs.count}/${rs.limit} in ${DEFAULT_RATE_CONFIG.windowMs / 1000}s window). ` +
      `Resets in ${Math.ceil(rs.resetsInMs / 1000)}s.`,
    );
  }

  try {
    const result = await fn();
    circuitSuccess(adapterId);
    return result;
  } catch (err) {
    circuitFailure(adapterId);
    throw err;
  }
}

/** Clear all state (for testing) */
export function clearAll(): void {
  circuits.clear();
  rateLimiters.clear();
}
