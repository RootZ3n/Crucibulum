/**
 * Crucibulum — Circuit Breaker & Rate Limiter
 * Prevents cascading failures and retry storms against model providers.
 */
import { log } from "../utils/logger.js";
const DEFAULT_CIRCUIT_CONFIG = {
    failureThreshold: 5,
    cooldownMs: 30_000,
    successThreshold: 3,
};
const circuits = new Map();
function getCircuit(id) {
    let c = circuits.get(id);
    if (!c) {
        c = { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null };
        circuits.set(id, c);
    }
    return c;
}
export function getCircuitState(id) {
    const c = getCircuit(id);
    return { state: c.state, failures: c.failures, lastFailureAt: c.lastFailureAt };
}
/** Check if a request is allowed through the circuit breaker */
export function circuitAllow(id, config = DEFAULT_CIRCUIT_CONFIG) {
    const c = getCircuit(id);
    if (c.state === "closed")
        return true;
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
export function circuitSuccess(id, config = DEFAULT_CIRCUIT_CONFIG) {
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
    }
    else {
        c.failures = 0;
    }
}
/** Record a failed request */
export function circuitFailure(id, config = DEFAULT_CIRCUIT_CONFIG) {
    const c = getCircuit(id);
    c.failures++;
    c.lastFailureAt = Date.now();
    if (c.state === "half-open") {
        c.state = "open";
        c.openedAt = Date.now();
        log("warn", "circuit-breaker", `Circuit ${id}: half-open -> open (test failed)`);
    }
    else if (c.failures >= config.failureThreshold) {
        c.state = "open";
        c.openedAt = Date.now();
        log("warn", "circuit-breaker", `Circuit ${id}: closed -> open (${c.failures} failures)`, {
            failureThreshold: config.failureThreshold,
        });
    }
}
/** Force-reset a circuit (manual recovery) */
export function circuitReset(id) {
    circuits.set(id, { state: "closed", failures: 0, successes: 0, lastFailureAt: null, openedAt: null });
    log("info", "circuit-breaker", `Circuit ${id}: manually reset`);
}
const DEFAULT_RATE_CONFIG = {
    maxRequests: 30,
    windowMs: 60_000,
};
const rateLimiters = new Map();
function getRateState(id) {
    let s = rateLimiters.get(id);
    if (!s) {
        s = { requests: [] };
        rateLimiters.set(id, s);
    }
    return s;
}
/** Check if a request is within the rate limit */
export function rateLimitAllow(id, config = DEFAULT_RATE_CONFIG) {
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
export function rateLimitStatus(id, config = DEFAULT_RATE_CONFIG) {
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
export async function runWithProtection(adapterId, fn) {
    if (!circuitAllow(adapterId)) {
        const cs = getCircuitState(adapterId);
        throw new Error(`Circuit breaker OPEN for adapter '${adapterId}' (${cs.failures} failures). ` +
            `Cooling down — retry after ${DEFAULT_CIRCUIT_CONFIG.cooldownMs / 1000}s. ` +
            `Check /api/health/adapters for status.`);
    }
    if (!rateLimitAllow(adapterId)) {
        const rs = rateLimitStatus(adapterId);
        throw new Error(`Rate limit exceeded for adapter '${adapterId}' ` +
            `(${rs.count}/${rs.limit} in ${DEFAULT_RATE_CONFIG.windowMs / 1000}s window). ` +
            `Resets in ${Math.ceil(rs.resetsInMs / 1000)}s.`);
    }
    try {
        const result = await fn();
        circuitSuccess(adapterId);
        return result;
    }
    catch (err) {
        circuitFailure(adapterId);
        throw err;
    }
}
/** Clear all state (for testing) */
export function clearAll() {
    circuits.clear();
    rateLimiters.clear();
}
//# sourceMappingURL=circuit-breaker.js.map