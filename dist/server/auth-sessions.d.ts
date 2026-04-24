export type TokenKind = "session" | "pairing";
export interface SessionRecord {
    id: string;
    kind: TokenKind;
    /** Optional 6-char human-typeable code; only set on `pairing`. */
    code?: string | undefined;
    createdAt: number;
    expiresAt: number;
    /** Pairing entries flip to true after redemption (single-use). */
    redeemed?: boolean | undefined;
    /** Pairing entries record the session id they minted on redeem. */
    redeemedSessionId?: string | undefined;
    redeemedAt?: number | undefined;
    /** Free-form short label set by the issuer (e.g. "loopback", "paired").  */
    deviceLabel?: string | undefined;
    lastSeenAt?: number | undefined;
    /** Source IP captured at issuance time, audit-only. */
    issuedFrom?: string | undefined;
}
export declare const DEFAULT_SESSION_TTL_MS: number;
export declare const DEFAULT_PAIRING_TTL_MS: number;
export interface IssueSessionInput {
    ttlMs?: number;
    deviceLabel?: string;
    issuedFrom?: string;
}
export declare function issueSession(input?: IssueSessionInput): SessionRecord;
export interface IssuePairingInput {
    ttlMs?: number;
    issuedFrom?: string;
}
export declare function issuePairing(input?: IssuePairingInput): SessionRecord;
export interface RedeemResult {
    ok: boolean;
    reason?: string;
    session?: SessionRecord;
}
/**
 * Redeem a pairing token by either its opaque id (used for QR/deep-link) or
 * its 6-char code (used for manual entry). On success, atomically marks the
 * pairing entry as redeemed and mints a fresh session token.
 */
export declare function redeemPairing(input: {
    code?: string | undefined;
    token?: string | undefined;
    deviceLabel?: string | undefined;
    redeemedFrom?: string | undefined;
}): RedeemResult;
/**
 * Validate a presented bearer token. Returns the session record if valid and
 * not expired (and bumps lastSeen). For pairing tokens this does NOT count as
 * authentication — they are only valid input to `redeemPairing`.
 */
export declare function validateSessionToken(token: string): SessionRecord | null;
export declare function revokeSession(id: string): boolean;
export declare function listSessions(): SessionRecord[];
/** Test-only — clears every record and resets brute-force counters. */
export declare function __resetSessionsForTests(): void;
//# sourceMappingURL=auth-sessions.d.ts.map