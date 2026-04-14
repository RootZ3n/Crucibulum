/**
 * Crucibulum — API Authentication
 * Token-based auth via CRUCIBULUM_API_TOKEN env var.
 * Local requests allowed without token by default.
 */
import { log } from "../utils/logger.js";
const API_TOKEN = process.env["CRUCIBULUM_API_TOKEN"]?.trim() || "";
const ALLOW_LOCAL = process.env["CRUCIBULUM_ALLOW_LOCAL"] !== "false";
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);
export function checkAuth(req) {
    // Determine the connecting address
    const remoteAddr = req.socket.remoteAddress ?? "";
    const isLocal = LOCAL_HOSTS.has(remoteAddr) || remoteAddr.startsWith("127.") || remoteAddr === "::ffff:127.0.0.1";
    if (isLocal && ALLOW_LOCAL) {
        return { ok: true, reason: "local" };
    }
    // Token auth
    if (API_TOKEN) {
        const authHeader = req.headers["authorization"] ?? "";
        const match = authHeader.match(/^Bearer\s+(.+)$/i);
        if (match && match[1] === API_TOKEN) {
            return { ok: true, reason: "token" };
        }
        log("warn", "auth", "Authentication failed", {
            remoteAddr,
            hasAuthHeader: !!authHeader,
            path: req.url,
        });
        return { ok: false, reason: "invalid_or_missing_token" };
    }
    // No token configured and not local — reject
    return { ok: false, reason: "no_token_configured_for_remote_access" };
}
/** Send 401 and return false if unauthorized; return true if OK */
export function requireAuth(req, res) {
    const result = checkAuth(req);
    if (!result.ok) {
        log("warn", "auth", `Rejected request: ${result.reason}`, { path: req.url });
        res.writeHead(401, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "WWW-Authenticate": "Bearer",
        });
        res.end(JSON.stringify({ error: "Unauthorized", reason: result.reason }));
        return false;
    }
    return true;
}
/** Auth status for health endpoints */
export function authStatus() {
    return {
        enabled: !!API_TOKEN || !ALLOW_LOCAL,
        tokenConfigured: !!API_TOKEN,
        localAllowed: ALLOW_LOCAL,
    };
}
//# sourceMappingURL=auth.js.map