/**
 * Crucible — Pre-execution failure bundle regression
 *
 * Pins the "every run ends with durable evidence" invariant for runs that
 * never reach model execution (provider rate-limit at health_check,
 * adapter_init failure, preflight rejection). Before this fix, such
 * failures left no on-disk receipt — /api/runs/<run_id> 404'd, and the
 * UI's polling fallback (its own SSE-error-with-no-data + rate-limited
 * /status escape path) ended up showing "Run state unreachable" instead
 * of the structured provider failure that was already on the SSE error
 * frame.
 *
 * Test scenarios:
 *   1. health-check RATE_LIMIT → minimal failure bundle on disk, hydrated
 *      by run_id, classification + stage + provider_error all preserved.
 *   2. activeRuns GC after settlement → /api/runs/<run_id> still works
 *      through the bundle-by-run-id fallback (the previous identity fix +
 *      this minimal bundle write).
 *   3. retention classifies the minimal failure bundle as bundle_failed
 *      (score.pass === false), follows the keepFailedDays window.
 *   4. failure_mode is shaped 'classification/stage' for UI parsing.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-pef-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-pef-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-pef-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

// Copy a real personality manifest so dispatch works.
mkdirSync(join(TASKS_DIR, "personality"), { recursive: true });
const PERS_SRC = join(import.meta.dirname, "..", "..", "tasks", "personality", "personality-001");
mkdirSync(join(TASKS_DIR, "personality", "personality-001"), { recursive: true });
copyFileSync(join(PERS_SRC, "manifest.json"), join(TASKS_DIR, "personality", "personality-001", "manifest.json"));

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
const { activeRuns } = await import("../server/routes/run.js");
const { buildPreExecutionFailureBundle, storeBundle } = await import("../core/bundle.js");
const { buildRetentionPlan } = await import("../core/retention.js");
import type { CrucibulumAdapter, AdapterConfig } from "../adapters/base.js";

// ── Test adapter (always health-check rate-limits) ──────────────────────────

__registerTestAdapter({
  id: "pef-test", name: "Pre-Exec Failure Test", kind: "local",
  provider_mode: "fixed", fixed_provider: "pef-test",
  supports_custom_model: true,
  create: (): CrucibulumAdapter => ({
    id: "pef-test", name: "Pre-Exec Failure Test", version: "0.0.1",
    supports: () => true, supportsChat: () => true, supportsToolCalls: () => false,
    async init() {},
    async healthCheck() {
      return {
        ok: false,
        reason: "Provider rate limited (429) — try again",
        providerError: {
          kind: "RATE_LIMIT", origin: "PROVIDER", provider: "pef-test", adapter: "pef-test",
          statusCode: 429, retryable: true, rawMessage: "rate limited",
          rawCode: "rate_limited", cause: null, attempt: null, durationMs: null, requestId: null,
          retryAfterSec: 30,
        },
      };
    },
    async teardown() {},
    async chat() { throw new Error("not reachable"); },
    async execute() { throw new Error("not reachable"); },
  }),
  provider_options: [{ id: "pef-test", name: "Pre-Exec Failure Test", kind: "local", configurable: false }],
  listModels: async () => [{ id: "pef-model", name: "pef-model", provider: "pef-test", kind: "local", available: true, reason: null }],
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

async function postRun(task: string): Promise<{ status: number; runId: string }> {
  const r = await fetch(`${base}/api/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task, model: "pef-model", adapter: "pef-test" }),
  });
  const body = await r.json() as { run_id?: string };
  return { status: r.status, runId: body.run_id ?? "" };
}

async function waitErrorSettled(runId: string, timeoutMs = 5000): Promise<{ status: string; bundle_id: string | null }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await fetch(`${base}/api/run/${runId}/status`);
    if (r.ok) {
      const s = await r.json() as { status: string; bundle_id: string | null };
      if (s.status === "error" || s.status === "complete") return s;
    }
    await new Promise((res) => setTimeout(res, 20));
  }
  throw new Error("timeout waiting for terminal status");
}

// ── Unit: builder shape ─────────────────────────────────────────────────────

describe("buildPreExecutionFailureBundle", () => {
  it("shapes a minimal bundle with run_id, classification/stage, provider_error", () => {
    const bundle = buildPreExecutionFailureBundle({
      runId: "run_test_123",
      taskId: "personality-001",
      adapterId: "pef-test",
      provider: "pef-test",
      model: "pef-model",
      stage: "health_check",
      classification: "could_not_start",
      reason: "Provider rate limited",
      providerError: { kind: "RATE_LIMIT", origin: "PROVIDER", provider: "pef-test", adapter: "pef-test", statusCode: 429, retryable: true, rawMessage: "rate limited", rawCode: null, cause: null, attempt: null, durationMs: null, requestId: null, retryAfterSec: 30 },
      startTime: "2026-05-23T17:00:00.000Z",
      endTime: "2026-05-23T17:00:01.000Z",
    });
    assert.equal(bundle.run_id, "run_test_123");
    assert.equal(bundle.score.pass, false, "pre-execution failure bundles must NOT mark pass=true");
    assert.equal(bundle.verification_results.correctness.not_evaluable, true, "correctness must be flagged not_evaluable");
    assert.equal(bundle.diagnosis.failure_mode, "could_not_start/health_check");
    assert.ok(bundle.provider_attempts && bundle.provider_attempts.length === 1, "must record one provider attempt");
    assert.equal(bundle.provider_attempts![0]!.provider_error?.kind, "RATE_LIMIT");
    assert.equal(bundle.task.id, "personality-001");
    assert.equal(bundle.agent.model, "pef-model");
    assert.match(bundle.bundle_id, /^run_/);
  });

  it("bundle_id is unique across consecutive calls (random-suffix collision-free)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const b = buildPreExecutionFailureBundle({
        runId: `run_${i}`, taskId: "personality-001", adapterId: "pef-test", provider: null,
        model: "pef-model", stage: "health_check", classification: "could_not_start",
        reason: "rate limited", providerError: null,
        startTime: "2026-05-23T17:00:00.000Z", endTime: "2026-05-23T17:00:01.000Z",
      });
      seen.add(b.bundle_id);
    }
    assert.equal(seen.size, 20);
  });
});

// ── Integration: end-to-end through the HTTP server ─────────────────────────

describe("pre-execution RATE_LIMIT failure: durable evidence", () => {
  it("/status → error AND /api/runs/<run_id> → minimal failure bundle hydrated", async () => {
    const post = await postRun("personality-001");
    assert.equal(post.status, 202);
    const settled = await waitErrorSettled(post.runId);
    assert.equal(settled.status, "error");

    // /api/runs/<run_id> MUST find the minimal failure receipt.
    const hyd = await fetch(`${base}/api/runs/${post.runId}`);
    assert.equal(hyd.status, 200, "minimal failure bundle must be hydratable by run_id");
    const body = await hyd.json() as { bundle: { run_id?: string; score: { pass: boolean }; diagnosis: { failure_mode: string }; provider_attempts?: Array<{ provider_error?: { kind?: string; retryAfterSec?: number } }> } };
    assert.equal(body.bundle.run_id, post.runId, "minimal bundle records the run_id that produced it");
    assert.equal(body.bundle.score.pass, false);
    assert.equal(body.bundle.diagnosis.failure_mode, "could_not_start/health_check");
    assert.equal(body.bundle.provider_attempts?.[0]?.provider_error?.kind, "RATE_LIMIT");
    assert.equal(body.bundle.provider_attempts?.[0]?.provider_error?.retryAfterSec, 30, "Retry-After hint persisted");
  });

  it("activeRuns evict simulation: bundle still hydratable by run_id", async () => {
    const post = await postRun("personality-001");
    assert.equal(post.status, 202);
    await waitErrorSettled(post.runId);
    // Force-evict the in-memory entry — simulates a 10-minute-old run.
    activeRuns.delete(post.runId);
    // /status falls through to getBundleByRunId after the previous fix; it
    // should return the bundle as "complete" (the fallthrough leg synthesises
    // a complete record from the stored bundle — that's still a known shape
    // for the operator, NOT "Run not found").
    const r = await fetch(`${base}/api/run/${post.runId}/status`);
    assert.equal(r.status, 200, "post-GC /status must succeed via bundle-by-run_id lookup");
    const status = await r.json() as { status: string; bundle_id: string };
    assert.ok(status.bundle_id, "status must include bundle_id for the persisted failure");
    // /api/runs/<run_id> also works.
    const hyd = await fetch(`${base}/api/runs/${post.runId}`);
    assert.equal(hyd.status, 200, "/api/runs/<run_id> must hydrate after GC");
    const body = await hyd.json() as { bundle: { run_id?: string; diagnosis: { failure_mode: string } } };
    assert.equal(body.bundle.run_id, post.runId);
    assert.equal(body.bundle.diagnosis.failure_mode, "could_not_start/health_check");
  });
});

// ── Retention classifies these as bundle_failed ─────────────────────────────

describe("retention treats pre-execution failure bundles as bundle_failed", () => {
  it("scans the minimal failure bundle under the failed retention window", () => {
    const plan = buildRetentionPlan({
      config: {
        enabled: true,
        defaultRetentionDays: 14,
        keepSuccessDays: 14,
        keepFailedDays: 7,
        maxRunFiles: 2000,
        maxBytes: 1024 * 1024 * 1024,
        keepPinned: true,
        dryRunDefault: true,
      },
      runsDir: RUNS_DIR,
    });
    // The two failure bundles from previous tests should be in the scan as
    // bundle_failed (recent — skipped, but the *classification* is the pin).
    const failedBundles = plan.scan.entries.filter((e) => e.classification === "bundle_failed");
    assert.ok(failedBundles.length >= 2, `expected at least 2 bundle_failed entries; got ${failedBundles.length}: ${plan.scan.entries.map((e) => `${e.name}=${e.classification}`).join(", ")}`);
  });
});

// ── UI source-pin: the polling fallback now uses the original payload ──────

describe("ui/index.html: polling fallback uses original SSE payload", () => {
  it("falls back to the structured SSE payload when /status keeps failing", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    // The path that previously emitted "Run state unreachable" must now check
    // `parsed && originalPayload` first and prefer those values.
    assert.match(html, /originalPayload/);
    assert.match(html, /if\(parsed&&originalPayload\)/);
    // Own-server rate-limit detection on the polling .catch().
    assert.match(html, /err\.body\.error==='rate_limited'/);
    assert.match(html, /isReadRateLimit/);
  });

  it("polling interval is now ≥ 1000ms to stay under the server's RATE_READ bucket", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    const match = html.match(/const POLL_INTERVAL_MS=(\d+);/);
    assert.ok(match, "POLL_INTERVAL_MS must be declared");
    const ms = Number(match[1]);
    assert.ok(ms >= 1000, `POLL_INTERVAL_MS must be ≥ 1000ms; got ${ms}`);
  });

  it("backoff constants are the tuned 30s/180s defaults", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    assert.match(html, /RATE_LIMIT_BACKOFF_MIN_MS=30_000/);
    assert.match(html, /RATE_LIMIT_BACKOFF_MAX_MS=180_000/);
  });

  it("recognizes minimal failure bundles by failure_mode shape and shows structured cause", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    assert.match(html, /failure_mode/);
    assert.match(html, /failureMode\.split\('\/'\)/);
  });
});
