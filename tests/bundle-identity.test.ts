/**
 * Luak — Evidence bundle identity regression
 *
 * Before the fix:
 *   - conversational bundle_id was `run_${ISO-date}_${task}_${model}` (date
 *     precision). Same task+model on the same day collided to a single
 *     filename and storeBundle silently overwrote the earlier bundle.
 *   - repo-runner bundle_id was `run_${YYYYMMDDTHHMMSS}_${task}_${model}`
 *     (second precision). Same hazard, narrower window.
 *   - The UI threaded the server's `run_id` through `watchRunCompletion`
 *     but /api/runs/<run_id> looked up by bundle_id only, so hydration
 *     404'd for any bundle whose id didn't equal the run id (always, now
 *     that ids are random-suffixed).
 *
 * Pins:
 *   - Multiple bundles for the same task+model on the same day get
 *     distinct bundle_ids and distinct on-disk files.
 *   - storeBundle never silently overwrites — same bundle_id twice
 *     results in two distinct files.
 *   - /api/runs/<run_id> hydrates the right bundle for that run.
 *   - SSE complete payload carries `run_id` so the UI can correlate.
 */
import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Filesystem isolation BEFORE importing modules that read env at load time.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-bundleid-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-bundleid-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-bundleid-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

// Stand up a minimal conversational task so /api/run can dispatch real runs.
const TASK_FAMILY = "operational-trust";
const TASK_ID = "op-bundleid-test";
mkdirSync(join(TASKS_DIR, TASK_FAMILY, TASK_ID), { recursive: true });
writeFileSync(
  join(TASKS_DIR, TASK_FAMILY, TASK_ID, "manifest.json"),
  JSON.stringify({
    id: TASK_ID,
    version: "1.0.0",
    family: "operational_trust",
    execution_mode: "conversational",
    difficulty: "easy",
    description: "Bundle-identity regression fixture.",
    system_prompt: "Under test.",
    thinking_mode: "off",
    questions: [{
      id: "Q1", question: "Say yes.", scoring_type: "text_match",
      pass_phrases: ["yes"], weight: 1, tags: ["bundleid"],
    }],
    scoring: { pass_threshold: 0.5 },
    metadata: {
      author: "test", created: "2026-05-23",
      tags: ["bundleid"], diagnostic_purpose: "verify bundle identity does not collide",
      benchmark_provenance: {
        source: "internal-test", public_status: "private", oracle_visibility: "hidden",
        gold_solution_visibility: "not_applicable", contamination_risk: "low",
        known_scoring_limitations: ["synthetic fixture — exercises bundle identity, not scoring"],
      },
    },
  }, null, 2),
);

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
const { activeRuns } = await import("../server/routes/run.js");
const { clearAll: clearCircuitState } = await import("../core/circuit-breaker.js");
const { generateBundleId, generateRunId, generateSuiteRunId, generateBatchId } = await import("../core/identity.js");
import type { CrucibulumAdapter, ChatMessage, AdapterConfig } from "../adapters/base.js";

// ── Test adapter (always passes — we're testing identity, not scoring) ──────

const lifecycleEvents: string[] = [];
let adapterInstantiations = 0;

function buildAlwaysPassAdapter(): CrucibulumAdapter {
  adapterInstantiations++;
  const tag = `inst#${adapterInstantiations}`;
  lifecycleEvents.push(`create:${tag}`);
  return {
    id: "bundleid-test", name: "Bundle ID Test Adapter", version: "0.0.1",
    supports: () => true, supportsChat: () => true, supportsToolCalls: () => false,
    async init() { lifecycleEvents.push(`init:${tag}`); },
    async healthCheck() { lifecycleEvents.push(`health:${tag}`); return { ok: true }; },
    async teardown() { lifecycleEvents.push(`teardown:${tag}`); },
    async chat(_messages: ChatMessage[]) {
      lifecycleEvents.push(`chat:${tag}`);
      return { text: "Yes.", tokens_in: 4, tokens_out: 4, duration_ms: 1, cost_usd: 0 };
    },
    async execute() { throw new Error("not implemented"); },
  };
}

__registerTestAdapter({
  id: "bundleid-test", name: "Bundle ID Test", kind: "local",
  provider_mode: "fixed", fixed_provider: "bundleid-test",
  supports_custom_model: true,
  create: () => buildAlwaysPassAdapter(),
  provider_options: [{ id: "bundleid-test", name: "Bundle ID Test", kind: "local", configurable: false }],
  listModels: async () => [{ id: "bid-model", name: "bid-model", provider: "bundleid-test", kind: "local", available: true, reason: null }],
  makeConfig: () => ({} as AdapterConfig),
});

// ── Server fixture ──────────────────────────────────────────────────────────

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
  lifecycleEvents.length = 0;
  adapterInstantiations = 0;
  clearCircuitState();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

