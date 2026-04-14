/**
 * Crucibulum — HTTP route contract tests
 *
 * Stands up the real Crucibulum app via createApp() bound to an ephemeral
 * port, then hits endpoints with fetch. Covers the public API contract the
 * UI and external consumers rely on, and pins the runtime validation on
 * malformed payloads.
 *
 * Not exhaustive — focuses on the high-risk public routes and the
 * status-code semantics that have regressed historically (200-with-ok:false,
 * silent coercion, etc.).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

// Isolate the test's filesystem state BEFORE importing anything that reads env.
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-route-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-route-state-"));
const LINKS_DIR = mkdtempSync(join(tmpdir(), "crcb-route-links-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_LINKS_DIR"] = LINKS_DIR;
// Tests bind on loopback, which the default auth treats as local-allowed.
// Make sure we don't accidentally require a token.
delete process.env["CRUCIBULUM_API_TOKEN"];
process.env["CRUCIBULUM_ALLOW_LOCAL"] = "true";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { storeBundle, buildBundle } = await import("../core/bundle.js");

let server: Server;
let base = "";

// ── setup ───────────────────────────────────────────────────────────────────

function makeBundle(overrides: { taskId?: string; model?: string; score?: number } = {}) {
  return buildBundle({
    manifest: {
      id: overrides.taskId ?? "t-route-1",
      family: "spec_discipline",
      difficulty: "easy",
      description: "route contract fixture",
      constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
      scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
      verification: {},
      task: { title: "t", description: "d" },
    } as never,
    oracle: {
      checks: { correctness: [], regression: [], integrity: [], decoys: [], anti_cheat: { forbidden_code_patterns: [] } },
      ground_truth: { bug_location: "", correct_fix_pattern: "" },
    } as never,
    executionResult: {
      exit_code: 0, steps_used: 5, tokens_in: 100, tokens_out: 200, duration_ms: 1000,
      timeline: [{ t: 0, type: "task_start", detail: "s" }],
      adapter_metadata: { provider: "local", system_version: "test" },
    } as never,
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    judgeResult: {
      verification: {
        correctness: { score: overrides.score ?? 1, details: {} },
        regression: { score: 1, details: {} },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 900, steps_used: 5, steps_limit: 40, score: 0.9 },
      },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: false, failure_mode: null },
    } as never,
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    startTime: "2026-04-14T00:00:00.000Z",
    endTime: "2026-04-14T00:00:01.000Z",
    workspace: { path: "/tmp/ws", commit: "abc" } as never,
    adapter: { id: "local", version: "1.0.0" } as never,
    model: overrides.model ?? "test-model",
  });
}

before(async () => {
  __resetRateLimiterForTests();
  server = createApp({ rateLimit: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  // Seed one stored bundle so run-detail routes have something to return.
  storeBundle(makeBundle({ taskId: "t-route-seed", model: "seed-model" }));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── health ──────────────────────────────────────────────────────────────────

describe("route: /api/health", () => {
  it("returns 200 with status ok and auth context", async () => {
    const res = await fetch(`${base}/api/health`);
    assert.equal(res.status, 200);
    const body = await res.json() as { status: string; auth: unknown; uptime: number };
    assert.equal(body.status, "ok");
    assert.ok(body.auth);
    assert.ok(typeof body.uptime === "number");
  });
});

// ── run list ────────────────────────────────────────────────────────────────

describe("route: /api/runs", () => {
  it("returns a list of runs including the seeded bundle", async () => {
    const res = await fetch(`${base}/api/runs`);
    assert.equal(res.status, 200);
    const body = await res.json() as { runs: Array<{ task_id: string }>; families: unknown };
    assert.ok(Array.isArray(body.runs));
    assert.ok(body.runs.some((r) => r.task_id === "t-route-seed"));
  });

  it("returns 404 for an unknown bundle id (no silent task.id fallback)", async () => {
    const res = await fetch(`${base}/api/runs/does-not-exist`);
    assert.equal(res.status, 404);
  });
});

// ── run POST (validation) ───────────────────────────────────────────────────

describe("route: POST /api/run", () => {
  it("returns 400 with details on an empty body", async () => {
    const res = await fetch(`${base}/api/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(res.status, 400);
    const body = await res.json() as { error: string; details?: string[] };
    assert.match(body.error, /Invalid run request/);
    assert.ok(Array.isArray(body.details) && body.details.length > 0);
  });

  it("returns 400 on malformed JSON instead of silently succeeding", async () => {
    const res = await fetch(`${base}/api/run`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    assert.equal(res.status, 400);
  });

  it("returns 400 when count is not a finite integer", async () => {
    const res = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "t-route-seed", model: "m", adapter: "local", count: "five" }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 when count is negative", async () => {
    const res = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "t", model: "m", adapter: "local", count: -3 }),
    });
    assert.equal(res.status, 400);
  });
});

// ── run-suite POST (validation) ─────────────────────────────────────────────

describe("route: POST /api/run-suite", () => {
  it("rejects missing required fields", async () => {
    const res = await fetch(`${base}/api/run-suite`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    assert.equal(res.status, 400);
  });

  it("rejects flake_detection.retries out of bounds", async () => {
    const res = await fetch(`${base}/api/run-suite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", adapter: "local", flake_detection: { retries: 999 } }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { details?: string[] };
    assert.ok(body.details?.some((d) => /retries/.test(d)));
  });
});

// ── run-batch POST (validation) ─────────────────────────────────────────────

describe("route: POST /api/run-batch", () => {
  it("rejects batches with fewer than 2 models", async () => {
    const res = await fetch(`${base}/api/run-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "t", models: [{ adapter: "local", model: "m1" }] }),
    });
    assert.equal(res.status, 400);
  });

  it("rejects batches of more than 32 models", async () => {
    const models = Array.from({ length: 33 }, (_, i) => ({ adapter: "local", model: `m-${i}` }));
    const res = await fetch(`${base}/api/run-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "t", models }),
    });
    assert.equal(res.status, 400);
  });
});

// ── scores ingestion ────────────────────────────────────────────────────────

describe("route: POST /api/scores/sync", () => {
  it("returns 400 on empty scores array", async () => {
    const res = await fetch(`${base}/api/scores/sync`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scores: [] }),
    });
    assert.equal(res.status, 400);
  });

  it("returns 400 (not 200) when every row is invalid", async () => {
    const res = await fetch(`${base}/api/scores/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scores: [{ modelId: 123, taskId: null }] }),
    });
    assert.equal(res.status, 400);
    const body = await res.json() as { ok: boolean; stored: number };
    assert.equal(body.ok, false);
    assert.equal(body.stored, 0);
  });

  it("stores valid rows and returns 200", async () => {
    const res = await fetch(`${base}/api/scores/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: "crucibulum",
        scores: [{
          modelId: "m-route-1", taskId: "t-route-1", family: "A", category: "spec",
          passed: true, score: 95, rawScore: 0.95, duration_ms: 100,
          timestamp: "2026-04-14T00:00:00Z",
        }],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { ok: boolean; stored: number };
    assert.equal(body.ok, true);
    assert.equal(body.stored, 1);
  });

  it("score out of range returns 400", async () => {
    const res = await fetch(`${base}/api/scores/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scores: [{
          modelId: "m", taskId: "t", family: "A", category: "c",
          passed: true, score: 150, rawScore: 1.5, duration_ms: 1, timestamp: "2026-04-14T00:00:00Z",
        }],
      }),
    });
    assert.equal(res.status, 400);
  });
});

// ── leaderboard read ────────────────────────────────────────────────────────

describe("route: GET /api/scores/leaderboard", () => {
  it("returns a leaderboard array", async () => {
    const res = await fetch(`${base}/api/scores/leaderboard`);
    assert.equal(res.status, 200);
    const body = await res.json() as { leaderboard: unknown[] };
    assert.ok(Array.isArray(body.leaderboard));
  });
});

// ── rate limiter (HTTP level) ───────────────────────────────────────────────

describe("rate limiter at HTTP level", () => {
  it("returns 429 with Retry-After when the POST bucket is exhausted", async () => {
    // Stand up a second server with rate limiting on, so we don't clobber the
    // main test server's allowance.
    __resetRateLimiterForTests();
    const rlServer = createApp({ rateLimit: true });
    await new Promise<void>((r) => rlServer.listen(0, "127.0.0.1", () => r()));
    const addr = rlServer.address() as AddressInfo;
    const rlBase = `http://127.0.0.1:${addr.port}`;
    try {
      // RATE_RUN limit is 10/min. Fire 12 and check that at least one is 429.
      const results: number[] = [];
      for (let i = 0; i < 12; i++) {
        const r = await fetch(`${rlBase}/api/run`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
        });
        results.push(r.status);
        if (r.status === 429) {
          assert.ok(r.headers.get("retry-after"));
          await r.body?.cancel();
          break;
        } else {
          await r.body?.cancel();
        }
      }
      assert.ok(results.includes(429), "expected at least one 429 after exhausting the POST bucket");
    } finally {
      await new Promise<void>((r) => rlServer.close(() => r()));
    }
  });
});

// ── 404 ─────────────────────────────────────────────────────────────────────

describe("route: unknown path", () => {
  it("returns 404 with a JSON error body", async () => {
    const res = await fetch(`${base}/api/definitely-not-a-route`);
    assert.equal(res.status, 404);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "Not found");
  });
});
