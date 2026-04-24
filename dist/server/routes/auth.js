import { sendJSON, parseJsonBody } from "./shared.js";
import { authStatus, getEffectiveToken, isLocalRequest, requireAuth } from "../auth.js";
import { issueSession, issuePairing, redeemPairing, revokeSession, validateSessionToken, } from "../auth-sessions.js";
function clientIp(req) {
    const fwd = req.headers["x-forwarded-for"];
    if (typeof fwd === "string" && fwd.length > 0) {
        const first = fwd.split(",")[0];
        if (first)
            return first.trim();
    }
    return req.socket.remoteAddress ?? "unknown";
}
function presentedSessionToken(req) {
    const h = req.headers["authorization"] ?? "";
    const m = h.match(/^Bearer\s+(.+)$/i);
    return m?.[1] ?? null;
}
// ── status ──────────────────────────────────────────────────────────────────
export async function handleAuthStatus(req, res) {
    const status = authStatus();
    // Capabilities the UI uses to decide which paths to surface on the auth
    // screen. The actual issuance still depends on loopback / current auth.
    sendJSON(res, 200, {
        authRequired: status.enabled,
        localAllowed: status.localAllowed,
        isLoopback: isLocalRequest(req),
        canBootstrapLocal: status.localAllowed && isLocalRequest(req),
        canPair: true,
        scheme: "Bearer",
    });
}
// ── bootstrap-local + legacy GET /bootstrap alias ──────────────────────────
async function bootstrapLocalImpl(req, res) {
    const status = authStatus();
    if (!status.localAllowed) {
        sendJSON(res, 403, { error: "bootstrap_disabled", reason: "CRUCIBULUM_ALLOW_LOCAL=false — bootstrap disabled" });
        return;
    }
    if (!isLocalRequest(req)) {
        sendJSON(res, 403, { error: "bootstrap_local_only", reason: "Bootstrap is only available to loopback clients" });
        return;
    }
    const session = issueSession({ deviceLabel: "loopback-desktop", issuedFrom: clientIp(req) });
    sendJSON(res, 200, {
        token: session.id,
        scheme: "Bearer",
        kind: "session",
        expiresAt: new Date(session.expiresAt).toISOString(),
    });
}
export async function handleAuthBootstrap(req, res) {
    await bootstrapLocalImpl(req, res);
}
export async function handleAuthBootstrapLocal(req, res) {
    await bootstrapLocalImpl(req, res);
}
// ── pairing ─────────────────────────────────────────────────────────────────
export async function handleAuthPairing(req, res) {
    // Pairing must be initiated from an already-authenticated context. That is
    // the protection against a remote attacker calling /pairing themselves and
    // then redeeming the result — they need an existing valid token first.
    if (!requireAuth(req, res))
        return;
    const pairing = issuePairing({ issuedFrom: clientIp(req) });
    // Build an absolute URL the desktop UI can render as a QR or share link.
    // Host comes from the request's Host header so URLs work for whatever
    // hostname the desktop browser used (e.g. 192.168.x.x for LAN pairing).
    const host = (req.headers["host"] ?? "localhost:18795").toString();
    const proto = (req.headers["x-forwarded-proto"] ?? "http").toString();
    const url = `${proto}://${host}/?pair=${encodeURIComponent(pairing.id)}`;
    sendJSON(res, 200, {
        code: pairing.code,
        token: pairing.id,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        expiresInSec: Math.round((pairing.expiresAt - Date.now()) / 1000),
        url,
    });
}
// ── redeem ──────────────────────────────────────────────────────────────────
export async function handleAuthRedeem(req, res) {
    // Public on purpose — the secret IS the pairing code/token. Brute-force
    // pressure is bounded by the rate limiter (RATE_INGEST below) and the
    // store-level redeem-attempt throttle.
    const parsed = await parseJsonBody(req);
    if (!parsed.ok) {
        sendJSON(res, 400, { error: parsed.error });
        return;
    }
    const body = (parsed.value ?? {});
    const code = typeof body.code === "string" ? body.code : undefined;
    const token = typeof body.token === "string" ? body.token : undefined;
    if (!code && !token) {
        sendJSON(res, 400, { error: "code or token is required" });
        return;
    }
    const result = redeemPairing({
        code,
        token,
        deviceLabel: typeof body.deviceLabel === "string" ? body.deviceLabel.slice(0, 64) : "paired-device",
        redeemedFrom: clientIp(req),
    });
    if (!result.ok || !result.session) {
        const status = result.reason === "too_many_attempts" ? 429
            : result.reason === "expired" ? 410
                : result.reason === "already_redeemed" ? 409
                    : 401;
        sendJSON(res, status, { error: "pairing_failed", reason: result.reason ?? "unknown" });
        return;
    }
    sendJSON(res, 200, {
        token: result.session.id,
        scheme: "Bearer",
        kind: "session",
        expiresAt: new Date(result.session.expiresAt).toISOString(),
    });
}
// ── logout ──────────────────────────────────────────────────────────────────
export async function handleAuthLogout(req, res) {
    if (!requireAuth(req, res))
        return;
    const presented = presentedSessionToken(req);
    if (presented) {
        // Best-effort: only revokes session-scope tokens. Master token / loopback
        // pass-through cannot be "logged out" via this endpoint.
        const session = validateSessionToken(presented);
        if (session) {
            revokeSession(session.id);
            sendJSON(res, 200, { ok: true, revoked: "session" });
            return;
        }
    }
    // Loopback-without-token or master-token requests: no session to revoke.
    sendJSON(res, 200, { ok: true, revoked: "none" });
}
// Re-export for the master-token-existence check used elsewhere.
export { getEffectiveToken };
//# sourceMappingURL=auth.js.map