/**
 * Crucible — Leaderboard auth-gating tests
 *
 * Proves that leaderboard and quarantine endpoints require authentication
 * and return proper 401 JSON when unauthenticated.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-lb-auth-state-"));
const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-lb-auth-runs-"));
const LINKS_DIR = mkdtempSync(join(tmpdir(), "crcb-lb-auth-links-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_LINKS_DIR"] = LINKS_DIR;
process.env["CRUCIBLE_HMAC_KEY"] = "leaderboard-auth-test-key";
// Force token auth — disable loopback bypass so we can test 401s from localhost.
process.env["CRUCIBLE_ALLOW_LOCAL"] = "false";
process.env["CRUCIBLE_API_TOKEN"] = "test-leaderboard-auth-token";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { __resetAuthForTests } = await import("../server/auth.js");
const { storeBundle, buildBundle } = await import("../core/bundle.js");

let server: Server;
let base = "";
const TOKEN = "test-leaderboard-auth-token";

function makeBundle(overrides: { taskId?: string; family?: string; model?: string; score?: number } = {}) {
  return buildBundle({
    manifest: {
      id: overrides.taskId ?? "t-lb-auth-1",
      family: overrides.family ?? "spec_discipline",
      difficulty: "easy",
      description: "leaderboard auth test fixture",
      constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
      scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
      verification: {},
      task: { title: "t", description: "d" },
      metadata: { author: "crucible-test", created: "2026-04-01", tags: [], diagnostic_purpose: "test", benchmark_provenance: "leaderboard-auth" },
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
  __resetAuthForTests();
  server = createApp({ rateLimit: false });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
  storeBundle(makeBundle({ taskId: "t-lb-seed", model: "seed-model" }));
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ── unauthenticated requests return 401 ──────────────────────────────────────

describe("leaderboard auth gating: unauthenticated requests", () => {
  it("GET /api/leaderboard returns 401 JSON without auth", async () => {
    const res = await fetch(`${base}/api/leaderboard`);
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string; reason: string };
    assert.equal(body.error, "Unauthorized");
    assert.ok(typeof body.reason === "string");
    assert.equal(res.headers.get("content-type"), "application/json");
    assert.equal(res.headers.get("www-authenticate"), "Bearer");
  });

  it("GET /api/scores/leaderboard returns 401 JSON without auth", async () => {
    const res = await fetch(`${base}/api/scores/leaderboard`);
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "Unauthorized");
  });

  it("GET /leaderboard returns 401 JSON without auth", async () => {
    const res = await fetch(`${base}/leaderboard`);
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "Unauthorized");
  });

  it("GET /api/leaderboard/quarantine returns 401 JSON without auth", async () => {
    const res = await fetch(`${base}/api/leaderboard/quarantine`);
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "Unauthorized");
  });

  it("GET /api/scores returns 401 JSON without auth", async () => {
    const res = await fetch(`${base}/api/scores`);
    assert.equal(res.status, 401);
    const body = await res.json() as { error: string };
    assert.equal(body.error, "Unauthorized");
  });
});

// ── authenticated requests succeed ───────────────────────────────────────────

describe("leaderboard auth gating: authenticated requests", () => {
  const headers = { Authorization: `Bearer ${TOKEN}` };

  it("GET /api/leaderboard returns 200 with auth", async () => {
    const res = await fetch(`${base}/api/leaderboard`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { leaderboard: unknown[] };
    assert.ok(Array.isArray(body.leaderboard));
  });

  it("GET /api/scores/leaderboard returns 200 with auth", async () => {
    const res = await fetch(`${base}/api/scores/leaderboard`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { leaderboard: unknown[] };
    assert.ok(Array.isArray(body.leaderboard));
  });

  it("GET /leaderboard returns 200 with auth", async () => {
    const res = await fetch(`${base}/leaderboard`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { leaderboard: unknown[] };
    assert.ok(Array.isArray(body.leaderboard));
  });

  it("GET /api/leaderboard/quarantine returns 200 with auth", async () => {
    const res = await fetch(`${base}/api/leaderboard/quarantine`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { ranking_mode: string };
    assert.equal(body.ranking_mode, "public_verified");
  });

  it("GET /api/scores returns 200 with auth", async () => {
    const res = await fetch(`${base}/api/scores`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as { scores: unknown[] };
    assert.ok(Array.isArray(body.scores));
  });
});

// ── verified/quarantine filtering remains unchanged ──────────────────────────

describe("leaderboard auth gating: filtering behavior preserved", () => {
  const headers = { Authorization: `Bearer ${TOKEN}` };

  it("eligible and quarantine filtering is unchanged when authenticated", async () => {
    storeBundle(makeBundle({ taskId: "t-auth-good", family: "safety", model: "auth-good", score: 0.91 }));

    const res = await fetch(`${base}/api/leaderboard?task_families=safety`, { headers });
    assert.equal(res.status, 200);
    const body = await res.json() as {
      ranking_mode: string;
      filters_applied: { require_authenticated_bundle: boolean; exclude_tampered: boolean; exclude_mock_demo: boolean };
    };
    assert.equal(body.ranking_mode, "public_verified");
    assert.equal(body.filters_applied.require_authenticated_bundle, true);
    assert.equal(body.filters_applied.exclude_tampered, true);
    assert.equal(body.filters_applied.exclude_mock_demo, true);
  });
});

// ── HMAC key missing startup warning ─────────────────────────────────────────

describe("HMAC key missing startup warning", () => {
  it("logs a warning when CRUCIBLE_HMAC_KEY is not set", async () => {
    const { readFileSync } = await import("node:fs");
    const { join: pathJoin } = await import("node:path");
    // Read the compiled JS (which preserves the string literals from the TS source).
    const appSource = readFileSync(pathJoin(import.meta.dirname, "..", "server", "app.js"), "utf-8");
    assert.ok(appSource.includes("CRUCIBLE_HMAC_KEY"), "app.js must reference CRUCIBLE_HMAC_KEY for the startup warning");
    assert.ok(appSource.includes("unsigned bundles will be quarantined"), "app.js must warn about unsigned bundles being quarantined");
    assert.ok(appSource.includes("local demos"), "app.js must mention local demos in the HMAC warning");
  });
});
