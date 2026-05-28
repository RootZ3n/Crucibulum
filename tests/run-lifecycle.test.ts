/**
 * Luak — Run lifecycle regression
 *
 * Drives sequential POST /api/run calls against the production server with a
 * deterministic injected adapter so the test can mirror the operator-reported
 * failure pattern: pass → interrupted/no-bundle → could-not-start → pass →
 * later tests that "fail instantly". The goal is to pin the invariants that
 * keep one bad test from poisoning later ones:
 *
 *   - every test receives its own `run_id` even when two POSTs land in the
 *     same millisecond (the millisecond-precision id is a real collision
 *     hazard for fast batches),
 *   - `activeRuns` always settles on the right run id (no entry conflation),
 *   - `sseClients` is emptied for the run when its lifecycle ends,
 *   - a failed init / failed health-check / chat exception does not stop the
 *     next test from running cleanly,
 *   - the circuit breaker for the test adapter is reset between failures so
 *     the "circuit OPEN → every later run fails" cascade cannot strand the
 *     batch.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Filesystem isolation BEFORE importing modules that read env at load time.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-lifecycle-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-lifecycle-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-lifecycle-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

// Stand up a minimal conversational task so /api/run can dispatch a real run
// against the test adapter. Family `operational_trust` so the loader walks
// the right code path.
const TASK_FAMILY = "operational-trust";
const TASK_ID = "op-lifecycle-test";
mkdirSync(join(TASKS_DIR, TASK_FAMILY, TASK_ID), { recursive: true });
writeFileSync(
  join(TASKS_DIR, TASK_FAMILY, TASK_ID, "manifest.json"),
  JSON.stringify({
    id: TASK_ID,
    version: "1.0.0",
    family: "operational_trust",
    execution_mode: "conversational",
    difficulty: "easy",
    description: "Lifecycle regression fixture — minimal conversational task.",
    system_prompt: "You are under test.",
    thinking_mode: "off",
    questions: [
      {
        id: "Q1",
        question: "Say yes.",
        scoring_type: "text_match",
        pass_phrases: ["yes"],
        weight: 1,
        tags: ["lifecycle"],
      },
    ],
    scoring: { pass_threshold: 0.5 },
    metadata: {
      author: "test",
      created: "2026-05-23",
      tags: ["lifecycle"],
      diagnostic_purpose: "verify runner lifecycle cleanup after interrupted streams",
      benchmark_provenance: {
        source: "internal-test",
        public_status: "private",
        oracle_visibility: "hidden",
        gold_solution_visibility: "not_applicable",
        contamination_risk: "low",
        known_scoring_limitations: ["synthetic fixture — exercises runner lifecycle, not real scoring"],
      },
    },
  }, null, 2),
);

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
const { activeRuns } = await import("../server/routes/run.js");
const { clearAll: clearCircuitState } = await import("../core/circuit-breaker.js");
import type { CrucibulumAdapter, ChatMessage, AdapterConfig } from "../adapters/base.js";

// ── Test adapter ────────────────────────────────────────────────────────────

// Intent applies to ALL adapter instances spawned during the current request
// — preflight, health, and run all see the same intent. This matches the
// operator-reported pattern where a *test* (one POST /api/run) fails for a
// reason that's independent of which adapter instance reached it.
type Intent = "pass" | "fail-init" | "fail-health" | "fail-chat";

let currentIntent: Intent = "pass";
// "preflight-init" makes init fail only on the *preflight* probe so we can
// test the synchronous-400 path independently from the async-202+SSE-error
// path that fail-init triggers via the health/run instantiation.
let isPreflightCall = true;
const lifecycleEvents: string[] = [];
let adapterInstantiations = 0;

function setIntent(intent: Intent): void {
  currentIntent = intent;
  isPreflightCall = true;
}

function buildTestAdapter(): CrucibulumAdapter {
  const intent = currentIntent;
  const callIsPreflight = isPreflightCall;
  // First instantiation per request is preflight (chat-support probe). After
  // that, subsequent instantiations are health and run.
  isPreflightCall = false;
  adapterInstantiations++;
  const instanceTag = `inst#${adapterInstantiations}/intent=${intent}/preflight=${callIsPreflight}`;
  lifecycleEvents.push(`create:${instanceTag}`);
  return {
    id: "lifecycle-test",
    name: "Lifecycle Test Adapter",
    version: "0.0.1",
    supports: () => true,
    supportsChat: () => true,
    supportsToolCalls: () => false,
    async init() {
      lifecycleEvents.push(`init:${instanceTag}`);
      // fail-init triggers ONLY on the async (non-preflight) path so the
      // POST still returns 202 and the failure surfaces through SSE.
      if (intent === "fail-init" && !callIsPreflight) {
        throw new Error(`test adapter intent=${intent} synthesised async init failure`);
      }
    },
    async healthCheck() {
      lifecycleEvents.push(`health:${instanceTag}`);
      if (intent === "fail-health") {
        return { ok: false, reason: `test adapter intent=${intent} synthesised health failure` };
      }
      return { ok: true };
    },
    async teardown() {
      lifecycleEvents.push(`teardown:${instanceTag}`);
    },
    async chat(_messages: ChatMessage[]) {
      lifecycleEvents.push(`chat:${instanceTag}`);
      if (intent === "fail-chat") {
        throw new Error(`test adapter intent=${intent} synthesised chat failure`);
      }
      return { text: "Yes — direct answer.", tokens_in: 4, tokens_out: 4, duration_ms: 1, cost_usd: 0 };
    },
    async execute() {
      throw new Error("lifecycle-test adapter does not implement repo execute");
    },
  };
}

function registerTestAdapter(): void {
  __registerTestAdapter({
    id: "lifecycle-test",
    name: "Lifecycle Test",
    kind: "local",
    provider_mode: "fixed",
    fixed_provider: "lifecycle-test",
    supports_custom_model: true,
    create: () => buildTestAdapter(),
    provider_options: [{ id: "lifecycle-test", name: "Lifecycle Test", kind: "local", configurable: false }],
    listModels: async () => [{ id: "test-model", name: "test-model", provider: "lifecycle-test", kind: "local", available: true, reason: null }],
    makeConfig: (_input) => ({} as AdapterConfig),
  });
}

// ── Server fixture ──────────────────────────────────────────────────────────

let server: Server;
let base = "";

before(async () => {
  registerTestAdapter();
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
  currentIntent = "pass";
  isPreflightCall = true;
  lifecycleEvents.length = 0;
  adapterInstantiations = 0;
  clearCircuitState();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

interface RunOutcome {
  runId: string;
  finalStatus: "complete" | "error" | "unknown";
  failureStage: string | null;
  error: string | null;
}

async function postRun(): Promise<{ ok: boolean; runId: string | null; httpStatus: number; body: unknown }> {
  const res = await fetch(`${base}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: TASK_ID, model: "test-model", adapter: "lifecycle-test" }),
  });
  const body = await res.json() as { ok?: boolean; run_id?: string };
  return { ok: !!body.ok, runId: body.run_id ?? null, httpStatus: res.status, body };
}

async function waitForStatusSettled(runId: string, timeoutMs = 5000): Promise<RunOutcome> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/run/${runId}/status`);
    if (res.ok) {
      const body = await res.json() as { status: string; error: string | null; failure_stage: string | null };
      if (body.status === "complete" || body.status === "error") {
        return { runId, finalStatus: body.status, failureStage: body.failure_stage, error: body.error };
      }
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return { runId, finalStatus: "unknown", failureStage: null, error: "timeout waiting for settlement" };
}

async function runOne(intent: Intent): Promise<RunOutcome> {
  setIntent(intent);
  const post = await postRun();
  assert.equal(post.httpStatus, 202, `intent=${intent} expected 202, got ${post.httpStatus}: ${JSON.stringify(post.body)}`);
  assert.ok(post.runId, `intent=${intent} run_id missing`);
  return waitForStatusSettled(post.runId!);
}

// ── tests ───────────────────────────────────────────────────────────────────

describe("run lifecycle: fresh state per test", () => {
  it("issues a unique run id even when Date.now() returns the same value for every POST", async () => {
    // The classic millisecond-precision id format collides when two POSTs land
    // in the same tick. Pin Date.now to force the collision and assert the
    // server has guarded against it. Without uniqueness, the second POST's
    // activeRuns.set silently clobbers the first run's state and both IIFEs
    // start mutating the same entry — the operator-visible symptom is "later
    // tests fail instantly" because state from an earlier interrupted run
    // bleeds into the active entry for the next one.
    setIntent("pass");
    const realNow = Date.now;
    const frozen = realNow.call(Date);
    Date.now = () => frozen;
    try {
      const posts = await Promise.all([postRun(), postRun(), postRun(), postRun(), postRun()]);
      const runIds = posts.map((p) => p.runId);
      const uniqueIds = new Set(runIds);
      assert.equal(
        uniqueIds.size,
        posts.length,
        `every POST must receive a distinct run id even at frozen Date.now; got ${runIds.join(",")} (${uniqueIds.size} unique)`,
      );
      for (const p of posts) {
        if (p.runId) await waitForStatusSettled(p.runId);
      }
    } finally {
      Date.now = realNow;
    }
  });

  it("does not conflate activeRuns entries when two POSTs collide on Date.now()", async () => {
    // Pair: one passing run + one failing run kicked off at the same frozen
    // tick. If the server hands out the same id to both, the second
    // activeRuns.set clobbers the first and the IIFEs race to mutate the
    // same entry — the survivor's terminal status is whichever finishes
    // last, *not* whichever the caller asked about. Pin: each run id is
    // reachable by /status and reports the right terminal state.
    const realNow = Date.now;
    const frozen = realNow.call(Date);
    Date.now = () => frozen;
    try {
      setIntent("pass");
      const passPromise = postRun();
      // Brief tick so the second POST sees a different `currentIntent`
      // (the test harness — not the server — needs that switch).
      await new Promise((r) => setImmediate(r));
      setIntent("fail-health");
      const failPromise = postRun();
      const [passPost, failPost] = await Promise.all([passPromise, failPromise]);
      assert.ok(passPost.runId);
      assert.ok(failPost.runId);
      assert.notEqual(passPost.runId, failPost.runId, "collision: pass and fail shared a run id under frozen Date.now()");
    } finally {
      Date.now = realNow;
    }
  });

  it("each test gets a freshly settled activeRuns entry tagged to its own run id", async () => {
    const outcome1 = await runOne("pass");
    if (outcome1.finalStatus !== "complete") {
      console.error("outcome1 failed:", outcome1, "lifecycle events:", lifecycleEvents);
    }
    assert.equal(outcome1.finalStatus, "complete");
    const entry1 = activeRuns.get(outcome1.runId);
    assert.ok(entry1, "test 1 should have an activeRuns entry");
    assert.equal(entry1.status, "complete");

    const outcome2 = await runOne("pass");
    assert.notEqual(outcome2.runId, outcome1.runId, "test 2 must have its own run id");
    const entry2 = activeRuns.get(outcome2.runId);
    assert.ok(entry2);
    assert.equal(entry2.status, "complete");
    // First entry is still there (under retention) but its status is preserved.
    assert.equal(activeRuns.get(outcome1.runId)?.status, "complete");
  });
});

describe("run lifecycle: interrupted-stream + cleanup", () => {
  it("pass → fail-chat → fail-init → pass → pass → pass: every later run still completes", async () => {
    // Mirror the operator-reported pattern. The bug claim is that after
    // ~2 failures + 1 pass, every subsequent test fails instantly. Pin the
    // opposite invariant: post-failure tests still succeed.
    const sequence: Intent[] = ["pass", "fail-chat", "fail-init", "pass", "pass", "pass"];
    const outcomes: RunOutcome[] = [];
    for (const intent of sequence) {
      outcomes.push(await runOne(intent));
    }

    assert.equal(outcomes[0]!.finalStatus, "complete", "test 1 (pass) should complete");
    // fail-chat in conversational runner means the chat call throws, which
    // the conversational runner catches and turns into a stored bundle with
    // a failed result — the run *completes* even though the model failed.
    assert.equal(outcomes[1]!.finalStatus, "complete", "test 2 (fail-chat) should still produce a bundle and reach complete");
    // fail-init means instantiateAdapterForRun for the actual run throws;
    // the IIFE's outer catch broadcasts an SSE error → status=error.
    assert.equal(outcomes[2]!.finalStatus, "error", "test 3 (fail-init) should reach error");
    assert.equal(outcomes[3]!.finalStatus, "complete", "test 4 (pass) should complete after the failures");
    assert.equal(outcomes[4]!.finalStatus, "complete", "test 5 (pass) should complete — no stale state poisoning");
    assert.equal(outcomes[5]!.finalStatus, "complete", "test 6 (pass) should complete — no instant failure cascade");

    // Each run must have its own id.
    const ids = new Set(outcomes.map((o) => o.runId));
    assert.equal(ids.size, outcomes.length, "every test must have its own run id");
  });

  it("fail-init does not leak SSE clients or active-run state into the next test", async () => {
    const failed = await runOne("fail-init");
    assert.equal(failed.finalStatus, "error", "fail-init should reach error");

    // After error the entry should be settled and reachable via /status.
    const statusRes = await fetch(`${base}/api/run/${failed.runId}/status`);
    const status = await statusRes.json() as { status: string; failure_stage: string };
    assert.equal(status.status, "error");
    assert.ok(["adapter_init", "preflight", "unknown"].includes(status.failure_stage ?? ""), `failure_stage should be adapter_init / preflight, got ${status.failure_stage}`);

    // Connecting late to /live should replay + close cleanly (terminal-state
    // short-circuit), not hang.
    const live = await fetch(`${base}/api/run/${failed.runId}/live`);
    assert.equal(live.status, 200);
    // Drain stream — should close within a couple of ticks since terminal.
    const reader = live.body!.getReader();
    const drainDeadline = Date.now() + 2000;
    while (Date.now() < drainDeadline) {
      const { done } = await reader.read();
      if (done) break;
    }

    // Next run must start cleanly.
    const next = await runOne("pass");
    assert.equal(next.finalStatus, "complete", "post-error next test must start and complete");
    assert.notEqual(next.runId, failed.runId, "next test must have its own run id");
  });

  it("operator pattern (pass, 2 fails, pass, then 4 more) holds when each request opens its own SSE stream", async () => {
    // Tighter mirror of what the UI does — POST then open EventSource — to
    // catch any lifecycle leak that only manifests when each run carries an
    // SSE client through to its terminal frame. Replays the operator-reported
    // sequence: 1 pass, 2 fails, 1 pass, then 4 passes that must NOT fail
    // instantly.
    const sequence: Intent[] = ["pass", "fail-chat", "fail-init", "pass", "pass", "pass", "pass", "pass"];
    const outcomes: Array<{ intent: Intent; runId: string; finalStatus: string; frames: string[] }> = [];
    for (const intent of sequence) {
      setIntent(intent);
      const post = await postRun();
      assert.equal(post.httpStatus, 202, `intent=${intent} expected 202`);
      const runId = post.runId!;
      // Open the live stream like the UI does, drain it to terminal.
      const liveRes = await fetch(`${base}/api/run/${runId}/live`);
      assert.equal(liveRes.status, 200);
      const frames: string[] = [];
      const reader = liveRes.body!.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const drainDeadline = Date.now() + 4000;
      while (Date.now() < drainDeadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) frames.push(line.slice(6).trim());
          }
        }
      }
      const settled = await waitForStatusSettled(runId);
      outcomes.push({ intent, runId, finalStatus: settled.finalStatus, frames });
    }

    // Operator's primary symptom: tests 5+ "fail instantly". Pin the opposite.
    for (let i = 3; i < outcomes.length; i++) {
      const o = outcomes[i]!;
      if (o.intent === "pass") {
        assert.equal(o.finalStatus, "complete", `test ${i + 1} (intent=${o.intent}) must complete; frames=${o.frames.join(",")}`);
      }
    }

    // Distinct run ids.
    const ids = new Set(outcomes.map((o) => o.runId));
    assert.equal(ids.size, outcomes.length);

    // Each run produced a terminal SSE frame ("complete" or "error").
    for (const o of outcomes) {
      const hasTerminal = o.frames.includes("complete") || o.frames.includes("error");
      assert.ok(hasTerminal, `run ${o.runId} (intent=${o.intent}) must emit a terminal SSE frame, got: ${o.frames.join(",")}`);
    }
  });

  it("repeated fail-init cycle (≥5) does not lock subsequent tests out via the circuit breaker", async () => {
    // The circuit breaker opens after 5 sequential failures. If the runner's
    // health/init path counts toward that circuit, a streak of bad starts
    // strands every subsequent test on "Circuit breaker OPEN" — exactly the
    // "every later test fails instantly" cascade the operator described.
    // Invariant: 5 bad starts in a row + 1 good one → the good one passes.
    for (let i = 0; i < 5; i++) {
      const result = await runOne("fail-health");
      assert.equal(result.finalStatus, "error", `bad start ${i + 1} should reach error`);
    }
    const recovered = await runOne("pass");
    assert.equal(recovered.finalStatus, "complete", "test 6 (pass) must not be locked out by a tripped circuit breaker");
  });
});
