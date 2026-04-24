/**
 * Crucible — Session and pairing token store
 *
 * Two token kinds, both opaque random strings, both validated by lookup in
 * this store. They exist so the master server token never has to be exposed
 * to any UI:
 *
 *   session  — long-lived (default 30 days). Issued by trusted-loopback
 *              bootstrap or by redeeming a pairing code. Stored by the
 *              client and presented as `Authorization: Bearer <token>` on
 *              every request. Revocable.
 *
 *   pairing  — short-lived (default 5 minutes), single-use. Issued from a
 *              trusted desktop session so a phone can be paired without the
 *              user copying any raw bearer token. Comes with a 6-character
 *              human-typeable code AND the longer opaque token (used for
 *              QR / deep-link pairing). Either can be redeemed.
 *
 * Persistence: in-memory Map, snapshotted to <state>/auth-sessions.json
 * after every mutation. Atomic enough for one-process-per-host deployments
 * (which is the model Crucible uses).
 *
 * Audit: every issuance, redemption, expiry, and revocation goes through
 * `log("info"|"warn", "auth:session", ...)`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { log } from "../utils/logger.js";
export const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const DEFAULT_PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_PAIRING_REDEEM_ATTEMPTS = 12; // per-process throttle on /redeem brute force
// Crockford-style alphabet — drops 0/O/1/I/L/U for readability.
const PAIRING_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
function statePath() {
    return resolve(process.env["CRUCIBULUM_STATE_DIR"] ?? join(process.cwd(), "state"));
}
function storeFile() {
    return join(statePath(), "auth-sessions.json");
}
let store = new Map();
let codeIndex = new Map(); // code -> sessionId (pairing only)
let loaded = false;
let recentRedeemFailures = 0;
let recentRedeemFailureWindowStart = Date.now();
function loadIfNeeded() {
    if (loaded)
        return;
    loaded = true;
    try {
        const file = storeFile();
        if (!existsSync(file))
            return;
        const raw = readFileSync(file, "utf-8");
        const parsed = JSON.parse(raw);
        if (!parsed?.records)
            return;
        const now = Date.now();
        for (const rec of parsed.records) {
            // Drop expired/used pairings on load — they're useless and keeping them
            // grows the file unbounded.
            if (rec.expiresAt <= now)
                continue;
            if (rec.kind === "pairing" && rec.redeemed)
                continue;
            store.set(rec.id, rec);
            if (rec.kind === "pairing" && rec.code)
                codeIndex.set(rec.code, rec.id);
        }
        log("info", "auth:session", `Loaded ${store.size} session/pairing record(s)`);
    }
    catch (err) {
        log("warn", "auth:session", `Could not load session store: ${String(err)}`);
    }
}
function persist() {
    try {
        mkdirSync(statePath(), { recursive: true });
        const tmp = storeFile() + ".tmp";
        const records = Array.from(store.values());
        writeFileSync(tmp, JSON.stringify({ records }, null, 2) + "\n", { encoding: "utf-8", mode: 0o600 });
        renameSync(tmp, storeFile());
    }
    catch (err) {
        log("warn", "auth:session", `Could not persist session store: ${String(err)}`);
    }
}
function gc() {
    const now = Date.now();
    let removed = 0;
    for (const [id, rec] of store) {
        if (rec.expiresAt <= now) {
            store.delete(id);
            if (rec.code)
                codeIndex.delete(rec.code);
            removed++;
        }
    }
    if (removed > 0) {
        log("info", "auth:session", `Expired ${removed} record(s) during GC`);
        persist();
    }
}
function newOpaqueId() {
    // 32 bytes = 256 bits of entropy — far above brute-force horizon for
    // attacks against opaque session tokens.
    return randomBytes(32).toString("base64url");
}
function newPairingCode() {
    // 6 chars from a 32-symbol alphabet = 32^6 ≈ 1.07B combinations — combined
    // with the 5-minute TTL and the redeem-attempt throttle, far past any
    // realistic brute force window.
    const buf = randomBytes(6);
    let code = "";
    for (let i = 0; i < 6; i++) {
        code += PAIRING_ALPHABET[buf[i] % PAIRING_ALPHABET.length];
    }
    // Avoid collision with existing live codes.
    if (codeIndex.has(code))
        return newPairingCode();
    return code;
}
export function issueSession(input = {}) {
    loadIfNeeded();
    gc();
    const ttl = Math.max(60_000, input.ttlMs ?? DEFAULT_SESSION_TTL_MS);
    const now = Date.now();
    const rec = {
        id: newOpaqueId(),
        kind: "session",
        createdAt: now,
        expiresAt: now + ttl,
        deviceLabel: input.deviceLabel ?? "device",
        issuedFrom: input.issuedFrom ?? "unknown",
        lastSeenAt: now,
    };
    store.set(rec.id, rec);
    persist();
    log("info", "auth:session", `Issued session token`, { device: rec.deviceLabel, expiresAt: new Date(rec.expiresAt).toISOString(), from: rec.issuedFrom });
    return rec;
}
export function issuePairing(input = {}) {
    loadIfNeeded();
    gc();
    const ttl = Math.max(60_000, Math.min(input.ttlMs ?? DEFAULT_PAIRING_TTL_MS, 60 * 60_000));
    const now = Date.now();
    const rec = {
        id: newOpaqueId(),
        code: newPairingCode(),
        kind: "pairing",
        createdAt: now,
        expiresAt: now + ttl,
        redeemed: false,
        issuedFrom: input.issuedFrom ?? "unknown",
    };
    store.set(rec.id, rec);
    codeIndex.set(rec.code, rec.id);
    persist();
    log("info", "auth:session", `Issued pairing token`, { code: rec.code, expiresAt: new Date(rec.expiresAt).toISOString(), from: rec.issuedFrom });
    return rec;
}
/**
 * Redeem a pairing token by either its opaque id (used for QR/deep-link) or
 * its 6-char code (used for manual entry). On success, atomically marks the
 * pairing entry as redeemed and mints a fresh session token.
 */
