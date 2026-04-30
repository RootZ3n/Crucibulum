/**
 * Crucible — HTTP route contract tests
 *
 * Stands up the real Crucible app via createApp() bound to an ephemeral
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
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
process.env["CRUCIBLE_HMAC_KEY"] = "route-contract-test-hmac-key";

const { createApp } = await import("../server/app.js");
const { __resetRateLimiterForTests } = await import("../server/rate-limit.js");
const { storeBundle, buildBundle } = await import("../core/bundle.js");
const registry = await import("../core/provider-registry.js");

let server: Server;
let base = "";

// ── setup ───────────────────────────────────────────────────────────────────

function makeBundle(overrides: { taskId?: string; family?: string; model?: string; score?: number; adapter?: string; provider?: string } = {}) {
  return buildBundle({
    manifest: {
      id: overrides.taskId ?? "t-route-1",
      family: overrides.family ?? "spec_discipline",
      difficulty: "easy",
      description: "route contract fixture",
      constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
      scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
      verification: {},
      task: { title: "t", description: "d" },
      metadata: { author: "crucible-test", created: "2026-04-01", tags: [], diagnostic_purpose: "test", benchmark_provenance: "route-contract" },
    } as never,
    oracle: {
      checks: { correctness: [], regression: [], integrity: [], decoys: [], anti_cheat: { forbidden_code_patterns: [] } },
      ground_truth: { bug_location: "", correct_fix_pattern: "" },
    } as never,
    executionResult: {
      exit_code: 0, steps_used: 5, tokens_in: 100, tokens_out: 200, duration_ms: 1000,
      timeline: [{ t: 0, type: "task_start", detail: "s" }],
      adapter_metadata: { provider: overrides.provider ?? "local", system_version: "test" },
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
    adapter: { id: overrides.adapter ?? "local", version: "1.0.0" } as never,
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
    const body = await res.json() as { runs: Array<{ task_id: string }>; task_families: unknown };
    assert.ok(Array.isArray(body.runs));
    assert.ok(body.runs.some((r) => r.task_id === "t-route-seed"));
  });

  it("scopes runs by task_families without leaking other lanes", async () => {
    storeBundle(makeBundle({ taskId: "t-build-only", family: "orchestration", model: "build-model" }));
    storeBundle(makeBundle({ taskId: "t-safety-only", family: "safety", model: "safety-model" }));

    const res = await fetch(`${base}/api/runs?task_families=orchestration`);
    assert.equal(res.status, 200);
    const body = await res.json() as { runs: Array<{ task_id: string; family: string }> };
    assert.ok(body.runs.some((run) => run.task_id === "t-build-only" && run.family === "orchestration"));
    assert.ok(body.runs.every((run) => run.family === "orchestration"));
    assert.ok(body.runs.every((run) => run.task_id !== "t-safety-only"));
  });

  it("does not silently fall back to global data for an unknown task_families scope", async () => {
    const res = await fetch(`${base}/api/runs?task_families=definitely_unknown_lane`);
    assert.equal(res.status, 200);
    const body = await res.json() as { runs: Array<unknown>; task_families: string[] };
    assert.deepEqual(body.task_families, ["definitely_unknown_lane"]);
    assert.equal(body.runs.length, 0);
  });

  it("returns 404 for an unknown bundle id (no silent task.id fallback)", async () => {
    const res = await fetch(`${base}/api/runs/does-not-exist`);
    assert.equal(res.status, 404);
  });
});

describe("route: /api/stats", () => {
  it("returns lane-scoped aggregate stats", async () => {
    storeBundle(makeBundle({ taskId: "t-build-stats-pass", family: "orchestration", model: "builder", score: 0.95 }));
    storeBundle(makeBundle({ taskId: "t-build-stats-fail", family: "orchestration", model: "builder", score: 0.25 }));
    storeBundle(makeBundle({ taskId: "t-memory-stats-pass", family: "memory", model: "memory-bot", score: 0.88 }));

    const buildRes = await fetch(`${base}/api/stats?task_families=orchestration`);
    assert.equal(buildRes.status, 200);
    const buildBody = await buildRes.json() as { total_runs: number; task_families: string[] };
    assert.deepEqual(buildBody.task_families, ["orchestration"]);
    assert.equal(buildBody.total_runs >= 2, true);

    const memoryRes = await fetch(`${base}/api/stats?task_families=memory`);
    assert.equal(memoryRes.status, 200);
    const memoryBody = await memoryRes.json() as { total_runs: number; task_families: string[] };
    assert.deepEqual(memoryBody.task_families, ["memory"]);
    assert.equal(memoryBody.total_runs >= 1, true);
    assert.notEqual(buildBody.total_runs, memoryBody.total_runs, "scoped stats must reflect lane-specific run sets");
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

// ── run POST (selection-to-execution integrity) ─────────────────────────────
//
// Root cause of the spec-only-execution bug: every cloud adapter used to
// declare `supportsChat()=false` and never implement `chat()`. Conversational
// tasks (truthfulness/identity/classification/etc.) fired off /api/run, the
// runner tried to call `adapter.chat()`, threw, and the failed run produced
// no bundle — so the archive showed spec-only history even when mixed-family
// tests were selected. The UI counted the attempt as "done" because SSE 'error'
// resolved the watcher. Fixes: (1) cloud adapters now implement chat(),
// (2) handleRunPost preflights conversational task + chat-capable adapter
// and rejects 422 BEFORE spending tokens so the UI can surface the reason.
//
// These tests pin both halves so the bug cannot return silently.

describe("route: POST /api/run — selection integrity", () => {
  it("422s when a conversational task is routed to an adapter without chat() — no silent spec-only fallback", async () => {
    // openclaw is a subprocess adapter that intentionally has no chat(); a
    // conversational task on this adapter MUST be rejected by preflight, not
    // silently turned into a failed run with zero bundle output.
    const res = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "truthfulness-001",
        adapter: "openclaw",
        provider: "openclaw",
        model: "any",
        count: 1,
      }),
    });
    assert.equal(res.status, 422, "conversational-task + non-chat-adapter must preflight-fail");
    const body = await res.json() as { error: string; reason: string; task_kind: string; adapter_supports_chat: boolean; adapter: string; task: string };
    assert.equal(body.error, "adapter_cannot_run_task");
    assert.equal(body.task_kind, "conversational");
    assert.equal(body.adapter_supports_chat, false);
    assert.equal(body.adapter, "openclaw");
    assert.equal(body.task, "truthfulness-001");
    assert.match(body.reason, /chat/i, "reason must name the missing capability so the UI can surface why");
  });

  it("accepts a conversational task when the adapter advertises chat() (openrouter after the fix)", async () => {
    // The OpenRouter adapter now implements chat(), so preflight must let this
    // through — proving the fix end-to-end: a non-spec selection IS allowed to
    // execute on a cloud model. (The run itself will fail at healthCheck in
    // this test env because no OPENROUTER_API_KEY is set, but that is a
    // downstream error, not a preflight rejection — the contract here is that
    // preflight accepted the request on capability grounds.)
    const res = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "truthfulness-001",
        adapter: "openrouter",
        provider: "openrouter",
        model: "xiaomi/mimo-v2-flash",
        count: 1,
      }),
    });
    assert.equal(res.status, 202, "openrouter now supports chat — conversational task must not be preflight-rejected");
    const body = await res.json() as { ok: boolean; run_id: string };
    assert.equal(body.ok, true);
    assert.ok(typeof body.run_id === "string" && body.run_id.startsWith("run_"));
  });

  it("does NOT preflight repo-based (spec) tasks — existing behavior preserved", async () => {
    // Spec tasks use adapter.execute(), not chat(). Even if adapter.supportsChat()
    // is false, a spec task must still be accepted — we only gate conversational.
    const res = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "spec-001",
        adapter: "openclaw",
        provider: "openclaw",
        model: "any",
        count: 1,
      }),
    });
    assert.equal(res.status, 202, "spec task on a non-chat adapter must still queue (execute() path, not chat())");
  });

  it("preserves the exact task id through the run request — no lane/family substitution", async () => {
    // This is the contract the UI relies on: whatever taskId the client sends
    // is what the server queues. /api/run/:id/status echoes request.task back.
    const post = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "spec-002",
        adapter: "openclaw",
        provider: "openclaw",
        model: "any",
        count: 1,
      }),
    });
    assert.equal(post.status, 202);
    const { run_id } = await post.json() as { run_id: string };
    const status = await fetch(`${base}/api/run/${run_id}/status`);
    assert.equal(status.status, 200);
    const body = await status.json() as { request: { task: string; adapter: string; model: string } | null };
    // request echoes back what was queued; it may have moved to error by now
    // (downstream adapter failure), but the task id must match exactly.
    assert.ok(body.request, "status endpoint must preserve the queued request for introspection");
    assert.equal(body.request!.task, "spec-002", "the queued task id must equal the posted task id — no family fallback");
  });

  it("rewrites stale squidley MiniMax requests to the direct minimax adapter when the model is registered", async () => {
    registry.__wipeForTests();
    const provider = registry.addProvider({ presetId: "minimax", label: "MiniMax Direct", apiKey: "sk-mini" });
    registry.addModel({ providerConfigId: provider.id, modelId: "abab6.5s-chat" });

    const post = await fetch(`${base}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "truthfulness-001",
        adapter: "squidley",
        provider: "minimax",
        model: "abab6.5s-chat",
        count: 1,
      }),
    });
    assert.equal(post.status, 202, "stale client adapter hint must not block a registered direct MiniMax model");

    const { run_id } = await post.json() as { run_id: string };
    const status = await fetch(`${base}/api/run/${run_id}/status`);
    assert.equal(status.status, 200);
    const body = await status.json() as { request: { adapter: string; provider: string | null; model: string } | null };
    assert.ok(body.request, "resolved request must be visible in status");
    assert.equal(body.request!.adapter, "minimax", "server must rewrite stale squidley path to direct minimax");
    assert.equal(body.request!.provider, "minimax");
    assert.equal(body.request!.model, "abab6.5s-chat");
  });
});

// ── adapter capability advertised over /api/adapters ─────────────────────────

describe("route: /api/adapters — chat capability is advertised for every cloud adapter", () => {
  it("cloud adapters report supports_chat=true so the UI can pre-gate selection", async () => {
    const res = await fetch(`${base}/api/adapters`);
    assert.equal(res.status, 200);
    const body = await res.json() as { adapters: Array<{ id: string; supports_chat: boolean; supports_tool_calls: boolean }> };
    const byId = new Map(body.adapters.map((a) => [a.id, a]));
    // Every cloud HTTP adapter must now advertise chat.
    for (const id of ["openrouter", "openai", "anthropic", "minimax", "zai", "squidley", "google"]) {
      const entry = byId.get(id);
      assert.ok(entry, `adapter ${id} must be listed in /api/adapters`);
      assert.equal(entry!.supports_chat, true, `adapter ${id} must advertise supports_chat=true after the chat() implementation landed`);
    }
    // ollama already had chat() — still true.
    assert.equal(byId.get("ollama")?.supports_chat, true);
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

// ── registry CRUD ───────────────────────────────────────────────────────────
//
// The Providers tab in the UI exercises exactly these endpoints. Pinning
// them at the route boundary guarantees that (a) the UI can still add
// providers/models without code edits, and (b) old bundles stay readable
// after registry mutations — the two properties the product brief demanded.

describe("route: /api/registry — data-driven provider/model management", () => {
  it("GET /api/registry/state returns presets + providers + models + catalog", async () => {
    const res = await fetch(`${base}/api/registry/state`);
    assert.equal(res.status, 200);
    const body = await res.json() as { presets: Array<{ id: string; firstClass: boolean }>; providers: unknown[]; models: unknown[]; catalog: unknown[] };
    assert.ok(Array.isArray(body.presets) && body.presets.length > 0);
    const openrouter = body.presets.find((p) => p.id === "openrouter");
    assert.ok(openrouter, "OpenRouter preset must appear in /api/registry/state");
    assert.equal(openrouter!.firstClass, true, "OpenRouter must be first-class in the catalog response");
    assert.ok(body.presets.some((p) => p.id === "modelstudio"), "Model Studio preset must appear");
  });

  it("POST /api/registry/providers adds a provider from a preset WITHOUT code edits, inline key is masked on read", async () => {
    const add = await fetch(`${base}/api/registry/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "openrouter", label: "My OR", apiKey: "sk-or-v1-ZZZZYYYY9999" }),
    });
    assert.equal(add.status, 201);
    const added = await add.json() as { provider: { id: string; apiKeyInline: string; firstClass: boolean } };
    assert.equal(added.provider.apiKeyInline, "****9999", "inline api key must be masked in route response");
    assert.equal(added.provider.firstClass, true);

    // State GET must show the new provider and keep the secret masked.
    const state = await fetch(`${base}/api/registry/state`);
    const body = await state.json() as { providers: Array<{ id: string; apiKeyInline: string | null }> };
    const row = body.providers.find((p) => p.id === added.provider.id);
    assert.ok(row);
    assert.equal(row!.apiKeyInline, "****9999");
  });

  it("POST /api/registry/models and POST /api/registry/models/bulk allow adding qwen3.6-plus through OpenRouter by data alone", async () => {
    const addProv = await fetch(`${base}/api/registry/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "openrouter", label: "OR for bulk", apiKey: "sk-or-v1-test" }),
    });
    const { provider } = await addProv.json() as { provider: { id: string } };

    // Single model add.
    const one = await fetch(`${base}/api/registry/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerConfigId: provider.id, modelId: "qwen/qwen3.6-plus" }),
    });
    assert.equal(one.status, 201);

    // Bulk paste add — the product brief's headline paste example.
    const bulkText = [
      "openai/gpt-5-mini",
      "- anthropic/claude-sonnet-4.5",
      "qwen/qwen3.6-plus",                  // duplicate, must be skipped
      "google/gemini-2.5-pro",
    ].join("\n");
    const bulk = await fetch(`${base}/api/registry/models/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerConfigId: provider.id, pasted: bulkText }),
    });
    assert.equal(bulk.status, 201);
    const bulkBody = await bulk.json() as { added: Array<{ modelId: string }>; skipped: Array<{ modelId: string }> };
    const addedIds = bulkBody.added.map((m) => m.modelId).sort();
    assert.deepEqual(addedIds, [
      "anthropic/claude-sonnet-4.5",
      "google/gemini-2.5-pro",
      "openai/gpt-5-mini",
    ]);
    assert.ok(bulkBody.skipped.some((s) => s.modelId === "qwen/qwen3.6-plus"));
  });

  it("PATCH /api/registry/models/:id toggles enabled without touching other fields", async () => {
    const addProv = await fetch(`${base}/api/registry/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "openrouter", label: "OR for toggle", apiKey: "sk" }),
    });
    const { provider } = await addProv.json() as { provider: { id: string } };
    const add = await fetch(`${base}/api/registry/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerConfigId: provider.id, modelId: "openai/gpt-5-mini" }),
    });
    const { model } = await add.json() as { model: { id: string; enabled: boolean } };
    assert.equal(model.enabled, true);
    const off = await fetch(`${base}/api/registry/models/${model.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    assert.equal(off.status, 200);
    const { model: toggled } = await off.json() as { model: { enabled: boolean } };
    assert.equal(toggled.enabled, false);
  });

  it("POST /api/registry/providers/:id/test returns {ok, reason, provider} and never throws — bad endpoint yields a clean failure", async () => {
    const add = await fetch(`${base}/api/registry/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        presetId: "openai-compatible",
        label: "Deliberately bogus",
        baseUrl: "http://127.0.0.1:1",   // reserved port, nothing listening
        apiKey: "sk-test",
      }),
    });
    const { provider } = await add.json() as { provider: { id: string } };
    const test = await fetch(`${base}/api/registry/providers/${provider.id}/test`, { method: "POST" });
    assert.equal(test.status, 200, "a failed probe must still return 200 with {ok:false} — never a 500");
    const body = await test.json() as { ok: boolean; reason: string; provider: { lastTestedOk: boolean | null } };
    assert.equal(body.ok, false, "probing a dead endpoint must report ok:false");
    assert.ok(body.reason.length > 0, "a reason string is required so the UI can surface it");
    assert.equal(body.provider.lastTestedOk, false, "lastTestedOk persists alongside the reason");
  });

  it("Model Studio is configurable through the SAME registry path as OpenRouter (no preset-specific branch)", async () => {
    const res = await fetch(`${base}/api/registry/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "modelstudio", label: "Model Studio · qwen", apiKey: "ms-key-xxxx" }),
    });
    assert.equal(res.status, 201);
    const { provider } = await res.json() as { provider: { presetId: string; apiKeyInline: string | null } };
    assert.equal(provider.presetId, "modelstudio");
    assert.equal(provider.apiKeyInline, "****xxxx");
  });

  it("existing bundle history remains readable after registry changes — /api/runs still returns the seeded bundle", async () => {
    // Add + remove a provider; then verify /api/runs still lists the
    // pre-seeded bundle created in the suite's `before` hook.
    const add = await fetch(`${base}/api/registry/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "openrouter", label: "transient", apiKey: "k" }),
    });
    const { provider } = await add.json() as { provider: { id: string } };
    await fetch(`${base}/api/registry/providers/${provider.id}`, { method: "DELETE" });

    const runs = await fetch(`${base}/api/runs`);
    assert.equal(runs.status, 200);
    const body = await runs.json() as { runs: Array<{ task_id: string }> };
    assert.ok(body.runs.some((r) => r.task_id === "t-route-seed"), "registry CRUD must not disturb stored bundles");
  });

  it("advertises per-adapter circuit state on /api/adapters so the UI can show degraded providers", async () => {
    const res = await fetch(`${base}/api/adapters`);
    assert.equal(res.status, 200);
    const body = await res.json() as { adapters: Array<{ id: string; circuit: { state: string; failures: number } }> };
    const or = body.adapters.find((a) => a.id === "openrouter");
    assert.ok(or, "openrouter adapter must be listed");
    assert.ok(or!.circuit, "each adapter entry must carry a circuit snapshot");
    assert.ok(["closed", "open", "half-open"].includes(or!.circuit.state));
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

  it("scopes leaderboard rows by task_families", async () => {
    storeBundle(makeBundle({ taskId: "t-build-board", family: "orchestration", model: "build-ranker", score: 0.92 }));
    storeBundle(makeBundle({ taskId: "t-safety-board", family: "safety", model: "safety-ranker", score: 0.41 }));

    const res = await fetch(`${base}/api/leaderboard?task_families=orchestration`);
    assert.equal(res.status, 200);
    const body = await res.json() as { leaderboard: Array<{ model: string }>; task_families: string[]; scope_key: string; eligible_count: number; quarantined_count: number; filters_applied: Record<string, boolean> };
    assert.deepEqual(body.task_families, ["orchestration"]);
    assert.equal(body.scope_key, "orchestration", "scope_key must echo the resolved lane scope so the UI can verify the response matches the request");
    assert.ok(body.leaderboard.some((entry) => entry.model === "build-ranker"));
    assert.ok(body.leaderboard.every((entry) => entry.model !== "safety-ranker"));
    assert.ok(body.eligible_count >= 1);
    assert.equal(body.filters_applied.exclude_legacy_unverified, true);
  });

  it("excludes tampered, legacy-unverified, malformed, and mock bundles from public rankings", async () => {
    storeBundle(makeBundle({ taskId: "trust-good", family: "safety", model: "trust-good", score: 0.91 }));

    const tamperedPath = storeBundle(makeBundle({ taskId: "trust-tampered", family: "safety", model: "trust-tampered", score: 0.91 }));
    const tampered = JSON.parse(readFileSync(tamperedPath, "utf-8")) as Record<string, unknown>;
    tampered["agent"] = { ...(tampered["agent"] as Record<string, unknown>), model: "trust-tampered-edited" };
    writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2) + "\n", "utf-8");

    const legacyPath = storeBundle(makeBundle({ taskId: "trust-legacy", family: "safety", model: "trust-legacy", score: 0.91 }));
    const legacy = JSON.parse(readFileSync(legacyPath, "utf-8")) as Record<string, unknown>;
    delete legacy["signature"];
    writeFileSync(legacyPath, JSON.stringify(legacy, null, 2) + "\n", "utf-8");

    storeBundle(makeBundle({ taskId: "trust-mock", family: "safety", model: "harness-mock", adapter: "harness-mock", provider: "harness-mock", score: 1 }));
    writeFileSync(join(RUNS_DIR, "malformed-public-rank.json"), "{ not json", "utf-8");
    writeFileSync(join(RUNS_DIR, "malformed-safety-shape.json"), JSON.stringify({ bundle_id: "bad-safety", bundle_hash: "sha256:bad", task: { id: "bad-safety", family: "safety" }, trust: {} }), "utf-8");
    writeFileSync(join(RUNS_DIR, "malformed-build-shape.json"), JSON.stringify({ bundle_id: "bad-build", bundle_hash: "sha256:bad", task: { id: "bad-build", family: "orchestration" }, trust: {} }), "utf-8");

    const res = await fetch(`${base}/api/leaderboard?task_families=safety&include_quarantined=1`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      leaderboard: Array<{ model: string }>;
      eligible_count: number;
      quarantined_count: number;
      malformed_count: number;
      malformed_count_in_scope: number;
      malformed_count_total: number;
      malformed_count_unknown_scope: number;
      quarantine_reason_buckets: Record<string, number>;
      quarantine_examples: Array<Record<string, unknown>>;
      excluded_mock_demo: boolean;
      excluded_unverified_or_tampered: boolean;
      ranking_mode: string;
      quarantined: Array<{ model: string; reasons: string[] }>;
    };

    assert.equal(body.ranking_mode, "public_verified");
    assert.equal(body.excluded_mock_demo, true);
    assert.equal(body.excluded_unverified_or_tampered, true);
    assert.ok(body.leaderboard.some((entry) => entry.model === "trust-good"));
    assert.ok(body.leaderboard.every((entry) => !["trust-tampered-edited", "trust-legacy", "harness-mock"].includes(entry.model)));
    assert.ok(body.quarantined_count >= 4);
    assert.equal(body.malformed_count, body.malformed_count_in_scope);
    assert.ok(body.malformed_count_in_scope >= 1);
    assert.ok(body.malformed_count_total >= body.malformed_count_in_scope + 1);
    assert.ok(body.malformed_count_unknown_scope >= 1);
    assert.ok(body.quarantine_reason_buckets["malformed"] >= 1);
    assert.ok(body.quarantined.some((entry) => entry.model === "trust-tampered-edited" && entry.reasons.includes("tampered")));
    assert.ok(body.quarantined.some((entry) => entry.model === "trust-legacy" && entry.reasons.includes("legacy_unverified")));
    assert.ok(body.quarantined.some((entry) => entry.model === "harness-mock" && entry.reasons.includes("mock_or_demo")));
    assert.ok(body.quarantine_examples.every((entry) => !("prompt" in entry) && !("answer" in entry) && !("timeline" in entry)));
  });

  it("returns a safe quarantine/debug summary with reason buckets only", async () => {
    storeBundle(makeBundle({ taskId: "q-good", family: "safety", model: "q-good", score: 0.91 }));
    storeBundle(makeBundle({ taskId: "q-mock", family: "safety", model: "harness-mock", adapter: "harness-mock", provider: "harness-mock", score: 1 }));
    writeFileSync(join(RUNS_DIR, "q-malformed-safety.json"), JSON.stringify({ bundle_id: "q-bad", bundle_hash: "sha256:bad", task: { id: "q-bad", family: "safety" }, trust: {}, prompt: "do not leak" }), "utf-8");

    const res = await fetch(`${base}/api/leaderboard/quarantine?task_families=safety`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      ranking_mode: string;
      reason_buckets: Record<string, number>;
      labels: string[];
      examples: Array<Record<string, unknown>>;
      malformed_count_in_scope: number;
      malformed_count_total: number;
    };
    assert.equal(body.ranking_mode, "public_verified");
    assert.ok(body.reason_buckets["mock_or_demo"] >= 1);
    assert.ok(body.reason_buckets["malformed"] >= 1);
    assert.ok(body.malformed_count_total >= body.malformed_count_in_scope);
    assert.ok(body.labels.includes("NOT RANKED"));
    assert.ok(body.labels.includes("MALFORMED"));
    assert.ok(body.examples.length > 0);
    assert.ok(body.examples.every((entry) => !("prompt" in entry) && !("answer" in entry) && !("timeline" in entry) && !("raw" in entry)));
  });

  it("does not merge the same model name across providers or adapters", async () => {
    storeBundle(makeBundle({ taskId: "identity-openrouter", family: "orchestration", model: "same-name", adapter: "openrouter", provider: "openrouter", score: 0.91 }));
    storeBundle(makeBundle({ taskId: "identity-ollama", family: "orchestration", model: "same-name", adapter: "ollama", provider: "local", score: 0.82 }));

    const res = await fetch(`${base}/api/leaderboard?task_families=orchestration`);
    assert.equal(res.status, 200);
    const body = await res.json() as { leaderboard: Array<{ modelId: string; identity_key: string; adapter: string; provider: string; model: string }> };
    const rows = body.leaderboard.filter((entry) => entry.model === "same-name");
    assert.equal(rows.length, 2);
    assert.equal(new Set(rows.map((entry) => entry.identity_key)).size, 2);
    assert.ok(rows.some((entry) => entry.adapter === "openrouter" && entry.provider === "openrouter"));
    assert.ok(rows.some((entry) => entry.adapter === "ollama" && entry.provider === "local"));
  });

  it("scope_key is order-independent across tabs with multi-family scope", async () => {
    // The personality tab requests task_families=personality,identity; the
    // scope_key must be the canonical (sorted) form so client-side cache keys
    // don't depend on query ordering. Sorted → 'identity,personality'.
    storeBundle(makeBundle({ taskId: "t-persona-1", family: "personality", model: "p-model", score: 0.81 }));
    storeBundle(makeBundle({ taskId: "t-identity-1", family: "identity", model: "i-model", score: 0.88 }));

    const a = await fetch(`${base}/api/leaderboard?task_families=personality,identity`);
    const b = await fetch(`${base}/api/leaderboard?task_families=identity,personality`);
    const ja = await a.json() as { scope_key: string };
    const jb = await b.json() as { scope_key: string };
    assert.equal(ja.scope_key, jb.scope_key, "scope_key must be order-independent");
    assert.equal(ja.scope_key, "identity,personality", "canonical scope_key is the sorted family list joined with ','");
  });

  it("/api/stats returns per-lane verdict metrics (NC excluded from model_failure_rate)", async () => {
    // Seed a build-lane population with 2 passes + 1 model fail (low score).
    // pass_rate counts pass/total; model_failure_rate counts FAIL:MODEL/total;
    // NC counts NC/total. Pinning these together guards against a regression
    // that would bucket an NC into the model-failure column.
    storeBundle(makeBundle({ taskId: "t-build-v-pass-1", family: "orchestration", model: "verdict-model", score: 0.93 }));
    storeBundle(makeBundle({ taskId: "t-build-v-pass-2", family: "orchestration", model: "verdict-model", score: 0.88 }));
    storeBundle(makeBundle({ taskId: "t-build-v-fail", family: "orchestration", model: "verdict-model", score: 0.15 }));

    const res = await fetch(`${base}/api/stats?task_families=orchestration`);
    assert.equal(res.status, 200);
    const body = await res.json() as {
      scope_key: string;
      task_families: string[];
      total_runs: number;
      pass_rate: number;
      model_failure_rate: number;
      model_fail_runs: number;
      nc_rate: number;
      not_complete_runs: number;
      infra_issue_rate: number;
    };
    assert.equal(body.scope_key, "orchestration");
    assert.ok(body.total_runs >= 3, "scoped stats must include every seeded orchestration run");
    // The 0.15-score run is a classic model fail (FAIL:MODEL:low_score).
    // It MUST register in model_failure_rate and MUST NOT register as NC.
    assert.ok(body.model_fail_runs >= 1, "low-score runs must count as model failures");
    assert.ok(body.model_failure_rate > 0, "model_failure_rate must reflect the failed run");
    assert.equal(body.nc_rate, 0, "no NC bundles were seeded, so nc_rate must be 0 — NC is never pooled into model fails");
    assert.equal(body.infra_issue_rate, 0, "no infra failures seeded, so infra rate must be 0");
  });

  it("switching scope changes the leaderboard content — no shared cache identity", async () => {
    // Pin the exact bug the scope leak task targets: a build-lane leaderboard
    // and a safety-lane leaderboard must not share the same set of rows. We
    // seed one model per lane under the same name pattern and assert that
    // hitting the two endpoints back-to-back returns DIFFERENT models.
    storeBundle(makeBundle({ taskId: "t-shared-build", family: "orchestration", model: "lane-exclusive-build", score: 0.91 }));
    storeBundle(makeBundle({ taskId: "t-shared-safety", family: "safety", model: "lane-exclusive-safety", score: 0.77 }));

    const buildRes = await fetch(`${base}/api/leaderboard?task_families=orchestration`);
    const safetyRes = await fetch(`${base}/api/leaderboard?task_families=safety`);
    const buildBody = await buildRes.json() as { leaderboard: Array<{ model: string }>; scope_key: string };
    const safetyBody = await safetyRes.json() as { leaderboard: Array<{ model: string }>; scope_key: string };

    assert.notEqual(buildBody.scope_key, safetyBody.scope_key, "each lane must have its own scope_key");
    assert.ok(buildBody.leaderboard.some((e) => e.model === "lane-exclusive-build"));
    assert.ok(buildBody.leaderboard.every((e) => e.model !== "lane-exclusive-safety"), "build leaderboard must not leak safety-only models");
    assert.ok(safetyBody.leaderboard.some((e) => e.model === "lane-exclusive-safety"));
    assert.ok(safetyBody.leaderboard.every((e) => e.model !== "lane-exclusive-build"), "safety leaderboard must not leak build-only models");
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
