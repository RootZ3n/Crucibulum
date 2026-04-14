/**
 * Crucibulum — Lightweight in-memory rate limiter
 *
 * Simple token-bucket-per-key limiter. Not a replacement for a real gateway —
 * it exists to cap resource abuse on a single server instance (runaway client
 * loops, trivial flood attempts) while keeping dependencies at zero. If the
 * deployment grows beyond one process, move this to a real shared limiter.
 */
const BUCKETS_PER_RULE = new Map();
// Hard cap on tracked keys per rule so a flood of unique IPs cannot itself
// become a memory-exhaustion vector.
const MAX_KEYS_PER_RULE = 10_000;
export function clientKey(req) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) {
        const first = fwd.split(",")[0];
        if (first)
            return first.trim();
    }
    return req.socket.remoteAddress ?? "unknown";
}
function bucketsFor(rule) {
    let map = BUCKETS_PER_RULE.get(rule.name);
    if (!map) {
        map = new Map();
        BUCKETS_PER_RULE.set(rule.name, map);
    }
    return map;
}
/**
 * Check-and-increment against a rule. Returns `{ allowed, retryAfterSec }`.
 * Does not send a response itself; callers use `sendRateLimited` below.
 */
export function take(rule, key) {
    const now = Date.now();
    const buckets = bucketsFor(rule);
    // Opportunistic GC of expired buckets to bound memory.
    if (buckets.size > MAX_KEYS_PER_RULE) {
        for (const [k, b] of buckets) {
            if (b.resetAt <= now)
                buckets.delete(k);
            if (buckets.size <= MAX_KEYS_PER_RULE / 2)
                break;
        }
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + rule.windowMs };
        buckets.set(key, bucket);
    }
    bucket.count += 1;
    const allowed = bucket.count <= rule.limit;
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    const remaining = Math.max(0, rule.limit - bucket.count);
    return { allowed, retryAfterSec, remaining };
}
export function sendRateLimited(res, rule, retryAfterSec) {
    res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(retryAfterSec),
        "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({
        error: "rate_limited",
        rule: rule.name,
        retry_after_sec: retryAfterSec,
    }));
}
/**
 * Enforce a rule on an incoming request. Returns true if the request may
 * proceed, false if the handler already wrote a 429 and should stop.
 */
export function enforce(req, res, rule) {
    const result = take(rule, clientKey(req));
    // Advertise limit state for well-behaved clients.
    res.setHeader("X-RateLimit-Limit", String(rule.limit));
    res.setHeader("X-RateLimit-Remaining", String(result.remaining));
    if (!result.allowed) {
        sendRateLimited(res, rule, result.retryAfterSec);
        return false;
    }
    return true;
}
/** Test-only helper — clears all buckets so tests don't leak state into each other. */
export function __resetRateLimiterForTests() {
    BUCKETS_PER_RULE.clear();
}
// ── Default rules ────────────────────────────────────────────────────────────
//
// Conservative defaults: cheap reads get a generous bucket, mutating/expensive
// work (run, run-batch, run-suite, synthesis, ingest) gets a much tighter one.
// Values chosen to be comfortable for a human operator driving the UI and
// painful only for automated abuse.
export const RATE_READ = { name: "read", limit: 120, windowMs: 60_000 };
export const RATE_RUN = { name: "run", limit: 10, windowMs: 60_000 };
export const RATE_INGEST = { name: "ingest", limit: 30, windowMs: 60_000 };
//# sourceMappingURL=rate-limit.js.map