async function postRun(): Promise<{ httpStatus: number; runId: string }> {
  const res = await fetch(`${base}/api/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: TASK_ID, model: "bid-model", adapter: "bundleid-test" }),
  });
  const body = await res.json() as { ok?: boolean; run_id?: string };
  return { httpStatus: res.status, runId: body.run_id ?? "" };
}

async function waitSettled(runId: string, target: "complete" | "error" = "complete"): Promise<{ status: string; bundle_id: string | null }> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/api/run/${runId}/status`);
    if (res.ok) {
      const body = await res.json() as { status: string; bundle_id: string | null };
      if (body.status === target) return body;
      if (body.status === "complete" || body.status === "error") return body;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`run ${runId} never reached terminal state`);
}

function bundleFiles(): string[] {
  return readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("identity helpers", () => {
  it("generateBundleId is unique even when date and task+model match", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      ids.add(generateBundleId("op-test", "some-model", { isoDate: "2026-05-23T00:00:00.000Z" }));
    }
    assert.equal(ids.size, 50, `expected 50 unique ids; got ${ids.size}`);
    for (const id of ids) {
      assert.match(id, /^run_2026-05-23_op-test_some-model_[0-9a-f]{8}$/);
    }
  });

  it("generateRunId / generateSuiteRunId / generateBatchId mint distinct ids under frozen Date.now()", () => {
    const realNow = Date.now;
    Date.now = () => realNow.call(Date);
    try {
      const runs = new Set<string>(); const suites = new Set<string>(); const batches = new Set<string>();
      for (let i = 0; i < 30; i++) {
        runs.add(generateRunId());
        suites.add(generateSuiteRunId());
        batches.add(generateBatchId());
      }
      assert.equal(runs.size, 30, "run ids must be unique under frozen Date.now");
      assert.equal(suites.size, 30, "suite ids must be unique under frozen Date.now");
      assert.equal(batches.size, 30, "batch ids must be unique under frozen Date.now");
      for (const id of runs) assert.match(id, /^run_/);
      for (const id of suites) assert.match(id, /^suite_/);
      for (const id of batches) assert.match(id, /^batch_/);
    } finally {
      Date.now = realNow;
    }
  });

  it("generateBundleId retries when isTaken returns true", () => {
    const taken = new Set<string>();
    const id1 = generateBundleId("op-test", "model", { isoDate: "2026-05-23T00:00:00.000Z", isTaken: (id) => taken.has(id) });
    taken.add(id1);
    const id2 = generateBundleId("op-test", "model", { isoDate: "2026-05-23T00:00:00.000Z", isTaken: (id) => taken.has(id) });
    assert.notEqual(id1, id2);
  });
});

describe("bundle identity: same-day same-task/model reruns", () => {
  it("frozen Date.now: 5 reruns each get a unique bundle_id and a unique file on disk", async () => {
    const realNow = Date.now;
    const fixed = realNow.call(Date);
    Date.now = () => fixed;
    try {
      const outcomes = [];
      for (let i = 0; i < 5; i++) {
        const post = await postRun();
        assert.equal(post.httpStatus, 202, `post ${i} should accept`);
        const settled = await waitSettled(post.runId);
        assert.equal(settled.status, "complete");
        outcomes.push({ runId: post.runId, bundle_id: settled.bundle_id });
      }
      const uniqueBundleIds = new Set(outcomes.map((o) => o.bundle_id));
      assert.equal(uniqueBundleIds.size, outcomes.length, `5 runs must produce 5 unique bundle_ids; got ${[...uniqueBundleIds].join(",")}`);
      // One distinct file per bundle on disk.
      for (const o of outcomes) {
        assert.ok(o.bundle_id, "bundle_id should be populated");
        assert.ok(existsSync(join(RUNS_DIR, `${o.bundle_id}.json`)), `bundle file for ${o.bundle_id} must exist`);
      }
      // No file was overwritten — the bundle files include all 5 distinct ids.
      const filesPresent = new Set(bundleFiles());
      for (const o of outcomes) {
        assert.ok(filesPresent.has(`${o.bundle_id}.json`), `${o.bundle_id}.json must still be on disk after later runs`);
      }
    } finally {
      Date.now = realNow;
    }
  });

  it("same task+model on the same day: 10 reruns → 10 bundle files (no overwrite)", async () => {
    const before = bundleFiles().length;
    const outcomes = [];
    for (let i = 0; i < 10; i++) {
      const post = await postRun();
      const settled = await waitSettled(post.runId);
      outcomes.push({ runId: post.runId, bundle_id: settled.bundle_id });
    }
    const after = bundleFiles().length;
    assert.equal(after - before, 10, `expected 10 new bundle files; got ${after - before}`);
    const uniqueBundleIds = new Set(outcomes.map((o) => o.bundle_id));
    assert.equal(uniqueBundleIds.size, 10);
  });
});

