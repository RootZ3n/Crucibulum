/**
 * Crucible — Pairing + session-token flow tests
 *
 * Covers the new desktop-bootstrap and desktop-to-mobile pairing UX without
 * weakening any existing security guarantees. Specifically:
 *
 *   - /api/auth/bootstrap-local works only on loopback and returns a SESSION
 *     token (not the master token).
 *   - Pairing tokens expire and can only be redeemed once.
 *   - A redeemed pairing token mints a fresh session that authenticates real
 *     protected endpoints — without ever exposing the master.
 *   - The master token still works as the fallback path.
 *   - The status endpoint surfaces the right capabilities so the UI can
 *     decide which paths to show.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { __resetAuthForTests, getEffectiveToken } from "../server/auth.js";
import { __resetSessionsForTests, issuePairing, redeemPairing, validateSessionToken, DEFAULT_PAIRING_TTL_MS, } from "../server/auth-sessions.js";
async function freshApp(options) {
    const stateDir = mkdtempSync(join(tmpdir(), "crcb-pair-"));
    process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
    process.env["CRUCIBULUM_ALLOW_LOCAL"] = options.allowLocal ? "true" : "false";
    if (options.envToken !== undefined)
        process.env["CRUCIBULUM_API_TOKEN"] = options.envToken;
    else
        delete process.env["CRUCIBULUM_API_TOKEN"];
    __resetAuthForTests();
    __resetSessionsForTests();
    const server = createApp({ rateLimit: false });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    return { server, base: `http://127.0.0.1:${addr.port}`, stateDir };
}
async function closeApp(ctx) {
    await new Promise((resolve) => ctx.server.close(() => resolve()));
    try {
        rmSync(ctx.stateDir, { recursive: true, force: true });
    }
    catch { /* ignore */ }
}
// ── status capabilities ─────────────────────────────────────────────────────
describe("auth-pairing: /api/auth/status capabilities", () => {
    it("advertises canBootstrapLocal=true on loopback when local trust is on", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const res = await fetch(`${ctx.base}/api/auth/status`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.canBootstrapLocal, true);
            assert.equal(body.isLoopback, true);
            assert.equal(body.canPair, true);
            assert.equal(body.scheme, "Bearer");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("advertises canBootstrapLocal=false when CRUCIBULUM_ALLOW_LOCAL=false", async () => {
        const ctx = await freshApp({ allowLocal: false });
        try {
            const body = await (await fetch(`${ctx.base}/api/auth/status`)).json();
            assert.equal(body.canBootstrapLocal, false);
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── bootstrap-local issues a SESSION token, never the master ───────────────
describe("auth-pairing: POST /api/auth/bootstrap-local", () => {
    it("returns a session token (not the master) on loopback", async () => {
        const ctx = await freshApp({ allowLocal: true, envToken: "MASTER-secret-shouldnt-leak" });
        try {
            const res = await fetch(`${ctx.base}/api/auth/bootstrap-local`, { method: "POST" });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.kind, "session");
            assert.notEqual(body.token, "MASTER-secret-shouldnt-leak", "bootstrap-local MUST NOT return the master token");
            assert.ok(body.token.length > 16);
            assert.ok(new Date(body.expiresAt).getTime() > Date.now());
            // And the issued session is valid against protected endpoints.
            const protectedRes = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer " + body.token } });
            assert.equal(protectedRes.status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("refuses with 403 when CRUCIBULUM_ALLOW_LOCAL=false", async () => {
        const ctx = await freshApp({ allowLocal: false, envToken: "MASTER" });
        try {
            const res = await fetch(`${ctx.base}/api/auth/bootstrap-local`, { method: "POST" });
            assert.equal(res.status, 403);
            const body = await res.json();
            assert.equal(body.error, "bootstrap_disabled");
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── pairing requires auth + redemption mints a session ────────────────────
describe("auth-pairing: POST /api/auth/pairing → POST /api/auth/redeem", () => {
    it("issues code+token from an authed (loopback) request", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const res = await fetch(`${ctx.base}/api/auth/pairing`, { method: "POST" });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.match(body.code, /^[A-Z0-9]{6}$/, "pairing code should be 6 chars from the unambiguous alphabet");
            assert.ok(body.token.length > 16);
            assert.ok(body.expiresInSec > 0 && body.expiresInSec <= Math.ceil(DEFAULT_PAIRING_TTL_MS / 1000));
            assert.match(body.url, /\/\?pair=/, "url should include the pair= query");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("refuses pairing issuance from an unauthenticated remote-like context", async () => {
        const ctx = await freshApp({ allowLocal: false, envToken: "MASTER" });
        try {
            const res = await fetch(`${ctx.base}/api/auth/pairing`, { method: "POST" });
            assert.equal(res.status, 401);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("redeems by code → returns a session token that authenticates protected endpoints", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const issue = await (await fetch(`${ctx.base}/api/auth/pairing`, { method: "POST" })).json();
            const redeem = await fetch(`${ctx.base}/api/auth/redeem`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: issue.code, deviceLabel: "phone-test" }),
            });
            assert.equal(redeem.status, 200);
            const body = await redeem.json();
            assert.equal(body.kind, "session");
            // Probe a real protected endpoint with the session.
            const ok = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer " + body.token } });
            assert.equal(ok.status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("redeems by long opaque token (the QR/deep-link path)", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const issue = await (await fetch(`${ctx.base}/api/auth/pairing`, { method: "POST" })).json();
            const redeem = await fetch(`${ctx.base}/api/auth/redeem`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: issue.token }),
            });
            assert.equal(redeem.status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("rejects redemption with an unknown code (401 not_found)", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const res = await fetch(`${ctx.base}/api/auth/redeem`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: "ZZZZZZ" }),
            });
            assert.equal(res.status, 401);
            const body = await res.json();
            assert.equal(body.reason, "not_found");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("refuses second redemption of the same code (409 already_redeemed)", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const issue = await (await fetch(`${ctx.base}/api/auth/pairing`, { method: "POST" })).json();
            const first = await fetch(`${ctx.base}/api/auth/redeem`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: issue.code }),
            });
            assert.equal(first.status, 200);
            const second = await fetch(`${ctx.base}/api/auth/redeem`, {
                method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: issue.code }),
            });
            assert.equal(second.status, 409);
            const body = await second.json();
            assert.equal(body.reason, "already_redeemed");
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── pairing expiry (store-level, no need for HTTP for this) ───────────────
describe("auth-pairing: pairing token expiry", () => {
    it("refuses redemption past the configured TTL", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const pairing = issuePairing({ ttlMs: 60_000 });
            // Synthetically push the entry past expiry by mutating in-memory store
            // via a fresh redeem call after monkey-patching Date.now? Easier: pass
            // a 0-ms TTL — issuePairing clamps to a 60 s minimum, so we drive the
            // expiry path via the negative cache: poke the record's expiresAt back
            // into the past directly.
            // The redeem helper pulls the record by code.
            const code = pairing.code;
            // Force expiry by redeeming "in the future".
            const realNow = Date.now;
            Date.now = (() => pairing.expiresAt + 1);
            try {
                const result = redeemPairing({ code });
                assert.equal(result.ok, false);
                assert.equal(result.reason, "expired");
            }
            finally {
                Date.now = realNow;
            }
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── session token = bearer for protected calls; master fallback still works
describe("auth-pairing: session token vs master token (fallback)", () => {
    it("session token issued via bootstrap authenticates remote-like calls under ALLOW_LOCAL=false", async () => {
        // The session was minted while loopback was allowed; another request
        // could come from a non-loopback context (we simulate by toggling
        // ALLOW_LOCAL=false). The session must still be honored.
        const ctx = await freshApp({ allowLocal: true });
        let sessionToken;
        try {
            sessionToken = (await (await fetch(`${ctx.base}/api/auth/bootstrap-local`, { method: "POST" })).json()).token;
        }
        finally {
            await new Promise((resolve) => ctx.server.close(() => resolve()));
        }
        // Restart with loopback turned off — env token absent. Session lookup
        // happens against the in-process store; tokens persist.
        process.env["CRUCIBULUM_STATE_DIR"] = ctx.stateDir;
        process.env["CRUCIBULUM_ALLOW_LOCAL"] = "false";
        delete process.env["CRUCIBULUM_API_TOKEN"];
        __resetAuthForTests();
        // Don't reset the session store — we want the session to survive the "restart".
        const server = createApp({ rateLimit: false });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const addr = server.address();
        const base = `http://127.0.0.1:${addr.port}`;
        try {
            const ok = await fetch(`${base}/api/runs`, { headers: { Authorization: "Bearer " + sessionToken } });
            assert.equal(ok.status, 200, "issued session must continue to authenticate after a restart");
            const bad = await fetch(`${base}/api/runs`);
            assert.equal(bad.status, 401, "no token should still be 401 under ALLOW_LOCAL=false");
        }
        finally {
            await new Promise((resolve) => server.close(() => resolve()));
            try {
                rmSync(ctx.stateDir, { recursive: true, force: true });
            }
            catch { /* ignore */ }
        }
    });
    it("master token still authenticates as the fallback path", async () => {
        const ctx = await freshApp({ allowLocal: false, envToken: "OPERATOR-MASTER" });
        try {
            // master token directly accepted
            assert.equal(getEffectiveToken(), "OPERATOR-MASTER");
            const ok = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer OPERATOR-MASTER" } });
            assert.equal(ok.status, 200);
            // wrong token still rejected
            const bad = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer WRONG" } });
            assert.equal(bad.status, 401);
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── logout revokes a session token ─────────────────────────────────────────
describe("auth-pairing: POST /api/auth/logout", () => {
    it("revokes a session token so it stops authenticating", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const tok = (await (await fetch(`${ctx.base}/api/auth/bootstrap-local`, { method: "POST" })).json()).token;
            // Confirm it works first.
            assert.equal((await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer " + tok } })).status, 200);
            // Logout.
            const logout = await fetch(`${ctx.base}/api/auth/logout`, { method: "POST", headers: { Authorization: "Bearer " + tok } });
            assert.equal(logout.status, 200);
            // Token now invalid against the session store.
            assert.equal(validateSessionToken(tok), null);
            // And against the live server with loopback gone.
            process.env["CRUCIBULUM_ALLOW_LOCAL"] = "false";
            __resetAuthForTests();
            const after = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer " + tok } });
            assert.equal(after.status, 401, "revoked session must not authenticate");
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── UI surface check (cheap source-presence guard) ─────────────────────────
import { readFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
const ui = readFileSync(pathJoin(process.cwd(), "ui", "index.html"), "utf-8");
describe("auth-pairing: UI offers all three paths and the in-app pair modal", () => {
    it("auth screen advertises local bootstrap, pairing-code entry, and an advanced fallback", () => {
        assert.match(ui, /Local desktop bootstrap/);
        assert.match(ui, /Pair this device/);
        assert.match(ui, /Advanced .* paste a raw token/);
    });
    it("calls the new server endpoints from the boot path", () => {
        assert.match(ui, /\/api\/auth\/bootstrap-local/);
        assert.match(ui, /\/api\/auth\/redeem/);
        assert.match(ui, /\/api\/auth\/pairing/);
    });
    it("auto-redeems ?pair= deep links and strips them from the URL", () => {
        assert.match(ui, /maybeRedeemPairLink/);
        assert.match(ui, /history\.replaceState/);
    });
    it("exposes a Pair Device action inside the authed UI", () => {
        assert.match(ui, /openPairDeviceModal/);
        assert.match(ui, /Pair Device/);
    });
});
//# sourceMappingURL=auth-pairing.test.js.map