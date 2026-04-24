/**
 * Crucible — API authentication
 *
 * Security posture (unchanged):
 *   - Loopback clients (127.0.0.1 / ::1) are allowed without a token when
 *     CRUCIBULUM_ALLOW_LOCAL is not "false".
 *   - Remote clients must present Authorization: Bearer <token>.
 *   - A configured env token wins over everything.
 *
 * What's new:
 *   - If no env token is configured, the server auto-generates one on first
 *     start and persists it to <state>/auth-token so it survives restarts.
 *     The generated token is printed once on startup with a bootstrap hint
 *     so mobile/remote users have a discoverable way to authenticate.
 *   - `getEffectiveToken()` exposes the effective token for the local-only
 *     /api/auth/bootstrap endpoint. Callers MUST gate access to that value
 *     behind `isLocalRequest()` before returning it over the wire.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
/**
 * Resolve the effective token. Precedence:
 *   1. CRUCIBULUM_API_TOKEN env var
 *   2. previously-persisted token at <state>/auth-token
 *   3. freshly generated token (persisted for next start)
 *
 * Memoized after first call. Safe to call repeatedly.
 */
export declare function getEffectiveToken(): string;
/**
 * Test-only helper — clears the memoized token and in-memory "generated" flag.
 * Production callers should never invoke this.
 */
export declare function __resetAuthForTests(): void;
export declare function isLocalRequest(req: IncomingMessage): boolean;
export interface AuthResult {
    ok: boolean;
    reason: string;
}
export declare function checkAuth(req: IncomingMessage): AuthResult;
export declare function requireAuth(req: IncomingMessage, res: ServerResponse): boolean;
/**
 * Auth surface for health / status endpoints. Intentionally never returns the
 * token itself — only whether one is required and whether local access is
 * allowed.
 */
export declare function authStatus(): {
    enabled: boolean;
    tokenConfigured: boolean;
    localAllowed: boolean;
};
/**
 * Print a one-time startup banner when the token was auto-generated, so the
 * operator can see what to paste into a mobile/remote client. Quiet when the
 * token came from the env var (the operator already knows it in that case).
 */
export declare function ensureTokenConfigured(): void;
//# sourceMappingURL=auth.d.ts.map