describe("/api/runs/<run_id> hydration", () => {
  it("hydrates the correct bundle for each run id (early runs don't get later evidence)", async () => {
    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      const post = await postRun();
      const settled = await waitSettled(post.runId);
      outcomes.push({ runId: post.runId, bundle_id: settled.bundle_id });
    }

    // Now hydrate each run by run_id — every lookup must return the bundle
    // whose `run_id` matches the requested id, NOT the most recent bundle
    // that happens to share the same task+model.
    for (const o of outcomes) {
      const res = await fetch(`${base}/api/runs/${o.runId}`);
      assert.equal(res.status, 200, `runId=${o.runId} should hydrate (status=${res.status})`);
      const body = await res.json() as { bundle: { run_id?: string; bundle_id: string } };
      assert.ok(body.bundle, `runId=${o.runId} must return a bundle`);
      assert.equal(body.bundle.bundle_id, o.bundle_id, `runId=${o.runId} should hydrate to bundle_id=${o.bundle_id}, got ${body.bundle.bundle_id}`);
      assert.equal(body.bundle.run_id, o.runId, `bundle for runId=${o.runId} must carry that runId in metadata`);
    }
  });

  it("/api/runs/<bundle_id> still works for the legacy bundle-id lookup path", async () => {
    const post = await postRun();
    const settled = await waitSettled(post.runId);
    assert.ok(settled.bundle_id);
    const res = await fetch(`${base}/api/runs/${settled.bundle_id}`);
    assert.equal(res.status, 200);
    const body = await res.json() as { bundle: { bundle_id: string } };
    assert.equal(body.bundle.bundle_id, settled.bundle_id);
  });

  it("/api/runs/<unknown> 404s — no fall-through to an arbitrary bundle", async () => {
    const res = await fetch(`${base}/api/runs/run_nonexistent_aaaa`);
    assert.equal(res.status, 404);
  });
});

describe("storeBundle never silently overwrites", () => {
  it("forcing a bundle_id collision (same id, two writes) renames the second file", async () => {
    const { storeBundle } = await import("../core/bundle.js");
    // Synthesise a tiny bundle object with a fixed id, write it twice — the
    // second write must NOT clobber the first.
    const fixedId = "run_forced-collision-test_alpha";
    const synth = (): unknown => ({
      bundle_id: fixedId,
      bundle_hash: "sha256:pending",
      bundle_version: "test",
      task: { id: "forced", manifest_hash: "h", family: "operational_trust", difficulty: "easy" },
      agent: { adapter: "test", adapter_version: "v", system: "test", system_version: "v", model: "m", model_version: "v", provider: "test" },
      environment: { os: "test", arch: "test", repo_commit: "none", crucibulum_version: "test", timestamp_start: new Date().toISOString(), timestamp_end: new Date().toISOString() },
      timeline: [],
      diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
      security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
      verification_results: {
        correctness: { score: 1, details: {} },
        regression: { score: 1, details: {} },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 0, time_limit_sec: 60, steps_used: 0, steps_limit: 0, score: 1 },
      },
      score: { scale: "fraction_0_1", total: 1, total_percent: 100, breakdown: { correctness: 1, regression: 1, integrity: 1, efficiency: 1 }, breakdown_percent: { correctness: 100, regression: 100, integrity: 100, efficiency: 100 }, pass: true, pass_threshold: 0.5, pass_threshold_percent: 50, integrity_violations: 0 },
      usage: { tokens_in: 1, tokens_out: 1, estimated_cost_usd: 0, provider_cost_note: "test" },
      judge: { kind: "deterministic", label: "test", description: "test", verifier_model: null, components: [] },
      trust: { rubric_hidden: false, narration_ignored: false, state_based_scoring: true, bundle_verified: false, deterministic_judge_authoritative: true, review_layer_advisory: true },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: false, failure_mode: null },
    });

    // First write — should land at the requested filename.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const path1 = storeBundle(synth() as any);
    assert.ok(path1.endsWith(`${fixedId}.json`), `first write expected ${fixedId}.json, got ${path1}`);
    assert.ok(existsSync(path1));

    // Second write with the *same* id — must NOT clobber the first.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const path2 = storeBundle(synth() as any);
    assert.notEqual(path1, path2, "second write must NOT reuse the same path");
    assert.ok(existsSync(path1), "first bundle file must still be on disk");
    assert.ok(existsSync(path2), "second bundle file must exist at its new path");
  });
});

describe("SSE complete payload echoes run_id", () => {
  it("complete event carries run_id so the UI can correlate without ambiguity", async () => {
    const post = await postRun();
    assert.equal(post.httpStatus, 202);
    // Drain the live stream and look for the complete frame's payload.
    const liveRes = await fetch(`${base}/api/run/${post.runId}/live`);
    const reader = liveRes.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let completePayload: Record<string, unknown> | null = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !completePayload) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        let evt = "", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) evt = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (evt === "complete") {
          try { completePayload = JSON.parse(data) as Record<string, unknown>; } catch { /* ignore */ }
        }
      }
    }
    assert.ok(completePayload, "expected a complete frame");
    assert.equal((completePayload as { run_id?: string }).run_id, post.runId, "complete frame must echo run_id");
    assert.ok((completePayload as { bundle_id?: string }).bundle_id, "complete frame must carry bundle_id too");
  });
});
