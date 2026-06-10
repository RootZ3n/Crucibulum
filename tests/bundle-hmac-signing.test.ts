/**
 * Luak — C2 regression: HMAC signing makes the integrity model real.
 *
 * Without an HMAC key, a bundle carries only a content hash (a public, keyless
 * function) and verifies to signature_status="legacy_unverified" — forged and
 * legitimate bundles are indistinguishable. With a key set, the bundle is
 * signed and verifies to signature_status="valid". start.sh now generates and
 * persists a key on first launch so this path is active by default.
 *
 * node --test isolates each test file in its own process, so mutating
 * process.env here does not leak into other suites.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildBundle, signBundle, verifyBundle } from "../core/bundle.js";
import type { EvidenceBundle } from "../adapters/base.js";

function buildUnsignedBundle(): EvidenceBundle {
  return buildBundle({
    manifest: {
      id: "t-hmac",
      family: "spec_discipline",
      difficulty: "easy",
      description: "hmac test",
      constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
      scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
      verification: {},
      task: { title: "t", description: "d" },
      metadata: { author: "luak-test", created: "2026-06-10", tags: [], diagnostic_purpose: "test", benchmark_provenance: "hmac-test" },
    } as never,
    oracle: { checks: { correctness: [], regression: [], integrity: [], decoys: [], anti_cheat: { forbidden_code_patterns: [] } }, ground_truth: { bug_location: "", correct_fix_pattern: "" } } as never,
    executionResult: {
      exit_code: 0,
      steps_used: 5,
      tokens_in: 100,
      tokens_out: 200,
      duration_ms: 1000,
      timeline: [{ t: 0, type: "task_start", detail: "start" }],
      adapter_metadata: { provider: "local", system_version: "test" },
    } as never,
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    judgeResult: {
      verification: {
        correctness: { score: 1, details: {} },
        regression: { score: 1, details: {} },
        integrity: { score: 1, details: {}, violations: [] },
        efficiency: { time_sec: 1, time_limit_sec: 900, steps_used: 5, steps_limit: 40, score: 0.9 },
      },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: false, failure_mode: null },
    } as never,
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    startTime: "2026-06-10T00:00:00.000Z",
    endTime: "2026-06-10T00:00:01.000Z",
    workspace: { path: "/tmp/ws", commit: "abc" } as never,
    adapter: { id: "local", version: "1.0.0" } as never,
    model: "test-model",
  });
}

describe("bundle HMAC signing (C2)", () => {
  let savedLuak: string | undefined;
  let savedCrucible: string | undefined;

  beforeEach(() => {
    savedLuak = process.env["LUAK_HMAC_KEY"];
    savedCrucible = process.env["CRUCIBLE_HMAC_KEY"];
  });

  afterEach(() => {
    if (savedLuak === undefined) delete process.env["LUAK_HMAC_KEY"];
    else process.env["LUAK_HMAC_KEY"] = savedLuak;
    if (savedCrucible === undefined) delete process.env["CRUCIBLE_HMAC_KEY"];
    else process.env["CRUCIBLE_HMAC_KEY"] = savedCrucible;
  });

  it("a bundle signed with a key verifies to signature_status=valid", () => {
    process.env["LUAK_HMAC_KEY"] = "c2-test-secret-key";
    delete process.env["CRUCIBLE_HMAC_KEY"];
    const bundle = signBundle(buildUnsignedBundle());
    assert.ok(typeof bundle.signature === "string" && bundle.signature.startsWith("hmac-sha256:"), "expected an HMAC signature");
    const result = verifyBundle(bundle);
    assert.equal(result.signature_status, "valid");
    assert.equal(result.valid, true);
  });

  it("a bundle signed without a key verifies to signature_status=legacy_unverified", () => {
    delete process.env["LUAK_HMAC_KEY"];
    delete process.env["CRUCIBLE_HMAC_KEY"];
    const bundle = signBundle(buildUnsignedBundle());
    assert.equal(bundle.signature, undefined, "no key → no signature");
    const result = verifyBundle(bundle);
    assert.equal(result.signature_status, "legacy_unverified");
    assert.equal(result.valid, false);
  });

  it("a bundle signed with one key cannot be re-verified under a different key (forged)", () => {
    process.env["LUAK_HMAC_KEY"] = "key-A";
    delete process.env["CRUCIBLE_HMAC_KEY"];
    const bundle = signBundle(buildUnsignedBundle());
    // Operator rotates / attacker uses a different key.
    process.env["LUAK_HMAC_KEY"] = "key-B";
    const result = verifyBundle(bundle);
    assert.equal(result.signature_status, "forged");
    assert.equal(result.valid, false);
  });
});
