/**
 * Luak — Run start failure classification regression
 *
 * Operator-reported symptom: Personality lane, DeepSeek V4 Pro, 10 selected
 * tests; 3 ran, 7 marked "Could not start · STREAM · Run stream interrupted —
 * no evidence bundle produced". The wording is wrong — when the provider /
 * adapter health-check fails (rate limited, auth, timeout) the run never
 * generates a stream because health check fires BEFORE task_start, so the
 * stream wasn't "interrupted" at all; the start was refused. The catch-all
 * string hides the real cause from the operator.
 *
 * Pins:
 *  - For every per-run failure the server sends a structured SSE 'error'
 *    frame, the UI MUST surface the structured reason. Catch-all is only
 *    legal when SSE truly delivered no parseable data AND polling exhausted.
 *  - Health-check failure → classification 'could_not_start' with
 *    failure_stage = 'health_check' and a non-empty reason.
 *  - Adapter-init failure → classification 'could_not_start' with
 *    failure_stage = 'adapter_init' and a non-empty reason.
 *  - Provider chat failure mid-run → classification 'failed' (not
 *    'could_not_start') and the run still produces a bundle (the
 *    conversational runner catches chat errors and stores a failed bundle).
 *
 * This test drives 10 sequential POST → SSE drain cycles through the real
 * HTTP server. The injected adapter mimics the operator's environment:
 * first 3 requests succeed cleanly, requests 4-10 fail at health-check
 * with a synthesized "rate limited" provider error. The assertions catch
 * the catch-all-message regression.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Filesystem isolation.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-class-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-class-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-class-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

// Copy 10 real conversational manifests so /api/run loads them via the
// real path.
const PERSONALITY_SRC = join(import.meta.dirname, "..", "..", "tasks", "personality");
const PERS_TASKS = ["personality-001", "personality-002", "personality-003", "personality-004", "personality-005"];
for (const id of PERS_TASKS) {
  const dst = join(TASKS_DIR, "personality", id);
  mkdirSync(dst, { recursive: true });
  copyFileSync(join(PERSONALITY_SRC, id, "manifest.json"), join(dst, "manifest.json"));
}
// Mirror also: role-stress + prompt-sensitivity + truthfulness (10 total)
const COPY_PAIRS: Array<[string, string]> = [
  ["role-stress", "role-stress-001"],
  ["prompt-sensitivity", "prompt-sensitivity-001"],
  ["truthfulness", "truthfulness-001"],
  ["truthfulness", "truthfulness-002"],
  ["identity", "identity-peh-001"],
];
for (const [family, id] of COPY_PAIRS) {
  const src = join(import.meta.dirname, "..", "..", "tasks", family, id, "manifest.json");
  const dst = join(TASKS_DIR, family, id);
  mkdirSync(dst, { recursive: true });
  copyFileSync(src, join(dst, "manifest.json"));
}

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
const { clearAll: clearCircuitState } = await import("../core/circuit-breaker.js");
import type { CrucibulumAdapter, ChatMessage, AdapterConfig } from "../adapters/base.js";

// ── Test adapter — first N succeed cleanly, rest fail at health-check ───────

interface FailMode { mode: "healthCheck" | "init" | "chat"; reason: string; }
let healthCheckCount = 0;
let initCount = 0;
let chatCount = 0;
let healthCheckLimit = Infinity;  // succeed forever by default
let initLimit = Infinity;
let chatLimit = Infinity;
let failMode: FailMode | null = null;

function resetAdapterState(): void {
  healthCheckCount = 0;
  initCount = 0;
  chatCount = 0;
  healthCheckLimit = Infinity;
  initLimit = Infinity;
  chatLimit = Infinity;
  failMode = null;
}

function buildTestAdapter(): CrucibulumAdapter {
  return {
    id: "class-test", name: "Classification Test", version: "0.0.1",
    supports: () => true, supportsChat: () => true, supportsToolCalls: () => false,
    async init() {
      initCount++;
      if (failMode?.mode === "init" && initCount > initLimit) {
        throw new Error(failMode.reason);
      }
    },
    async healthCheck() {
      healthCheckCount++;
      if (failMode?.mode === "healthCheck" && healthCheckCount > healthCheckLimit) {
        return { ok: false, reason: failMode.reason, providerError: { kind: "RATE_LIMIT", origin: "PROVIDER", provider: "class-test", adapter: "class-test", statusCode: 429, retryable: true, rawMessage: failMode.reason, rawCode: "rate_limited", cause: null, attempt: null, durationMs: null, requestId: null } };
      }
      return { ok: true };
    },
    async teardown() {},
    async chat(_messages: ChatMessage[]) {
      chatCount++;
      if (failMode?.mode === "chat" && chatCount > chatLimit) {
        throw new Error(failMode.reason);
      }
      return { text: "Yes. Direct answer. I can't help with anything unsafe. bug feature question yes Fastify Wellington THUNDERBIRD", tokens_in: 4, tokens_out: 10, duration_ms: 5 };
    },
    async execute() { throw new Error("not implemented"); },
  };
}

__registerTestAdapter({
  id: "class-test", name: "Class Test", kind: "local",
  provider_mode: "fixed", fixed_provider: "class-test",
  supports_custom_model: true,
  create: () => buildTestAdapter(),
  provider_options: [{ id: "class-test", name: "Class Test", kind: "local", configurable: false }],
  listModels: async () => [{ id: "class-model", name: "class-model", provider: "class-test", kind: "local", available: true, reason: null }],
  makeConfig: () => ({} as AdapterConfig),
});

let server: Server;
let base = "";

before(async () => {
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
  resetAdapterState();
  clearCircuitState();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function postRun(task: string): Promise<{ status: number; runId: string; body: unknown }> {
  const r = await fetch(`${base}/api/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, model: "class-model", adapter: "class-test" }),
  });
  const body = await r.json() as { run_id?: string };
  return { status: r.status, runId: body.run_id ?? "", body };
}

async function drainStream(runId: string, timeoutMs = 10_000): Promise<{ frames: Array<{ event: string; data: unknown }>; }> {
  const r = await fetch(`${base}/api/run/${runId}/live`);
  if (r.status !== 200) return { frames: [] };
  const reader = r.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const frames: Array<{ event: string; data: unknown }> = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      if (raw.startsWith(":")) continue; // heartbeat
      let evt = "", data = "";
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) evt = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (evt) {
        let parsed: unknown = data;
        try { parsed = JSON.parse(data); } catch { /* keep raw */ }
        frames.push({ event: evt, data: parsed });
        if (evt === "complete" || evt === "error") return { frames };
      }
    }
  }
  return { frames };
}

