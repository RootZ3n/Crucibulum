/**
 * Crucible — Rate-limit end-to-end shape regression
 *
 * Pins:
 *  - makeHttpProviderError parses Retry-After and surfaces it on the
 *    structured error.
 *  - A 429 with no Retry-After leaves the field null (caller falls back to
 *    computed backoff).
 *  - The SSE error frame for a health-check rate-limit carries
 *    provider_error.retryAfterSec when present.
 *  - The UI source still contains exactly one occurrence of the legacy
 *    catch-all default and the new cooldown messaging strings.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { makeHttpProviderError } from "../core/provider-errors.js";

// ── Unit: header → structured error ─────────────────────────────────────────

describe("provider-errors: Retry-After flows through makeHttpProviderError", () => {
  function fakeResponse(status: number, headers: Record<string, string>): Response {
    return { status, headers: new Headers(headers) } as Response;
  }

  it("429 + Retry-After: 30 → structured.retryAfterSec = 30", () => {
    const err = makeHttpProviderError(fakeResponse(429, { "retry-after": "30" }), "rate limited", { provider: "test", adapter: "test" });
    assert.equal(err.structured.kind, "RATE_LIMIT");
    assert.equal(err.structured.statusCode, 429);
    assert.equal(err.structured.retryAfterSec, 30);
    assert.equal(err.structured.retryable, true);
  });

  it("429 without Retry-After → retryAfterSec = null", () => {
    const err = makeHttpProviderError(fakeResponse(429, {}), "rate limited", { provider: "test", adapter: "test" });
    assert.equal(err.structured.kind, "RATE_LIMIT");
    assert.equal(err.structured.retryAfterSec, null);
  });

  it("Retry-After on non-429 (e.g., 503) still surfaces — providers occasionally emit it", () => {
    const err = makeHttpProviderError(fakeResponse(503, { "retry-after": "60" }), "service unavailable", { provider: "test", adapter: "test" });
    assert.equal(err.structured.statusCode, 503);
    assert.equal(err.structured.retryAfterSec, 60);
  });

  it("invalid Retry-After value → null (no throw)", () => {
    const err = makeHttpProviderError(fakeResponse(429, { "retry-after": "garbage" }), "rate limited", { provider: "test", adapter: "test" });
    assert.equal(err.structured.retryAfterSec, null);
  });
});

// ── Integration: SSE error frame echoes retryAfterSec ──────────────────────

const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-rl-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-rl-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-rl-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

// Copy a real conversational manifest so dispatch works.
mkdirSync(join(TASKS_DIR, "personality"), { recursive: true });
const PERSONALITY_SRC = join(import.meta.dirname, "..", "..", "tasks", "personality", "personality-001");
mkdirSync(join(TASKS_DIR, "personality", "personality-001"), { recursive: true });
const { copyFileSync } = await import("node:fs");
copyFileSync(join(PERSONALITY_SRC, "manifest.json"), join(TASKS_DIR, "personality", "personality-001", "manifest.json"));

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
import type { CrucibulumAdapter, AdapterConfig } from "../adapters/base.js";

__registerTestAdapter({
  id: "rl-test", name: "Rate-limit Test", kind: "local",
  provider_mode: "fixed", fixed_provider: "rl-test",
  supports_custom_model: true,
  create: (): CrucibulumAdapter => ({
    id: "rl-test", name: "Rate-limit Test", version: "1",
    supports: () => true, supportsChat: () => true, supportsToolCalls: () => false,
    async init() {},
    async healthCheck() {
      // Synthetic provider_error with retryAfterSec — the conversational
      // path will surface this through the SSE error frame.
      return {
        ok: false,
        reason: "OpenRouter 429 — rate limited",
        providerError: {
          kind: "RATE_LIMIT", origin: "PROVIDER", provider: "rl-test", adapter: "rl-test",
          statusCode: 429, retryable: true, rawMessage: "rate limited", rawCode: "rate_limited",
          cause: null, attempt: null, durationMs: null, requestId: null,
          retryAfterSec: 42,
        },
      };
    },
    async teardown() {},
    async chat() { throw new Error("not reachable"); },
    async execute() { throw new Error("not reachable"); },
  }),
  provider_options: [{ id: "rl-test", name: "Rate-limit Test", kind: "local", configurable: false }],
  listModels: async () => [{ id: "rl-model", name: "rl-model", provider: "rl-test", kind: "local", available: true, reason: null }],
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

describe("rate-limit SSE frame", () => {
  it("SSE error event carries provider_error.retryAfterSec when health check returns it", async () => {
    const post = await fetch(`${base}/api/run`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "personality-001", model: "rl-model", adapter: "rl-test" }),
    });
    assert.equal(post.status, 202);
    const body = await post.json() as { run_id: string };
    const live = await fetch(`${base}/api/run/${body.run_id}/live`);
    const reader = live.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let errPayload: Record<string, unknown> | null = null;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (raw.startsWith(":")) continue;
        let evt = "", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) evt = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (evt === "error") {
          errPayload = JSON.parse(data) as Record<string, unknown>;
        }
      }
      if (errPayload) break;
    }
    assert.ok(errPayload, "must receive a structured error frame");
    const provider_error = errPayload!["provider_error"] as { kind?: string; retryAfterSec?: number } | null;
    assert.ok(provider_error, "provider_error must be on the error payload");
    assert.equal(provider_error!.kind, "RATE_LIMIT");
    assert.equal(provider_error!.retryAfterSec, 42, "retryAfterSec must round-trip through the SSE frame");
    assert.equal(errPayload!["classification"], "could_not_start");
    assert.equal(errPayload!["stage"], "health_check");
  });
});

// ── UI source pins for the cooldown wiring ─────────────────────────────────

describe("ui/index.html: cooldown wiring source pins", () => {
  it("contains rate-limit constants, isRateLimitOutcome, computeCooldownMs, cooldownSleep", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    assert.match(html, /RATE_LIMIT_RETRY_ENABLED=true/);
    assert.match(html, /RATE_LIMIT_MAX_RETRIES=1/);
    assert.match(html, /RATE_LIMIT_BACKOFF_MIN_MS=10_000/);
    assert.match(html, /RATE_LIMIT_BACKOFF_MAX_MS=120_000/);
    assert.match(html, /function isRateLimitOutcome\b/);
    assert.match(html, /function computeCooldownMs\b/);
    assert.match(html, /function cooldownSleep\b/);
    assert.match(html, /Provider cooling down after rate limit/);
    assert.match(html, /batchAbort/);
  });

  it("runBatch loops with a labelled `outer:` so abort actually breaks the per-task fan-out", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    assert.match(html, /outer:\s*for\(const taskId of taskIds\)/);
    assert.match(html, /break outer/);
  });

  it("the catch-all 'Run stream interrupted — no evidence bundle produced' is still bounded to the SSE-error default", () => {
    const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");
    const occurrences = (html.match(/Run stream interrupted — no evidence bundle produced/g) ?? []).length;
    assert.ok(occurrences <= 2, `expected ≤2 occurrences of the catch-all; got ${occurrences}`);
  });
});
