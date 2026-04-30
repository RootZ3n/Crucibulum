/**
 * Crucible — API authentication
 *
 * Security posture (unchanged):
 *   - Loopback clients (127.0.0.1 / ::1) are allowed without a token when
 *     CRUCIBLE_ALLOW_LOCAL / CRUCIBULUM_ALLOW_LOCAL is not "false".
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { log } from "../utils/logger.js";
import { crucibleStateRoot, envValue } from "../utils/env.js";
import { validateSessionToken } from "./auth-sessions.js";

// Paths are resolved lazily so tests (which set env vars before each test,
// inside one node process) get the STATE_DIR they asked for. A top-level
// const would capture whatever env the first test saw.
function stateDir(): string {
  return crucibleStateRoot();
}
function tokenFile(): string {
  return join(stateDir(), "auth-token");
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

let effectiveToken: string | null = null;
let tokenWasGenerated = false;

function allowLocal(): boolean {
  return envValue("CRUCIBLE_ALLOW_LOCAL", "CRUCIBULUM_ALLOW_LOCAL") !== "false";
}

/**
 * Resolve the effective token. Precedence:
 *   1. CRUCIBLE_API_TOKEN / CRUCIBULUM_API_TOKEN env var
 *   2. previously-persisted token at <state>/auth-token
 *   3. freshly generated token (persisted for next start)
 *
 * Memoized after first call. Safe to call repeatedly.
 */
export function getEffectiveToken(): string {
  if (effectiveToken !== null) return effectiveToken;
  const envToken = envValue("CRUCIBLE_API_TOKEN", "CRUCIBULUM_API_TOKEN");
  if (envToken && envToken.length > 0) {
    effectiveToken = envToken;
    tokenWasGenerated = false;
    return effectiveToken;
  }
  const file = tokenFile();
  try {
    if (existsSync(file)) {
      const stored = readFileSync(file, "utf-8").trim();
      if (stored.length > 0) {
        effectiveToken = stored;
        tokenWasGenerated = false;
        return effectiveToken;
      }
    }
  } catch { /* fall through to generation */ }

  // Generate + persist.
  const fresh = randomBytes(24).toString("base64url");
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(file, fresh + "\n", { encoding: "utf-8", mode: 0o600 });
  } catch (err) {
    log("warn", "auth", `Could not persist generated token (${String(err)}); token will change on restart`);
  }
  effectiveToken = fresh;
  tokenWasGenerated = true;
  return effectiveToken;
}

/**
 * Test-only helper — clears the memoized token and in-memory "generated" flag.
 * Production callers should never invoke this.
 */
export function __resetAuthForTests(): void {
  effectiveToken = null;
  tokenWasGenerated = false;
}

export function isLocalRequest(req: IncomingMessage): boolean {
  const remoteAddr = req.socket.remoteAddress ?? "";
  return LOCAL_HOSTS.has(remoteAddr) || remoteAddr.startsWith("127.") || remoteAddr === "::ffff:127.0.0.1";
}

export interface AuthResult {
  ok: boolean;
  reason: string;
}

export function checkAuth(req: IncomingMessage): AuthResult {
  const isLocal = isLocalRequest(req);
  if (isLocal && allowLocal()) return { ok: true, reason: "local" };

  const masterToken = getEffectiveToken();
  const authHeader = req.headers["authorization"] ?? "";
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  const presented = match?.[1];

  if (presented) {
    // Master token (server's long-term root). Used by operators / scripts /
    // the manual "Advanced" fallback path. Rare in normal UI use.
    if (masterToken && presented === masterToken) {
      return { ok: true, reason: "token" };
    }
    // Session token issued via local bootstrap or pairing redemption. This is
    // the common path for both desktop and paired mobile clients.
    const session = validateSessionToken(presented);
    if (session) return { ok: true, reason: "session" };
  }

  if (!masterToken) return { ok: false, reason: "no_token_configured_for_remote_access" };
  log("warn", "auth", "Authentication failed", {
    remoteAddr: req.socket.remoteAddress,
    hasAuthHeader: !!authHeader,
    path: req.url,
  });
  return { ok: false, reason: "invalid_or_missing_token" };
}

export function requireAuth(req: IncomingMessage, res: ServerResponse): boolean {
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

/**
 * Auth surface for health / status endpoints. Intentionally never returns the
 * token itself — only whether one is required and whether local access is
 * allowed.
 */
export function authStatus(): { enabled: boolean; tokenConfigured: boolean; localAllowed: boolean } {
  const token = getEffectiveToken();
  return {
    enabled: !!token || !allowLocal(),
    tokenConfigured: !!token,
    localAllowed: allowLocal(),
  };
}

/**
 * Print a one-time startup banner when the token was auto-generated, so the
 * operator can see what to paste into a mobile/remote client. Quiet when the
 * token came from the env var (the operator already knows it in that case).
 */
export function ensureTokenConfigured(): void {
  const token = getEffectiveToken();
  if (!tokenWasGenerated) {
    log("info", "auth", `Auth token loaded (env or persisted) — local requests bypass token`);
    return;
  }
  const line = "━".repeat(60);
  // Logged via log() so operators running with log redirection still see it.
  log("info", "auth", line);
  log("info", "auth", "Auth token auto-generated. Paste this into a remote/mobile client:");
  log("info", "auth", `  ${token}`);
  log("info", "auth", `(persisted at ${tokenFile()} — delete that file to rotate)`);
  log("info", "auth", "Local requests bypass the token automatically.");
  log("info", "auth", line);
}
