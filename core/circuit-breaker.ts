/**
 * Luak — Circuit Breaker & Rate Limiter
 * Prevents cascading failures and retry storms against model providers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { log } from "../utils/logger.js";
import { luakStateRoot } from "../utils/env.js";

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

// ─── Persistence (Audit C3) ─────────────────────────────────────────
//
// Circuit state was module-level only: a restart reset every circuit to
// CLOSED, so a provider mid-cooldown got hammered again the instant the
// process came back — escalating a 30s rate-limit into a longer ban or key
// revocation. We now persist {state, openedAt, failureCount, lastFailureAt}
// to state/circuit-breaker.json on every transition and reload it on startup.
// Because openedAt is an absolute timestamp, the cooldown check in
// circuitAllow() honors elapsed real time across restarts — a circuit opened
// 5s before a crash still has ~25s left after reboot, not a fresh 30s.

interface PersistedCircuit {
  state: CircuitState;
  openedAt: number | null;
  failureCount: number;
  lastFailureAt: number | null;
}

let loaded = false;

function persistDisabled(): boolean {
  return process.env["LUAK_DISABLE_CIRCUIT_PERSIST"] === "1";
}

function circuitStateFile(): string {
  return process.env["LUAK_CIRCUIT_STATE_FILE"] ?? join(luakStateRoot(), "circuit-breaker.json");
}

function loadFromDisk(): void {
  if (persistDisabled()) return;
  const file = circuitStateFile();
  if (!existsSync(file)) return;
  try {
    const raw = JSON.parse(readFileSync(file, "utf-8")) as Record<string, PersistedCircuit>;
    let count = 0;
    for (const [id, rec] of Object.entries(raw)) {
      if (!rec || typeof rec !== "object") continue;
      circuits.set(id, {
        state: rec.state === "open" || rec.state === "half-open" || rec.state === "closed" ? rec.state : "closed",
        failures: typeof rec.failureCount === "number" ? rec.failureCount : 0,
        successes: 0, // half-open success tally is transient; never persisted
        lastFailureAt: typeof rec.lastFailureAt === "number" ? rec.lastFailureAt : null,
        openedAt: typeof rec.openedAt === "number" ? rec.openedAt : null,
      });
      count++;
    }
    if (count > 0) log("info", "circuit-breaker", `Loaded ${count} persisted circuit(s) from ${file}`);
  } catch (err) {
    log("warn", "circuit-breaker", `Could not load persisted circuit state: ${String(err)} — starting clean`);
  }
}

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  loadFromDisk();
}

function persist(): void {
  if (persistDisabled()) return;
  try {
    const file = circuitStateFile();
    mkdirSync(dirname(file), { recursive: true });
    const out: Record<string, PersistedCircuit> = {};
    for (const [id, c] of circuits) {
      out[id] = { state: c.state, openedAt: c.openedAt, failureCount: c.failures, lastFailureAt: c.lastFailureAt };
    }
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(out, null, 2));
    renameSync(tmp, file);
  } catch (err) {
    log("warn", "circuit-breaker", `Could not persist circuit state: ${String(err)}`);
  }
}

/**
 * Explicitly load persisted circuit state. Called from server startup so the
 * load (and its log line) happens deterministically at boot rather than on the
 * first provider call. Idempotent.
 */
export function initCircuitBreaker(): void {
  ensureLoaded();
}

function getCircuit(id: string): CircuitRecord {
  ensureLoaded();
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
      log("info", "circuit-breaker", `Circuit breaker: ${id} OPEN → HALF-OPEN (cooldown expired)`);
      persist();
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
      log("info", "circuit-breaker", `Circuit breaker: ${id} HALF-OPEN → CLOSED (recovered)`);
      persist();
    }
  } else if (c.failures !== 0) {
    c.failures = 0;
    persist();
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
    log("warn", "circuit-breaker", `Circuit breaker: ${id} HALF-OPEN → OPEN (test failed)`);
  } else if (c.failures >= config.failureThreshold && c.state !== "open") {
    c.state = "open";
    c.openedAt = Date.now();
    log("warn", "circuit-breaker", `Circuit breaker: ${id} CLOSED → OPEN (${c.failures} failures)`, {
      failureThreshold: config.failureThreshold,
    });
  }
  // Persist on every failure: even when no state transition occurs the
  // failureCount/lastFailureAt advance, and a restart must not reset that
  // progress toward the threshold.
  persist();
}

/** Force-reset a circuit (manual recovery) */
export function circuitReset(id: string): void {
  ensureLoaded();
  circuits.set(id, { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null });
  log("info", "circuit-breaker", `Circuit breaker: ${id} manually reset`);
  persist();
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

/**
 * Clear all in-memory state (for testing). Does NOT delete the persisted file —
 * resetting `loaded` means the next access reloads from disk, which is exactly
 * the "fresh process, same state file" restart simulation the C3 test needs.
 * Under the test runner persistence is disabled (LUAK_DISABLE_CIRCUIT_PERSIST=1),
 * so for every other suite this is a pure in-memory wipe as before.
 */
export function clearAll(): void {
  circuits.clear();
  rateLimiters.clear();
  loaded = false;
}
