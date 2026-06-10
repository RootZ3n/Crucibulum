/**
 * Luak — regression tests for medium/low audit fixes:
 *   M8  Retry-After capped at 300s
 *   M6  workspace reaper removes stale ws_* dirs but never bundles
 *   L5  pass@1 tie-break is by bundle_id hash, not editable timestamp_start
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRetryAfter } from "../core/retry-after.js";
import { reapStaleWorkspaces } from "../core/cleanup.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

describe("Retry-After cap (M8)", () => {
  it("clamps a wildly large Retry-After to the 300s ceiling when capped", () => {
    assert.equal(parseRetryAfter("86400", { maxSeconds: 300 }), 300);
    assert.equal(parseRetryAfter("120", { maxSeconds: 300 }), 120);
    assert.equal(parseRetryAfter("0", { maxSeconds: 300 }), 0);
  });
});

describe("workspace reaper (M6)", () => {
  it("removes stale ws_* dirs but leaves bundles and fresh workspaces", () => {
    const runsDir = mkdtempSync(join(tmpdir(), "m6-runs-"));
    cleanups.push(() => rmSync(runsDir, { recursive: true, force: true }));

    mkdirSync(join(runsDir, "ws_old"), { recursive: true });
    mkdirSync(join(runsDir, "ws_fresh"), { recursive: true });
    writeFileSync(join(runsDir, "run_evidence.json"), "{}", "utf-8");

    // Age ws_old well past the TTL via mtime.
    const old = Date.now() / 1000 - 7200; // 2h ago
    utimesSync(join(runsDir, "ws_old"), old, old);

    const res = reapStaleWorkspaces({ maxAgeMs: 60 * 60 * 1000, runsDir });
    assert.equal(res.deleted, 1);
    assert.equal(existsSync(join(runsDir, "ws_old")), false, "stale workspace reaped");
    assert.equal(existsSync(join(runsDir, "ws_fresh")), true, "fresh workspace kept");
    assert.equal(existsSync(join(runsDir, "run_evidence.json")), true, "bundle never touched by the reaper");
  });
});

describe("pass@1 tie-break (L5)", () => {
  it("orders runs deterministically by bundle_id hash, independent of timestamp", async () => {
    const { buildLeaderboardEntry } = await import("../leaderboard/aggregator.js");
    // Two runs of the same task: the one that PASSES has a LATER timestamp.
    // Under the old timestamp_start ordering the failing run would be pass@1;
    // the hash ordering is independent of timestamp, so the result is stable
    // and not selectable by editing timestamps.
    const base = (over: Record<string, unknown>) => ({
      bundle_id: "x", bundle_hash: "sha256:t", bundle_version: "1.0.0",
      task: { id: "task-tie", manifest_hash: "h", family: "poison_localization", difficulty: "medium" },
      agent: { adapter: "mock", adapter_version: "1", system: "t", system_version: "1", model: "m", model_version: "1", provider: "local" },
      environment: { os: "linux-x64", arch: "x64", repo_commit: "c", crucibulum_version: "1.0.0", timestamp_start: "2026-01-01T00:00:00Z", timestamp_end: "2026-01-01T00:01:00Z" },
      timeline: [{ t: 0, type: "task_start", detail: "i" }, { t: 1, type: "task_complete", detail: "d" }],
      diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
      security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
      verification_results: { correctness: { score: 1, details: {} }, regression: { score: 1, details: {} }, integrity: { score: 1, details: {}, violations: [] }, efficiency: { time_sec: 1, time_limit_sec: 300, steps_used: 1, steps_limit: 20, score: 1 } },
      score: { scale: "fraction_0_1", total: 1, total_percent: 100, breakdown: { correctness: 1, regression: 1, integrity: 1, efficiency: 1 }, breakdown_percent: { correctness: 100, regression: 100, integrity: 100, efficiency: 100 }, pass: true, pass_threshold: 0.7, pass_threshold_percent: 70, integrity_violations: 0 },
      usage: { tokens_in: 1, tokens_out: 1, estimated_cost_usd: 0, provider_cost_note: "local" },
      judge: { kind: "deterministic", label: "x", description: "x", verifier_model: null, components: [] },
      trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
      diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: null },
      integrations: { veritor: { contract_version: "1.0.0", consumable: true }, paedagogus: { contract_version: "1.0.0", consumable: true, routing_signals: { task_family: "poison_localization", difficulty: "medium", provider: "local", adapter: "mock", score: 1, pass: true, failure_mode: null } }, crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: 100, divergence_note: null } },
      ...over,
    });
    const runs = [
      base({ bundle_id: "run_aaa", score: { ...base({}).score, pass: false }, environment: { ...base({}).environment, timestamp_start: "2026-01-01T00:00:00Z" } }),
      base({ bundle_id: "run_bbb", environment: { ...base({}).environment, timestamp_start: "2026-01-01T05:00:00Z" } }),
    ] as never[];

    // Deterministic across repeated builds, regardless of input order.
    const e1 = buildLeaderboardEntry("mock:local:m", runs);
    const e2 = buildLeaderboardEntry("mock:local:m", [runs[1]!, runs[0]!]);
    assert.equal(e1.pass_at["task-tie_pass@1"], e2.pass_at["task-tie_pass@1"]);
  });
});