export function redeemPairing(input) {
    loadIfNeeded();
    // Note: GC is intentionally deferred to AFTER lookup so an expired record
    // can return reason="expired" instead of being silently reaped into a
    // generic "not_found" — the difference matters to the UI.
    // Throttle brute-force attempts at the process level. Per-IP throttling
    // already exists in the rate limiter; this is defense in depth.
    const now = Date.now();
    if (now - recentRedeemFailureWindowStart > 60_000) {
        recentRedeemFailureWindowStart = now;
        recentRedeemFailures = 0;
    }
    if (recentRedeemFailures > MAX_PAIRING_REDEEM_ATTEMPTS) {
        log("warn", "auth:session", "Pairing redeem brute-force threshold hit, refusing further attempts this window");
        return { ok: false, reason: "too_many_attempts" };
    }
    let id;
    if (input.token)
        id = input.token;
    else if (input.code)
        id = codeIndex.get(input.code.trim().toUpperCase());
    if (!id) {
        recentRedeemFailures++;
        log("warn", "auth:session", "Pairing redemption failed: code/token not found", { from: input.redeemedFrom });
        return { ok: false, reason: "not_found" };
    }
    const rec = store.get(id);
    if (!rec || rec.kind !== "pairing") {
        recentRedeemFailures++;
        log("warn", "auth:session", "Pairing redemption failed: not a pairing record", { from: input.redeemedFrom });
        return { ok: false, reason: "not_found" };
    }
    if (rec.expiresAt <= now) {
        log("warn", "auth:session", "Pairing redemption failed: expired", { code: rec.code, from: input.redeemedFrom });
        // Drop the expired record so future GC cycles don't keep re-checking it.
        store.delete(rec.id);
        if (rec.code)
            codeIndex.delete(rec.code);
        persist();
        return { ok: false, reason: "expired" };
    }
    if (rec.redeemed) {
        recentRedeemFailures++;
        log("warn", "auth:session", "Pairing redemption failed: already redeemed", { code: rec.code, from: input.redeemedFrom });
        return { ok: false, reason: "already_redeemed" };
    }
    // Mint a fresh session for the redeeming device.
    const session = issueSession({
        deviceLabel: input.deviceLabel ?? "paired",
        issuedFrom: input.redeemedFrom ?? "unknown",
    });
    rec.redeemed = true;
    rec.redeemedAt = now;
    rec.redeemedSessionId = session.id;
    // Keep BOTH the record and the code -> id index entry until expiresAt so a
    // second attempt to redeem this code surfaces as "already_redeemed" rather
    // than a generic "not_found". GC purges the entire pairing on TTL expiry.
    persist();
    log("info", "auth:session", "Pairing redeemed", { code: rec.code, sessionId: session.id.slice(0, 8) + "…", device: session.deviceLabel, from: input.redeemedFrom });
    return { ok: true, session };
}
/**
 * Validate a presented bearer token. Returns the session record if valid and
 * not expired (and bumps lastSeen). For pairing tokens this does NOT count as
 * authentication — they are only valid input to `redeemPairing`.
 */
export function validateSessionToken(token) {
    loadIfNeeded();
    const rec = store.get(token);
    if (!rec)
        return null;
    if (rec.kind !== "session")
        return null;
    const now = Date.now();
    if (rec.expiresAt <= now) {
        store.delete(rec.id);
        persist();
        log("info", "auth:session", "Session token expired on use", { device: rec.deviceLabel });
        return null;
    }
    rec.lastSeenAt = now;
    // No persist on every read — would be wasteful. lastSeenAt is best-effort.
    return rec;
}
export function revokeSession(id) {
    loadIfNeeded();
    const rec = store.get(id);
    if (!rec)
        return false;
    store.delete(id);
    persist();
    log("info", "auth:session", "Session revoked", { device: rec.deviceLabel });
    return true;
}
export function listSessions() {
    loadIfNeeded();
    gc();
    return Array.from(store.values());
}
/** Test-only — clears every record and resets brute-force counters. */
export function __resetSessionsForTests() {
    store = new Map();
    codeIndex = new Map();
    loaded = false;
    recentRedeemFailures = 0;
    recentRedeemFailureWindowStart = Date.now();
}
//# sourceMappingURL=auth-sessions.js.map