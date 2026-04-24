import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import {
  makeEmptyResponseError,
  makeHttpProviderError,
  makeInvalidResponseError,
  makeProcessProviderError,
  normalizeProviderError,
} from "../core/provider-errors.js";
import { normalizeVerdict } from "../core/verdict.js";

function makeBundle(overrides: Partial<EvidenceBundle> & {
  pass?: boolean;
  total?: number;
  rawError?: string | null;
} = {}): EvidenceBundle {
  const pass = overrides.pass ?? false;
  const total = overrides.total ?? (pass ? 0.9 : 0);
  return {
    bundle_id: "run_provider_error_bundle",
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: { id: "task-1", manifest_hash: "sha256:m", family: "spec_discipline", difficulty: "medium" },
    agent: { adapter: "openrouter", adapter_version: "1.0.0", system: "test", system_version: "1.0.0", model: "model", model_version: "1.0.0", provider: "openrouter" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc", crucibulum_version: "1.0.0", timestamp_start: "2026-04-20T00:00:00.000Z", timestamp_end: "2026-04-20T00:00:05.000Z" },
    timeline: overrides.rawError ? [{ t: 0, type: "error", detail: overrides.rawError }] : [{ t: 0, type: "task_complete", detail: "done" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: pass ? 1 : 0, details: {}, command_results: [] },
      regression: { score: 1, details: {}, command_results: [] },
      integrity: { score: 1, details: {}, violations: [] },
      efficiency: { time_sec: 5, time_limit_sec: 300, steps_used: 2, steps_limit: 20, score: 0.9 },
    },
    score: {
      scale: "fraction_0_1",
      total,
      total_percent: Math.round(total * 100),
      breakdown: { correctness: pass ? 1 : 0, regression: 1, integrity: 1, efficiency: 0.9 },
      breakdown_percent: { correctness: pass ? 100 : 0, regression: 100, integrity: 100, efficiency: 90 },
      pass,
      pass_threshold: 0.7,
      pass_threshold_percent: 70,
      integrity_violations: 0,
    },
    usage: { tokens_in: 100, tokens_out: 50, estimated_cost_usd: 0.01, provider_cost_note: "test" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "test", verifier_model: null, components: ["judge"] },
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      bundle_verified: true,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: { localized_correctly: pass, avoided_decoys: true, first_fix_correct: pass, self_verified: false, failure_mode: pass ? null : "wrong_output" },
    integrations: {
      veritor: { contract_version: "1.0.0", consumable: true },
      paedagogus: {
        contract_version: "1.0.0",
        consumable: true,
        routing_signals: {
          task_family: "spec_discipline",
          difficulty: "medium",
          provider: "openrouter",
          adapter: "openrouter",
          score: total,
          pass,
          failure_mode: pass ? null : "wrong_output",
        },
      },
      crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: Math.round(total * 100), divergence_note: null },
    },
    verdict: undefined,
    ...overrides,
  };
}

describe("structured provider error normalization", () => {
  it("maps timeout, connection reset, and dns failures", () => {
    const timeout = normalizeProviderError(new Error("request timed out"), { provider: "openai", adapter: "openai" });
    const reset = normalizeProviderError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), { provider: "openai", adapter: "openai" });
    const dns = normalizeProviderError(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }), { provider: "openai", adapter: "openai" });
    assert.equal(timeout.kind, "TIMEOUT");
    assert.equal(reset.kind, "CONNECTION_RESET");
    assert.equal(reset.origin, "NETWORK");
    assert.equal(dns.kind, "DNS");
    assert.equal(dns.origin, "NETWORK");
  });

  it("maps HTTP 429 and 503 into canonical provider errors", () => {
    const rateLimit = makeHttpProviderError(new Response("slow down", { status: 429 }), "slow down", { provider: "openrouter", adapter: "openrouter" }).structured;
    const unavailable = makeHttpProviderError(new Response("down", { status: 503 }), "down", { provider: "anthropic", adapter: "anthropic" }).structured;
    assert.equal(rateLimit.kind, "RATE_LIMIT");
    assert.equal(rateLimit.statusCode, 429);
    assert.equal(unavailable.kind, "UNAVAILABLE");
    assert.equal(unavailable.statusCode, 503);
  });

  it("maps empty response, invalid payload, and process failure", () => {
    const empty = makeEmptyResponseError({ provider: "minimax", adapter: "minimax" }, "empty").structured;
    const invalid = makeInvalidResponseError({ provider: "minimax", adapter: "minimax" }, "bad json").structured;
    const processError = makeProcessProviderError({ provider: "openclaw", adapter: "openclaw" }, "spawn ENOENT", "ENOENT").structured;
    assert.equal(empty.kind, "EMPTY_RESPONSE");
    assert.equal(invalid.kind, "INVALID_RESPONSE");
    assert.equal(processError.kind, "PROCESS_ERROR");
    assert.equal(processError.origin, "LOCAL_RUNTIME");
  });
});

