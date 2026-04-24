/**
 * Crucible — Lightweight in-memory rate limiter
 *
 * Simple token-bucket-per-key limiter. Not a replacement for a real gateway —
 * it exists to cap resource abuse on a single server instance (runaway client
 * loops, trivial flood attempts) while keeping dependencies at zero. If the
 * deployment grows beyond one process, move this to a real shared limiter.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export interface RateLimitRule {
    /** Human label used in logs and the 429 response. */
    name: string;
    /** Maximum requests allowed in the window. */
    limit: number;
    /** Window size in milliseconds. */
    windowMs: number;
}
export declare function clientKey(req: IncomingMessage): string;
/**
 * Check-and-increment against a rule. Returns `{ allowed, retryAfterSec }`.
 * Does not send a response itself; callers use `sendRateLimited` below.
 */
export declare function take(rule: RateLimitRule, key: string): {
    allowed: boolean;
    retryAfterSec: number;
    remaining: number;
};
export declare function sendRateLimited(res: ServerResponse, rule: RateLimitRule, retryAfterSec: number): void;
/**
 * Enforce a rule on an incoming request. Returns true if the request may
 * proceed, false if the handler already wrote a 429 and should stop.
 */
export declare function enforce(req: IncomingMessage, res: ServerResponse, rule: RateLimitRule): boolean;
/** Test-only helper — clears all buckets so tests don't leak state into each other. */
export declare function __resetRateLimiterForTests(): void;
export declare const RATE_READ: RateLimitRule;
export declare const RATE_RUN: RateLimitRule;
export declare const RATE_INGEST: RateLimitRule;
//# sourceMappingURL=rate-limit.d.ts.map