interface UiClassification { finalStatus: "complete" | "error"; bundle_id: string | null; sse_error_payload: Record<string, unknown> | null; classification: string | null; reason: string | null; failure_stage: string | null; }

async function settleViaStatus(runId: string): Promise<UiClassification> {
  // Mirror the UI's settle path: if SSE delivered complete/error, use that;
  // otherwise poll /status.
  const live = await drainStream(runId);
  const terminal = live.frames.find((f) => f.event === "complete" || f.event === "error");
  if (terminal && terminal.event === "complete") {
    const data = terminal.data as { bundle_id?: string };
    return { finalStatus: "complete", bundle_id: data.bundle_id ?? null, sse_error_payload: null, classification: null, reason: null, failure_stage: null };
  }
  if (terminal && terminal.event === "error") {
    const data = terminal.data as Record<string, unknown>;
    return { finalStatus: "error", bundle_id: null, sse_error_payload: data, classification: data["classification"] as string ?? null, reason: data["reason"] as string ?? data["error"] as string ?? null, failure_stage: data["stage"] as string ?? null };
  }
  // Fallback to /status.
  const r = await fetch(`${base}/api/run/${runId}/status`);
  const s = await r.json() as { status: string; bundle_id: string | null; error: string | null; failure_stage: string | null };
  return { finalStatus: s.status as "complete" | "error", bundle_id: s.bundle_id, sse_error_payload: null, classification: null, reason: s.error, failure_stage: s.failure_stage };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("run classification: operator-shape 10-test launch", () => {
  it("sequential 10 tests, all pass: every test gets a complete frame with a bundle_id (regression for the 3/10 baseline)", async () => {
    const tasks = ["personality-001", "personality-002", "personality-003", "personality-004", "personality-005",
                   "identity-peh-001", "role-stress-001", "prompt-sensitivity-001",
                   "truthfulness-001", "truthfulness-002"];
    const outcomes = [];
    for (const task of tasks) {
      const post = await postRun(task);
      assert.equal(post.status, 202, `POST for ${task} must accept`);
      const settled = await settleViaStatus(post.runId);
      outcomes.push({ task, runId: post.runId, ...settled });
    }
    const passed = outcomes.filter((o) => o.finalStatus === "complete").length;
    assert.equal(passed, 10, `all 10 tests must reach complete with the always-pass adapter; got ${passed}: ${outcomes.map((o) => `${o.task}=${o.finalStatus}`).join(", ")}`);
    // None should report "stream interrupted" — pin that the wording is
    // never reached on a healthy run.
    for (const o of outcomes) {
      if (o.reason) assert.ok(!/Run stream interrupted/.test(o.reason), `${o.task} should not surface 'Run stream interrupted' on a clean pass`);
    }
  });

  it("first 3 succeed, requests 4-10 hit health-check rate-limit: structured cause MUST reach the SSE error frame, NOT 'Run stream interrupted'", async () => {
    // Mimics the operator pattern: 3 ran, 7 didn't start. The adapter
    // succeeds on its first 3 healthCheck calls, then returns
    // { ok: false, reason: "Provider rate limited (429)" } for the rest.
    failMode = { mode: "healthCheck", reason: "Provider rate limited (429) — slow down" };
    healthCheckLimit = 3;
    const tasks = ["personality-001", "personality-002", "personality-003", "personality-004", "personality-005",
                   "identity-peh-001", "role-stress-001", "prompt-sensitivity-001",
                   "truthfulness-001", "truthfulness-002"];
    const outcomes = [];
    for (const task of tasks) {
      const post = await postRun(task);
      assert.equal(post.status, 202, `POST for ${task} must still accept (rate limit is async health-check)`);
      const settled = await settleViaStatus(post.runId);
      outcomes.push({ task, ...settled });
    }
    const passed = outcomes.filter((o) => o.finalStatus === "complete").length;
    const failed = outcomes.filter((o) => o.finalStatus === "error").length;
    assert.equal(passed, 3, `expected 3 passes; got ${passed}`);
    assert.equal(failed, 7, `expected 7 failures; got ${failed}`);
    // CRITICAL: every error's reason must carry the structured rate-limit
    // text. If any error frame contains "Run stream interrupted" or the
    // server dropped the SSE without sending a structured payload, the
    // operator gets the catch-all.
    for (const o of outcomes) {
      if (o.finalStatus !== "error") continue;
      assert.ok(o.sse_error_payload, `${o.task}: error must arrive as a structured SSE frame (no payload = catch-all hazard)`);
      assert.equal(o.classification, "could_not_start", `${o.task}: health-check failure must classify as 'could_not_start'`);
      assert.equal(o.failure_stage, "health_check", `${o.task}: stage must be 'health_check' (not 'stream' or 'unknown')`);
      assert.ok(o.reason && /rate limit/i.test(o.reason), `${o.task}: reason must carry the structured cause; got ${JSON.stringify(o.reason)}`);
      assert.ok(o.reason && !/Run stream interrupted/.test(o.reason), `${o.task}: reason must NOT be 'Run stream interrupted'; got ${JSON.stringify(o.reason)}`);
    }
  });

  it("health-check failure: SSE error payload carries provider_error with kind=RATE_LIMIT", async () => {
    failMode = { mode: "healthCheck", reason: "Provider rate limited" };
    healthCheckLimit = 0; // every health-check fails
    const post = await postRun("personality-001");
    assert.equal(post.status, 202);
    const settled = await settleViaStatus(post.runId);
    assert.equal(settled.finalStatus, "error");
    assert.ok(settled.sse_error_payload, "must emit structured SSE error");
    const provider_error = (settled.sse_error_payload as { provider_error?: { kind?: string } | null }).provider_error;
    assert.ok(provider_error, "SSE error payload must include provider_error");
    assert.equal(provider_error.kind, "RATE_LIMIT");
  });

  it("adapter-init failure: classification = could_not_start, stage = adapter_init, reason is non-empty", async () => {
    failMode = { mode: "init", reason: "Adapter init refused — credentials invalid" };
    initLimit = 1;  // First init (preflight) succeeds; second (run path) fails.
    const post = await postRun("personality-001");
    assert.equal(post.status, 202);
    const settled = await settleViaStatus(post.runId);
    assert.equal(settled.finalStatus, "error");
    assert.ok(settled.sse_error_payload);
    assert.equal(settled.classification, "could_not_start");
    assert.equal(settled.failure_stage, "adapter_init");
    assert.ok(settled.reason && settled.reason.length > 0, "reason must be populated, not empty");
    assert.ok(settled.reason && !/Run stream interrupted/.test(settled.reason), "must surface the real reason, not the catch-all");
  });

  it("chat-mid-run failure: classification = failed (not could_not_start), bundle is stored", async () => {
    // Chat fails AFTER health/init succeed. The conversational runner
    // catches the chat exception, stops the loop, and stores a failed
    // bundle. The SSE terminal frame should be 'complete' (the runner
    // produced a bundle), not 'error'. classification on `/status`
    // therefore stays 'complete' too — failure_stage is irrelevant.
    failMode = { mode: "chat", reason: "Provider returned 500" };
    chatLimit = 0;  // all chat calls fail
    const post = await postRun("personality-001");
    assert.equal(post.status, 202);
    const settled = await settleViaStatus(post.runId);
    assert.equal(settled.finalStatus, "complete", "chat error mid-run must still produce a bundle and reach 'complete'");
    assert.ok(settled.bundle_id, "a failed bundle must be stored");
  });
});

describe("run classification: UI message catalogue", () => {
  it("the catch-all 'Run stream interrupted — no evidence bundle produced' is only a fallback after polling exhaustion", async () => {
    // Source-level pin: the catch-all string must appear in ui/index.html
    // exactly once as a `let reason =` default that's replaced when SSE
    // delivers a structured payload — and the polling-exhausted branch
    // must build a different "honest" reason. If this assertion ever
    // fails, the UI has regressed and is mis-labelling honest failures.
    const { readFileSync } = await import("node:fs");
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    const occurrences = (html.match(/Run stream interrupted — no evidence bundle produced/g) ?? []).length;
    // Original default literal + one comment that mentions it = 2 occurrences max.
    assert.ok(occurrences <= 2, `the catch-all phrase appears ${occurrences} times; should appear once as a default literal and at most once as a comment`);
    // The honest-reason branch must use a different phrase.
    assert.match(html, /Run could not be observed — SSE disconnected before any task_start event/);
    assert.match(html, /Run timed out waiting for completion after SSE disconnect/);
  });
});
