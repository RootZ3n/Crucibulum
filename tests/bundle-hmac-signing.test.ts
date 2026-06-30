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

  it("rejects signed bundles after trust-relevant fields are mutated", () => {
    process.env["LUAK_HMAC_KEY"] = "c2-test-secret-key";
    delete process.env["CRUCIBLE_HMAC_KEY"];

    const mutations: Array<[string, (bundle: EvidenceBundle) => void]> = [
      ["verdict", (bundle) => {
        bundle.verdict = {
          ...bundle.verdict!,
          completionState: "FAIL",
          failureOrigin: "MODEL",
          failureReasonCode: "low_score",
          failureReasonSummary: "tampered verdict",
          countsTowardModelScore: true,
          countsTowardFailureRate: true,
        };
      }],
      ["score", (bundle) => {
        bundle.score = { ...bundle.score, total: 0, total_percent: 0, pass: false };
      }],
      ["agent.model", (bundle) => {
        bundle.agent = { ...bundle.agent, model: "tampered-model" };
      }],
      ["agent.adapter", (bundle) => {
        bundle.agent = { ...bundle.agent, adapter: "tampered-adapter" };
      }],
      ["task.id", (bundle) => {
        bundle.task = { ...bundle.task, id: "tampered-task" };
      }],
      ["trust.verified", (bundle) => {
        bundle.trust = { ...bundle.trust, verified: false } as EvidenceBundle["trust"] & { verified: boolean };
      }],
    ];

    for (const [field, mutate] of mutations) {
      const bundle = signBundle(buildUnsignedBundle());
      mutate(bundle);
      const result = verifyBundle(bundle);
      assert.equal(result.valid, false, `${field} mutation must not verify`);
      assert.notEqual(result.signature_status, "valid", `${field} mutation must not keep a valid signature`);
    }
  });

  it("rejects a directly forged/edited signature even when the real key is present", () => {
    // Threat model: an attacker edits the bundle JSON on disk while the
    // verifier still has the legitimate key. Key rotation (above) covers a
    // wrong key; this covers a fabricated signature value under the right key.
    process.env["LUAK_HMAC_KEY"] = "c2-test-secret-key";
    delete process.env["CRUCIBLE_HMAC_KEY"];

    const valid = signBundle(buildUnsignedBundle());
    const goodSig = valid.signature as string;

    const forgeries: Array<[string, string]> = [
      ["garbage value", "hmac-sha256:" + "0".repeat(64)],
      ["truncated", goodSig.slice(0, goodSig.length - 8)],
      ["bit-flipped last char", goodSig.slice(0, -1) + (goodSig.endsWith("a") ? "b" : "a")],
      ["prefix only", "hmac-sha256:"],
    ];

    for (const [label, sig] of forgeries) {
      const bundle = signBundle(buildUnsignedBundle());
      bundle.signature = sig;
      const result = verifyBundle(bundle);
      assert.equal(result.valid, false, `${label}: a forged signature must not verify`);
      assert.equal(result.signature_status, "forged", `${label}: must classify as forged, got ${result.signature_status}`);
    }
  });

  it("a signed bundle without a key at verify time fails gracefully", () => {
    process.env["LUAK_HMAC_KEY"] = "c2-test-secret-key";
    delete process.env["CRUCIBLE_HMAC_KEY"];
    const bundle = signBundle(buildUnsignedBundle());

    delete process.env["LUAK_HMAC_KEY"];
    const result = verifyBundle(bundle);
    assert.equal(result.signature_status, "unsigned_key_missing");
    assert.equal(result.valid, false);
    assert.equal(result.computed_signature, null);
  });

  it("treats an empty HMAC key as missing", () => {
    process.env["LUAK_HMAC_KEY"] = "";
    delete process.env["CRUCIBLE_HMAC_KEY"];
    const bundle = signBundle(buildUnsignedBundle());
    assert.equal(bundle.signature, undefined);

    const result = verifyBundle(bundle);
    assert.equal(result.signature_status, "legacy_unverified");
    assert.equal(result.valid, false);
  });

  it("documents weak non-empty HMAC key behavior", () => {
    process.env["LUAK_HMAC_KEY"] = "x";
    delete process.env["CRUCIBLE_HMAC_KEY"];
    const bundle = signBundle(buildUnsignedBundle());

    assert.ok(bundle.signature?.startsWith("hmac-sha256:"));
    const result = verifyBundle(bundle);
    assert.equal(result.signature_status, "valid");
    assert.equal(result.valid, true);
  });
});
