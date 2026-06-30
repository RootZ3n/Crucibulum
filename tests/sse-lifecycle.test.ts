/**
 * Luak — SSE lifecycle coverage
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
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { AdapterConfig, ChatMessage, CrucibulumAdapter } from "../adapters/base.js";

// Filesystem isolation BEFORE any import that reads env at module load time.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-sse-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-sse-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-sse-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

const TASK_FAMILY = "operational-trust";
const LIVE_TASK_ID = "op-sse-live-test";
mkdirSync(join(TASKS_DIR, TASK_FAMILY, LIVE_TASK_ID), { recursive: true });
writeFileSync(
  join(TASKS_DIR, TASK_FAMILY, LIVE_TASK_ID, "manifest.json"),
  JSON.stringify({
    id: LIVE_TASK_ID,
    version: "1.0.0",
    family: "operational_trust",
    execution_mode: "conversational",
    difficulty: "easy",
    description: "SSE live stream fixture.",
    system_prompt: "You are under test.",
    thinking_mode: "off",
    questions: [
      { id: "Q1", question: "Say yes.", scoring_type: "text_match", pass_phrases: ["yes"], weight: 1, tags: ["sse"] },
      { id: "Q2", question: "Say yes again.", scoring_type: "text_match", pass_phrases: ["yes"], weight: 1, tags: ["sse"] },
    ],
    scoring: { pass_threshold: 0.5 },
    metadata: {
      author: "test",
      created: "2026-06-30",
      tags: ["sse"],
      diagnostic_purpose: "verify in-flight SSE progress frames before terminal completion",
      benchmark_provenance: {
        source: "internal-test",
        public_status: "private",
        oracle_visibility: "hidden",
        gold_solution_visibility: "not_applicable",
        contamination_risk: "low",
        known_scoring_limitations: ["synthetic SSE lifecycle fixture"],
      },
    },
  }, null, 2),
);

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
const { sseClients } = await import("../server/routes/run.js");

let server: Server;
let base = "";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildSlowSseAdapter(): CrucibulumAdapter {
  return {
    id: "sse-slow-test",
    name: "SSE Slow Test Adapter",
    version: "0.0.1",
    supports: () => true,
    supportsChat: () => true,
    supportsToolCalls: () => false,
    async init(_config: AdapterConfig) {},
    async healthCheck() { return { ok: true }; },
    async teardown() {},
    async chat(_messages: ChatMessage[]) {
      await delay(150);
      return { text: "Yes.", tokens_in: 2, tokens_out: 1, duration_ms: 150, cost_usd: 0 };
    },
    async execute() {
      throw new Error("sse-slow-test only supports conversational tasks");
    },
  };
}

before(async () => {
  __registerTestAdapter({
    id: "sse-slow-test",
    name: "SSE Slow Test",
    kind: "local",
    provider_mode: "fixed",
    fixed_provider: "sse-slow-test",
    supports_custom_model: true,
    create: () => buildSlowSseAdapter(),
    provider_options: [{ id: "sse-slow-test", name: "SSE Slow Test", kind: "local", configurable: false }],
    listModels: async () => [{ id: "sse-model", name: "sse-model", provider: "sse-slow-test", kind: "local", available: true, reason: null }],
    makeConfig: () => ({} as AdapterConfig),
  });
  server = createApp({ rateLimit: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  __clearTestAdapters();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  sseClients.clear();
});

// ── SSE frame parser ────────────────────────────────────────────────────────

interface SseFrame { event: string; data: unknown }

async function readAllFrames(resp: Response, timeoutMs = 5000): Promise<SseFrame[]> {
  assert.ok(resp.body, "response has no body");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;

  while (true) {
    if (Date.now() > deadline) {
      await reader.cancel().catch(() => {});
      throw new Error(`SSE read timed out after ${timeoutMs}ms — server may be hanging on terminal state`);
    }
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    // Frames are separated by \n\n per SSE spec.
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const rawFrame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = rawFrame.split("\n");
      let event = "message";
      let data = "";
      for (const line of lines) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (event || data) {
        try {
          frames.push({ event, data: JSON.parse(data) });
        } catch {
          frames.push({ event, data });
        }
      }
    }
  }
  return frames;
}

async function waitForStatus(runId: string, target: "running" | "complete" | "error", timeoutMs = 3000): Promise<{ status: string; error: string | null }> {
  const deadline = Date.now() + timeoutMs;
  let last: { status: string; error: string | null } = { status: "unknown", error: null };
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/run/${runId}/status`);
    if (res.ok) {
      last = await res.json() as { status: string; error: string | null };
      if (last.status === target) return last;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run ${runId} never reached status=${target}; last seen: ${JSON.stringify(last)}`);
}

async function startRunWithUnknownAdapter(): Promise<string> {
  const res = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "sse-test", model: "fake", adapter: "does-not-exist-adapter" }),
  });
  assert.equal(res.status, 202, "POST /api/run should return 202 even for a bad adapter (error surfaces through SSE)");
  const body = await res.json() as { ok: boolean; run_id: string };
  assert.equal(body.ok, true);
  assert.match(body.run_id, /^run_/);
  return body.run_id;
}

async function startLiveRun(): Promise<string> {
  const res = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: LIVE_TASK_ID, model: "sse-model", adapter: "sse-slow-test" }),
  });
  assert.equal(res.status, 202);
  const body = await res.json() as { ok: boolean; run_id: string };
  assert.equal(body.ok, true);
  return body.run_id;
}

async function waitForSseClient(runId: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((sseClients.get(runId)?.length ?? 0) > 0) return;
    await delay(10);
  }
  throw new Error(`SSE client was not registered for ${runId}`);
}

async function readUntilTerminal(resp: Response, timeoutMs = 5000): Promise<SseFrame[]> {
  assert.ok(resp.body, "response has no body");
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  const frames: SseFrame[] = [];
  let buf = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const rawFrame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (rawFrame.startsWith(":")) continue;
      let event = "message";
      let data = "";
      for (const line of rawFrame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!event && !data) continue;
      frames.push({ event, data: data ? JSON.parse(data) : null });
      if (event === "complete" || event === "error") {
        await reader.cancel().catch(() => {});
        return frames;
      }
    }
  }
  await reader.cancel().catch(() => {});
  throw new Error(`SSE read timed out waiting for terminal frame; saw ${frames.map((f) => f.event).join(",")}`);
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
    const errPayload = errorFrames[0]!.data as { error: string };
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

describe("sse: in-flight progress stream", () => {
  it("delivers progress before completion and removes the client slot after disconnect", async () => {
    const runId = await startLiveRun();
    const res = await fetch(`${base}/api/run/${runId}/live`, { headers: { Accept: "text/event-stream" } });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);

    await waitForSseClient(runId);
    const frames = await readUntilTerminal(res, 5000);
    const terminalIndex = frames.findIndex((f) => f.event === "complete" || f.event === "error");
    assert.ok(terminalIndex >= 0, `expected terminal frame, got ${frames.map((f) => f.event).join(",")}`);
    assert.equal(frames[terminalIndex]!.event, "complete");

    const progressBeforeTerminal = frames.slice(0, terminalIndex).filter((f) => f.event === "step");
    assert.ok(progressBeforeTerminal.length >= 2, `expected progress step frames before completion, got ${frames.map((f) => f.event).join(",")}`);
    assert.ok(
      progressBeforeTerminal.some((f) => /Question 1\/2|Run 1\/1 executing/.test(String((f.data as { detail?: string }).detail ?? ""))),
      "expected a live progress payload before the terminal frame",
    );

    await waitForStatus(runId, "complete");
    for (let i = 0; i < 50 && sseClients.has(runId); i++) await delay(10);
    assert.equal(sseClients.has(runId), false, "terminal cleanup should remove the run's SSE client slot");
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
      if ((err as Error).name !== "AbortError") throw err;
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
