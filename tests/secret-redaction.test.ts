/**
 * Luak — H2 regression: provider secrets do not survive into bundles or logs.
 *
 * Provider 401/403/429 bodies echo Authorization headers / key fragments.
 * They must be redacted before being hashed into an evidence bundle and before
 * reaching the logger. Also covers the extended pattern set (sk-ant, AIza, JWT,
 * Google ?key=).
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactSecrets, redactDeep } from "../core/redact.js";
import { storeBundle } from "../core/bundle.js";
import type { EvidenceBundle } from "../adapters/base.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

describe("redactSecrets extended patterns (H2)", () => {
  it("masks anthropic, google, JWT, and ?key= secrets", () => {
    assert.ok(!redactSecrets("key sk-ant-api03-AAAA1111BBBB2222CCCC").includes("sk-ant-api03"));
    assert.ok(!redactSecrets("AIzaSyA1234567890abcdefghijklmnopqrstuvwx").includes("AIzaSy"));
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc-DEF_123";
    assert.ok(!redactSecrets(`token ${jwt}`).includes("eyJhbGci"));
    assert.ok(!redactSecrets("https://x/models?key=AIzaSecretValue123456&z=1").includes("AIzaSecretValue123456"));
  });

  it("redactDeep scrubs nested string values while preserving shape", () => {
    const out = redactDeep({ a: [{ msg: "Authorization: Bearer sk-or-v1-deadbeefdeadbeef" }], n: 5, ok: true });
    assert.equal(out.n, 5);
    assert.equal(out.ok, true);
    assert.ok(!JSON.stringify(out).includes("sk-or-v1-deadbeef"));
  });
});

describe("bundle storage redaction (H2)", () => {
  it("a provider error containing an API key is redacted in the stored bundle", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "h2-runs-"));
    cleanups.push(() => rmSync(runsDir, { recursive: true, force: true }));
    const prev = process.env["CRUCIBULUM_RUNS_DIR"];
    process.env["CRUCIBULUM_RUNS_DIR"] = runsDir;
    cleanups.push(() => { if (prev === undefined) delete process.env["CRUCIBULUM_RUNS_DIR"]; else process.env["CRUCIBULUM_RUNS_DIR"] = prev; });

    const leakedKey = "sk-or-v1-thisisasecretproviderkey0000";
    const bundle = {
      bundle_id: "h2-test-bundle",
      bundle_hash: "sha256:pending",
      bundle_version: "1.0.0",
      task: { id: "t", manifest_hash: "h", family: "safety", difficulty: "easy" },
      agent: { adapter: "openrouter", adapter_version: "1", system: "x", system_version: "1", model: "m", model_version: "latest", provider: "openrouter" },
      environment: { os: "linux-x64", arch: "x64", repo_commit: "none", crucibulum_version: "1.0.0", timestamp_start: "2026-06-10T00:00:00Z", timestamp_end: "2026-06-10T00:00:01Z" },
      timeline: [
        { t: 0, type: "error", detail: `provider 401: {"error":"invalid key","authorization":"Bearer ${leakedKey}"}` },
      ],
      provider_attempts: [
        { attempt: 1, started_at: "2026-06-10T00:00:00Z", duration_ms: 10, error_type: "AUTH", retry_decision: "stop", provider_error: { kind: "AUTH", origin: "PROVIDER", provider: "openrouter", rawMessage: `401 Authorization: Bearer ${leakedKey}` } },
      ],
      diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
      security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
      verification_results: { correctness: { score: 0, details: {} }, regression: { score: 0, details: {} }, integrity: { score: 0, details: {}, violations: [] }, efficiency: { time_sec: 0, time_limit_sec: 0, steps_used: 0, steps_limit: 0, score: 0 } },
      score: { scale: "fraction_0_1", total: 0, total_percent: 0, breakdown: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 }, breakdown_percent: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 }, pass: false, pass_threshold: 0.5, pass_threshold_percent: 50, integrity_violations: 0 },
      usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: `via openrouter key ${leakedKey}` },
      judge_usage: { provider: "", model: "", tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, kind: "deterministic", note: "" },
      judge: { kind: "deterministic", label: "x", description: "x", verifier_model: null, components: [] },
      trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
      diagnosis: { localized_correctly: false, avoided_decoys: false, first_fix_correct: false, self_verified: false, failure_mode: null },
    } as unknown as EvidenceBundle;

    const filePath = storeBundle(bundle);
    const onDisk = readFileSync(filePath, "utf-8");
    assert.ok(!onDisk.includes(leakedKey), "the API key must not appear anywhere in the stored bundle");
    assert.ok(onDisk.includes("[redacted]"), "expected redaction marker in the stored bundle");
  });
});
