/**
 * Crucibulum — Circuit Breaker & Rate Limiter
 * Prevents cascading failures and retry storms against model providers.
 */
export type CircuitState = "closed" | "open" | "half-open";
export interface CircuitBreakerConfig {
    failureThreshold: number;
    cooldownMs: number;
    successThreshold: number;
}
export declare function getCircuitState(id: string): {
    state: CircuitState;
    failures: number;
    lastFailureAt: number | null;
};
/** Check if a request is allowed through the circuit breaker */
export declare function circuitAllow(id: string, config?: CircuitBreakerConfig): boolean;
/** Record a successful request */
export declare function circuitSuccess(id: string, config?: CircuitBreakerConfig): void;
/** Record a failed request */
export declare function circuitFailure(id: string, config?: CircuitBreakerConfig): void;
/** Force-reset a circuit (manual recovery) */
export declare function circuitReset(id: string): void;
export interface RateLimiterConfig {
    maxRequests: number;
    windowMs: number;
}
/** Check if a request is within the rate limit */
export declare function rateLimitAllow(id: string, config?: RateLimiterConfig): boolean;
/** Get current rate limit status */
export declare function rateLimitStatus(id: string, config?: RateLimiterConfig): {
    count: number;
    limit: number;
    remaining: number;
    resetsInMs: number;
};
/**
 * Wrap an async operation with circuit breaker + rate limiter.
 * Throws with clear error messages when blocked.
 */
export declare function runWithProtection<T>(adapterId: string, fn: () => Promise<T>): Promise<T>;
/** Clear all state (for testing) */
export declare function clearAll(): void;
//# sourceMappingURL=circuit-breaker.d.ts.map