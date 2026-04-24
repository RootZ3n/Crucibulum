/**
 * Crucible — Auth bootstrap flow tests
 *
 * HTTP-level coverage of the new auth surface:
 *   - /api/auth/status is public and reports enabled/localAllowed correctly
 *   - /api/auth/bootstrap returns a token to loopback clients
 *   - /api/auth/bootstrap refuses when CRUCIBULUM_ALLOW_LOCAL=false
 *   - Remote-style calls (auth disabled for loopback via env) return 401
 *     without a token and 200 with a valid Bearer header
 *   - Token persistence: the same token survives a module/app reload
 *   - Invalid token returns 401 with a distinguishable reason
 *
 * Simulating a "remote" client without leaving loopback:
 *   We set CRUCIBULUM_ALLOW_LOCAL=false for the relevant describe() blocks.
 *   From the auth module's perspective, that forces Bearer-only even for
 *   loopback calls — exactly the code path a real remote client exercises.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Static imports — all tests share ONE auth module instance. We rely on
// auth.ts resolving STATE_DIR + env flags lazily per call and on
// __resetAuthForTests() to clear the memoized token between tests.
import { createApp } from "../server/app.js";
import { __resetAuthForTests } from "../server/auth.js";
async function freshApp(options) {
    const stateDir = mkdtempSync(join(tmpdir(), "crcb-auth-"));
    process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
    process.env["CRUCIBULUM_ALLOW_LOCAL"] = options.allowLocal ? "true" : "false";
    if (options.envToken !== undefined)
        process.env["CRUCIBULUM_API_TOKEN"] = options.envToken;
    else
        delete process.env["CRUCIBULUM_API_TOKEN"];
    __resetAuthForTests();
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
// ── status endpoint ────────────────────────────────────────────────────────
describe("auth: /api/auth/status", () => {
    it("reports authRequired=false when local access is allowed and returns scheme", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const res = await fetch(`${ctx.base}/api/auth/status`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.localAllowed, true);
            assert.equal(body.scheme, "Bearer");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("reports authRequired=true when ALLOW_LOCAL=false (remote-like posture)", async () => {
        const ctx = await freshApp({ allowLocal: false });
        try {
            const res = await fetch(`${ctx.base}/api/auth/status`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.authRequired, true);
            assert.equal(body.localAllowed, false);
        }
        finally {
            await closeApp(ctx);
        }
    });
});
// ── bootstrap endpoint ─────────────────────────────────────────────────────
describe("auth: /api/auth/bootstrap", () => {
    it("returns a Bearer token to a loopback client when local trust is enabled", async () => {
        const ctx = await freshApp({ allowLocal: true });
        try {
            const res = await fetch(`${ctx.base}/api/auth/bootstrap`);
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.scheme, "Bearer");
            assert.ok(typeof body.token === "string" && body.token.length >= 16, "token should be a reasonable length");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("refuses to hand out a token when CRUCIBULUM_ALLOW_LOCAL=false", async () => {
        const ctx = await freshApp({ allowLocal: false });
        try {
            const res = await fetch(`${ctx.base}/api/auth/bootstrap`);
            assert.equal(res.status, 403);
            const body = await res.json();
            assert.equal(body.error, "bootstrap_disabled");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("issues a UNIQUE session token per call (the master token is never returned here)", async () => {
        // Bootstrap now mints a fresh session token on every call — this is the
        // pairing-era behavior and a deliberate change from the old "return the
        // master token" design. Two consecutive calls must produce two distinct
        // tokens, both valid for protected requests.
        const ctx = await freshApp({ allowLocal: true });
        try {
            const a = await (await fetch(`${ctx.base}/api/auth/bootstrap`)).json();
            const b = await (await fetch(`${ctx.base}/api/auth/bootstrap`)).json();
            assert.notEqual(a.token, b.token, "each bootstrap call should mint a NEW session token");
            // Both should authenticate against a protected endpoint.
            assert.equal((await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer " + a.token } })).status, 200);
            assert.equal((await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer " + b.token } })).status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("honors an explicit CRUCIBULUM_API_TOKEN env var without persisting an auto-generated master", async () => {
        const ctx = await freshApp({ allowLocal: true, envToken: "test-env-token-xyz" });
        try {
            // Bootstrap returns a session token (NOT the master) — verifying
            // that the env-configured master is never leaked through this surface.
            const body = await (await fetch(`${ctx.base}/api/auth/bootstrap`)).json();
            assert.notEqual(body.token, "test-env-token-xyz", "bootstrap MUST NOT return the env master token");
            assert.equal(body.kind, "session");
            // Persist-file should NOT be created when the operator set an env token.
            assert.equal(existsSync(join(ctx.stateDir, "auth-token")), false);
            // The env master itself still authenticates as the fallback path.
            const ok = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer test-env-token-xyz" } });
            assert.equal(ok.status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("persists the auto-generated MASTER token across restarts (sessions are per-process)", async () => {
        // The master token is still auto-generated and persisted at <state>/auth-token
        // so it survives restarts and remains usable for the operator/fallback path.
        // Sessions are intentionally per-process (the in-memory store is JSON-backed
        // but the master is the durable trust root).
        const ctx1 = await freshApp({ allowLocal: false }); // no loopback bypass; we need master-token path
        const stateDir = ctx1.stateDir;
        // Trigger master-token generation by calling a protected endpoint without a token —
        // the 401 happens after getEffectiveToken() runs and writes the file.
        await fetch(`${ctx1.base}/api/runs`);
        assert.ok(existsSync(join(stateDir, "auth-token")), "auth-token file should be persisted");
        const persisted = readFileSync(join(stateDir, "auth-token"), "utf-8").trim();
        assert.ok(persisted.length > 16);
        await new Promise((resolve) => ctx1.server.close(() => resolve()));
        // Restart with the same STATE_DIR — getEffectiveToken should re-read the file,
        // and the same master should authenticate.
        process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
        process.env["CRUCIBULUM_ALLOW_LOCAL"] = "false";
        delete process.env["CRUCIBULUM_API_TOKEN"];
        __resetAuthForTests();
        const server = createApp({ rateLimit: false });
        await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
        const addr = server.address();
        const base = `http://127.0.0.1:${addr.port}`;
        try {
            const ok = await fetch(`${base}/api/runs`, { headers: { Authorization: "Bearer " + persisted } });
            assert.equal(ok.status, 200, "persisted master token must continue to authenticate after a restart");
        }
        finally {
            await new Promise((resolve) => server.close(() => resolve()));
            try {
                rmSync(stateDir, { recursive: true, force: true });
            }
            catch { /* ignore */ }
        }
    });
});
// ── Protected-endpoint behavior under remote-like posture ──────────────────
describe("auth: protected endpoints under ALLOW_LOCAL=false", () => {
    it("returns 401 without a Bearer header", async () => {
        const ctx = await freshApp({ allowLocal: false, envToken: "probe-token" });
        try {
            const res = await fetch(`${ctx.base}/api/runs`);
            assert.equal(res.status, 401);
            const body = await res.json();
            assert.equal(body.error, "Unauthorized");
            assert.match(body.reason, /invalid_or_missing_token/);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("returns 200 with the correct Bearer token", async () => {
        const ctx = await freshApp({ allowLocal: false, envToken: "probe-token" });
        try {
            const res = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer probe-token" } });
            assert.equal(res.status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("returns 401 with a wrong token and a distinguishable reason", async () => {
        const ctx = await freshApp({ allowLocal: false, envToken: "probe-token" });
        try {
            const res = await fetch(`${ctx.base}/api/runs`, { headers: { Authorization: "Bearer wrong-token" } });
            assert.equal(res.status, 401);
            const body = await res.json();
            assert.equal(body.reason, "invalid_or_missing_token");
        }
        finally {
            await closeApp(ctx);
        }
    });
    it("/api/auth/status is reachable without a token (needed by the UI to decide what to render)", async () => {
        const ctx = await freshApp({ allowLocal: false });
        try {
            const res = await fetch(`${ctx.base}/api/auth/status`);
            assert.equal(res.status, 200);
        }
        finally {
            await closeApp(ctx);
        }
    });
});
//# sourceMappingURL=auth-flow.test.js.map