/**
 * Benchmark lane regression for the real UI failure shape:
 * truthfulness-001 on a cloud-style model hits a provider RATE_LIMIT before
 * execution, while the browser fallback may also see Crucible's own read
 * limiter on /status. The product invariant is durable evidence by run_id
 * and no terminal UI fallback to "Run state unreachable".
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const RUNS_DIR = mkdtempSync(join(tmpdir(), "crcb-bench-status-runs-"));
const STATE_DIR = mkdtempSync(join(tmpdir(), "crcb-bench-status-state-"));
const TASKS_DIR = mkdtempSync(join(tmpdir(), "crcb-bench-status-tasks-"));
mkdirSync(join(STATE_DIR, "memory-sessions"), { recursive: true });
process.env["CRUCIBULUM_RUNS_DIR"] = RUNS_DIR;
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
process.env["CRUCIBULUM_MEMORY_DIR"] = join(STATE_DIR, "memory-sessions");
process.env["CRUCIBULUM_TASKS_DIR"] = TASKS_DIR;

const TRUTH_SRC = join(import.meta.dirname, "..", "..", "tasks", "truthfulness", "truthfulness-001", "manifest.json");
const TRUTH_DST = join(TASKS_DIR, "truthfulness", "truthfulness-001");
mkdirSync(TRUTH_DST, { recursive: true });
copyFileSync(TRUTH_SRC, join(TRUTH_DST, "manifest.json"));

const { createApp } = await import("../server/app.js");
const { __registerTestAdapter, __clearTestAdapters } = await import("../adapters/registry.js");
const { activeRuns } = await import("../server/routes/run.js");
import type { CrucibulumAdapter, AdapterConfig } from "../adapters/base.js";

let healthChecks = 0;

__registerTestAdapter({
  id: "bench-rl", name: "Benchmark Rate Limit", kind: "local",
  provider_mode: "fixed", fixed_provider: "openrouter",
  supports_custom_model: true,
  create: (): CrucibulumAdapter => ({
    id: "bench-rl", name: "Benchmark Rate Limit", version: "1",
    supports: () => true, supportsChat: () => true, supportsToolCalls: () => false,
    async init() {},
    async healthCheck() {
      healthChecks += 1;
      return {
        ok: false,
        reason: "OpenRouter rate limited health check",
        providerError: {
          kind: "RATE_LIMIT", origin: "PROVIDER", provider: "openrouter", adapter: "bench-rl",
          statusCode: 429, retryable: true, rawMessage: "rate limited", rawCode: "rate_limited",
          cause: null, attempt: healthChecks, durationMs: 12, requestId: "req-benchmark-rl",
          retryAfterSec: 30,
        },
      };
    },
    async teardown() {},
    async chat() { throw new Error("not reachable"); },
    async execute() { throw new Error("not reachable"); },
  }),
  provider_options: [{ id: "openrouter", name: "OpenRouter", kind: "cloud", configurable: false }],
  listModels: async () => [{ id: "deepseek/deepseek-v4-pro", name: "deepseek/deepseek-v4-pro", provider: "openrouter", kind: "cloud", available: true, reason: null }],
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

async function postTruthfulnessRun(): Promise<{ status: number; runId: string }> {
  const r = await fetch(`${base}/api/run`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ task: "truthfulness-001", model: "deepseek/deepseek-v4-pro", adapter: "bench-rl", provider: "openrouter" }),
  });
  const body = await r.json() as { run_id?: string };
  return { status: r.status, runId: body.run_id ?? "" };
}

async function waitTerminal(runId: string): Promise<{ status: string; bundle_id: string | null; error?: string; provider_error?: { kind?: string; statusCode?: number } | null; failure_stage?: string | null }> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const r = await fetch(`${base}/api/run/${runId}/status`);
    if (r.ok) {
      const body = await r.json() as { status: string; bundle_id: string | null; error?: string; provider_error?: { kind?: string; statusCode?: number } | null; failure_stage?: string | null };
      if (body.status === "error" || body.status === "complete") return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`run ${runId} did not settle`);
}

describe("Benchmark truthfulness pre-execution provider rate-limit", () => {
  it("truthfulness-001 stores minimal failure evidence and hydrates it by final run_id", async () => {
    const post = await postTruthfulnessRun();
    assert.equal(post.status, 202, "POST /api/run must return 202 so the row has a run_id");
    assert.match(post.runId, /^run_/);

    const status = await waitTerminal(post.runId);
    assert.equal(status.status, "error");
    assert.equal(status.failure_stage, "health_check");
    assert.equal(status.provider_error?.kind, "RATE_LIMIT");
    assert.equal(status.provider_error?.statusCode, 429);
    assert.ok(activeRuns.has(post.runId), "activeRuns should retain the settled run inside the retention window");

    const hyd = await fetch(`${base}/api/runs/${post.runId}`);
    assert.equal(hyd.status, 200, "/api/runs/<run_id> must recover persisted evidence");
    const body = await hyd.json() as { bundle: { run_id?: string; task: { id: string; family: string }; agent: { model: string; provider: string }; diagnosis: { failure_mode: string }; provider_attempts?: Array<{ attempt?: number; provider_error?: { kind?: string; statusCode?: number; retryAfterSec?: number } }> } };
    assert.equal(body.bundle.run_id, post.runId);
    assert.equal(body.bundle.task.id, "truthfulness-001");
    assert.equal(body.bundle.task.family, "truthfulness");
    assert.equal(body.bundle.agent.model, "deepseek/deepseek-v4-pro");
    assert.equal(body.bundle.agent.provider, "openrouter");
    assert.equal(body.bundle.diagnosis.failure_mode, "could_not_start/health_check");
    assert.equal(body.bundle.provider_attempts?.[0]?.attempt, 1);
    assert.equal(body.bundle.provider_attempts?.[0]?.provider_error?.kind, "RATE_LIMIT");
    assert.equal(body.bundle.provider_attempts?.[0]?.provider_error?.retryAfterSec, 30);

    activeRuns.delete(post.runId);
    const postGcStatus = await fetch(`${base}/api/run/${post.runId}/status`);
    assert.equal(postGcStatus.status, 200, "post-GC /status must fall through to persisted evidence");
    const postGcHyd = await fetch(`${base}/api/runs/${post.runId}`);
    assert.equal(postGcHyd.status, 200, "post-GC /api/runs/<run_id> must still hydrate the bundle");
  });
});

describe("ui/index.html: Benchmark watcher/rate-limit fallback source pins", () => {
  const html = readFileSync(join(import.meta.dirname, "..", "..", "ui", "index.html"), "utf-8");

  it("does not refresh every lane after each terminal run", () => {
    assert.match(html, /function refreshRunSurfaces\(tabKey,opts\)/);
    assert.match(html, /await refreshRunSurfaces\(tabKey\)/);
    assert.match(html, /await refreshRunSurfaces\(tabKey,\{all:true\}\)/);
    assert.doesNotMatch(html, /for\(const key of Object\.keys\(TAB_CONFIG\)\)await refreshTabData\(key\)/, "old per-run all-tab refresh path would exhaust RATE_READ during Benchmark batches");
  });

  it("pins status read-rate-limit as backoff activity, not a terminal run failure", () => {
    assert.match(html, /isReadRateLimit/);
    assert.match(html, /Status polling rate-limited; backing off/);
    assert.match(html, /setTimeout\(pollOnce,waitSec\*1000\)/);
  });

  it("keeps Benchmark on the same watcher path and avoids stale fast polling", () => {
    assert.match(html, /function watchRunCompletion\(tabKey,runId,taskId,modelId\)/);
    assert.match(html, /return watchRunCompletion\(tabKey,result\.run_id,taskId,modelId\)/);
    const match = html.match(/const POLL_INTERVAL_MS=(\d+);/);
    assert.ok(match, "POLL_INTERVAL_MS must be declared");
    assert.ok(Number(match![1]) >= 1000, "polling must not revert to the old 300ms path");
    assert.doesNotMatch(html, /POLL_INTERVAL_MS=300/);
  });
});