describe("providerErrorDetail: operator-facing failure text", () => {
  it("pairs the bucket summary with the raw message so MiniMax-style base_resp errors are readable", async () => {
    // Pins the exact bug the user reported: "Invalid provider payload" was
    // showing up on every run because the server kept only the bucket
    // summary. The rawMessage (e.g. "MiniMax error 2049: invalid api key")
    // carries the real cause — providerErrorDetail preserves both.
    const { providerErrorDetail } = await import("../core/provider-errors.js");
    const providerError = makeInvalidResponseError(
      { provider: "minimax", adapter: "minimax" },
      "MiniMax error 2049: invalid api key (base=https://api.minimax.io/v1)",
    ).structured;
    const detail = providerErrorDetail(providerError);
    assert.match(detail, /Invalid provider payload/, "summary bucket must still appear so the failure class is legible");
    assert.match(detail, /MiniMax error 2049/, "detail must preserve the underlying provider error code + message");
    assert.match(detail, /invalid api key/i, "detail must reach the operator — not just the generic bucket");
    assert.match(detail, /api\.minimax\.io/, "base URL from rawMessage helps the operator debug regional endpoint mismatches");
  });

  it("does not double up when rawMessage already starts with the bucket summary", async () => {
    const { providerErrorDetail } = await import("../core/provider-errors.js");
    const providerError = makeInvalidResponseError(
      { provider: "minimax", adapter: "minimax" },
      "Invalid provider payload: upstream returned empty choices array",
    ).structured;
    const detail = providerErrorDetail(providerError);
    // Must not emit "Invalid provider payload — Invalid provider payload: …"
    const matches = detail.match(/Invalid provider payload/gi) || [];
    assert.equal(matches.length, 1, "prefix-matching rawMessage must not be duplicated against the bucket");
  });

  it("falls back to the bucket summary when rawMessage is empty", async () => {
    const { providerErrorDetail } = await import("../core/provider-errors.js");
    const providerError = makeInvalidResponseError(
      { provider: "minimax", adapter: "minimax" },
      "",
    ).structured;
    const detail = providerErrorDetail(providerError);
    assert.equal(detail, "Invalid provider payload", "no raw detail ⇒ fall back to the bucket summary alone");
  });
});

describe("structured provider verdict integration", () => {
  it("classifies structured provider timeout as NC instead of FAIL", () => {
    const providerError = normalizeProviderError(new Error("request timed out"), { provider: "openai", adapter: "openai" });
    const verdict = normalizeVerdict({
      bundle: makeBundle({ pass: false, total: 0.1 }),
      executionMode: "conversational",
      exitReason: "error",
      providerError,
    });
    assert.equal(verdict.completionState, "NC");
    assert.equal(verdict.failureReasonCode, "provider_timeout");
    assert.equal(verdict.countsTowardFailureRate, false);
  });

  it("classifies structured network reset, rate limit, invalid payload, empty response, and process failure as NC", () => {
    const reset = normalizeVerdict({
      bundle: makeBundle({ pass: false }),
      executionMode: "repo",
      exitReason: "error",
      providerError: normalizeProviderError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }), { provider: "openrouter", adapter: "openrouter" }),
    });
    const rateLimit = normalizeVerdict({
      bundle: makeBundle({ pass: false }),
      executionMode: "repo",
      exitReason: "error",
      providerError: makeHttpProviderError(new Response("slow down", { status: 429 }), "slow down", { provider: "openrouter", adapter: "openrouter" }).structured,
    });
    const invalid = normalizeVerdict({
      bundle: makeBundle({ pass: false }),
      executionMode: "repo",
      exitReason: "error",
      providerError: makeInvalidResponseError({ provider: "openrouter", adapter: "openrouter" }, "invalid json").structured,
    });
    const empty = normalizeVerdict({
      bundle: makeBundle({ pass: false }),
      executionMode: "repo",
      exitReason: "error",
      providerError: makeEmptyResponseError({ provider: "openrouter", adapter: "openrouter" }, "empty").structured,
    });
    const processError = normalizeVerdict({
      bundle: makeBundle({ pass: false }),
      executionMode: "repo",
      exitReason: "error",
      providerError: makeProcessProviderError({ provider: "openclaw", adapter: "openclaw" }, "spawn ENOENT").structured,
    });
    assert.equal(reset.failureReasonCode, "network_connection_reset");
    assert.equal(rateLimit.failureReasonCode, "provider_rate_limited");
    assert.equal(invalid.failureReasonCode, "provider_invalid_response");
    assert.equal(empty.failureReasonCode, "provider_empty_response");
    assert.equal(processError.failureReasonCode, "provider_process_error");
    assert.equal(processError.completionState, "NC");
  });

  it("prefers structured errors over conflicting raw text", () => {
    const verdict = normalizeVerdict({
      bundle: makeBundle({ pass: false, rawError: "wrong_output" }),
      executionMode: "repo",
      exitReason: "error",
      rawError: "wrong_output",
      providerError: makeHttpProviderError(new Response("slow down", { status: 429 }), "slow down", { provider: "openrouter", adapter: "openrouter" }).structured,
    });
    assert.equal(verdict.completionState, "NC");
    assert.equal(verdict.failureReasonCode, "provider_rate_limited");
  });

  it("keeps legacy raw-text compatibility when no structured error exists", () => {
    const verdict = normalizeVerdict({
      bundle: makeBundle({ pass: false, rawError: "ECONNRESET while contacting provider" }),
      executionMode: "repo",
      exitReason: "error",
      rawError: "ECONNRESET while contacting provider",
    });
    assert.equal(verdict.completionState, "NC");
    assert.equal(verdict.failureReasonCode, "network_connection_reset");
  });
});
