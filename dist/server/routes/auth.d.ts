/**
 * Crucible — Auth bootstrap and pairing routes
 *
 * Endpoints (all under /api/auth/*):
 *
 *   GET  /status            public.   What does this instance require?
 *   POST /bootstrap-local   loopback. Issue a fresh session for the local
 *                                     desktop. Master token is never returned.
 *   GET  /bootstrap         loopback. Backwards-compat alias for the previous
 *                                     pass — same behavior as bootstrap-local.
 *   POST /pairing           authed.   Issue a short-lived 6-char pairing code +
 *                                     long opaque token for QR/deep-link.
 *   POST /redeem            public.   Redeem a pairing code/token, mint a
 *                                     session for the pairing device. Single-
 *                                     use; rate-limited; throttled in store.
 *   POST /logout            authed.   Revoke the presented session token.
 *
 * Security contract:
 *   - The master token (env or auto-generated) NEVER leaves the server via
 *     these endpoints. Bootstrap returns a session token instead.
 *   - Pairing tokens are short-lived (5 min default) and single-use.
 *   - /redeem is the only handler that mints a session without prior auth —
 *     it is gated on the secret pairing token/code which the pairing
 *     issuance handler already required auth to obtain.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { getEffectiveToken } from "../auth.js";
export declare function handleAuthStatus(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAuthBootstrap(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAuthBootstrapLocal(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAuthPairing(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAuthRedeem(req: IncomingMessage, res: ServerResponse): Promise<void>;
export declare function handleAuthLogout(req: IncomingMessage, res: ServerResponse): Promise<void>;
export { getEffectiveToken };
//# sourceMappingURL=auth.d.ts.map