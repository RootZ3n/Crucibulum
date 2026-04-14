/**
 * Crucibulum — API Authentication
 * Token-based auth via CRUCIBULUM_API_TOKEN env var.
 * Local requests allowed without token by default.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
export interface AuthResult {
    ok: boolean;
    reason: string;
}
export declare function checkAuth(req: IncomingMessage): AuthResult;
/** Send 401 and return false if unauthorized; return true if OK */
export declare function requireAuth(req: IncomingMessage, res: ServerResponse): boolean;
/** Auth status for health endpoints */
export declare function authStatus(): {
    enabled: boolean;
    tokenConfigured: boolean;
    localAllowed: boolean;
};
//# sourceMappingURL=auth.d.ts.map