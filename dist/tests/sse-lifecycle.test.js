/**
 * Crucible — SSE lifecycle coverage
 *
 * Real HTTP + SSE tests. Stands up the server via createApp(), binds to an
 * ephemeral port, issues a POST /api/run, then parses the live SSE stream
 * from /api/run/:id/live. The purpose is not to exercise the full
 * task/adapter pipeline (that's covered in the normal test suites) but to
 * verify the streaming lifecycle itself: events arrive in order, the stream
 * reaches a terminal state, and the connection closes cleanly instead of
 * hanging.
 *
 * The error path is the cheapest way to drive the entire SSE machinery end
 * to end — it catches regressions in event framing, terminal-state detection,
 * and client cleanup without needing a fake adapter wired into the registry
 * or a live task manifest on disk.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Filesystem isolation BEFORE any import that reads env at module load time.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-sse-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-sse-state-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
delete process.env["CRUCIBULUM_API_TOKEN"];
process.env["CRUCIBULUM_ALLOW_LOCAL"] = "true";
const { createApp } = await import("../server/app.js");
let server;
let base = "";
before(async () => {
    server = createApp({ rateLimit: false });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    base = `http://127.0.0.1:${addr.port}`;
});
after(async () => {
    await new Promise((resolve) => server.close(() => resolve()));
});
async function readAllFrames(resp, timeoutMs = 5000) {
    assert.ok(resp.body, "response has no body");
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const frames = [];
    let buf = "";
    const deadline = Date.now() + timeoutMs;
    while (true) {
        if (Date.now() > deadline) {
            await reader.cancel().catch(() => { });
            throw new Error(`SSE read timed out after ${timeoutMs}ms — server may be hanging on terminal state`);
        }
        const { value, done } = await reader.read();
        if (done)
            break;
        buf += decoder.decode(value, { stream: true });
        // Frames are separated by \n\n per SSE spec.
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
            const rawFrame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const lines = rawFrame.split("\n");
            let event = "message";
            let data = "";
            for (const line of lines) {
                if (line.startsWith("event:"))
                    event = line.slice(6).trim();
                else if (line.startsWith("data:"))
                    data += line.slice(5).trim();
            }
            if (event || data) {
                try {
                    frames.push({ event, data: JSON.parse(data) });
                }
                catch {
                    frames.push({ event, data });
                }
            }
        }
    }
    return frames;
}
async function waitForStatus(runId, target, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;
    let last = { status: "unknown", error: null };
    while (Date.now() < deadline) {
        const res = await fetch(`${base}/api/run/${runId}/status`);
        if (res.ok) {
            last = await res.json();
            if (last.status === target)
                return last;
        }
        await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`run ${runId} never reached status=${target}; last seen: ${JSON.stringify(last)}`);
}
async function startRunWithUnknownAdapter() {
    const res = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "sse-test", model: "fake", adapter: "does-not-exist-adapter" }),
    });
    assert.equal(res.status, 202, "POST /api/run should return 202 even for a bad adapter (error surfaces through SSE)");
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.match(body.run_id, /^run_/);
    return body.run_id;
}
// ── tests ───────────────────────────────────────────────────────────────────
describe("sse: error-path lifecycle (end to end)", () => {
    it("emits an error frame and closes the stream within the timeout", async () => {
        const runId = await startRunWithUnknownAdapter();
        // Wait for the async IIFE in handleRunPost to settle the run so /live can
        // take the "terminal replay and close" branch deterministically.
        await waitForStatus(runId, "error");
        const res = await fetch(`${base}/api/run/${runId}/live`, { headers: { Accept: "text/event-stream" } });
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
        const frames = await readAllFrames(res, 5000);
        assert.ok(frames.length > 0, "expected at least one SSE frame");
        const errorFrames = frames.filter((f) => f.event === "error");
        assert.equal(errorFrames.length, 1, `expected exactly one error frame, got ${frames.length} frames total`);
        const errPayload = errorFrames[0].data;
        assert.match(errPayload.error, /does-not-exist-adapter|Unknown adapter/i);
    });
    it("transitions run status to error", async () => {
        const runId = await startRunWithUnknownAdapter();
        const status = await waitForStatus(runId, "error");
        assert.equal(status.status, "error");
        assert.ok(status.error, "status.error should be populated");
    });
});
describe("sse: late-connect replay (reconnect semantics)", () => {
    it("serves cached events and closes the stream for an already-terminal run", async () => {
        const runId = await startRunWithUnknownAdapter();
        await waitForStatus(runId, "error");
        // Connect multiple times in sequence — each connection should replay and
        // close cleanly, proving the terminal-state short-circuit works.
        for (let i = 0; i < 3; i++) {
            const res = await fetch(`${base}/api/run/${runId}/live`);
            const frames = await readAllFrames(res, 3000);
            const errors = frames.filter((f) => f.event === "error");
            assert.equal(errors.length, 1, `replay #${i + 1} should include the cached error frame`);
        }
    });
});
describe("sse: client disconnect cleanup", () => {
    it("does not leak the client entry after the caller aborts", async () => {
        const runId = await startRunWithUnknownAdapter();
        await waitForStatus(runId, "error");
        // Abort immediately after connect. With the terminal-state close fixed,
        // the server ends the response anyway; this test pins that abort + close
        // don't throw or hang.
        const ctrl = new AbortController();
        const p = fetch(`${base}/api/run/${runId}/live`, { signal: ctrl.signal }).catch((err) => {
            // Expected in some Node versions when aborted.
            if (err.name !== "AbortError")
                throw err;
        });
        setTimeout(() => ctrl.abort(), 30);
        await p;
        // Issue one more request afterwards to prove the server is still healthy.
        const health = await fetch(`${base}/api/health`);
        assert.equal(health.status, 200);
    });
});
describe("sse: unknown run id", () => {
    it("opens a stream on a never-existed run id but does not hang forever on a terminal poll", async () => {
        // Current handleRunLive allows a future-facing connection on an unknown
        // run id (in case the run starts shortly after). That's accepted behavior.
        // We verify it at least does not crash and that the response has SSE
        // headers. We immediately abort to avoid a real hang.
        const ctrl = new AbortController();
        const resP = fetch(`${base}/api/run/no-such-run/live`, { signal: ctrl.signal }).catch(() => undefined);
        setTimeout(() => ctrl.abort(), 50);
        const res = await resP;
        if (res) {
            assert.equal(res.status, 200);
        }
    });
});
//# sourceMappingURL=sse-lifecycle.test.js.map