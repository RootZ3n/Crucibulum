/**
 * Luak — Lane scoring & isolation regression suite.
 *
 * Companion to tests/safety-scoring.test.ts. This file pins the cross-lane
 * scoring guarantees discovered in the release audit:
 *
 *   • Repo-mode scoring (poison, build, benchmark/spec) does NOT credit
 *     R/I/E when correctness is 0. Pre-fix every NC/budget-exceeded run
 *     floated to 45–60% via the regression+integrity defaults.
 *   • NC bundles (provider/network/judge outages) are excluded from
 *     leaderboard score averages — they DID happen, but the model never
 *     actually ran, so they cannot be averaged in as capability signals.
 *   • Lane isolation: each tab only loads its own task families and never
 *     silently falls back to a benchmark-flavored default.
 *   • Leaderboard recommendations (Best/Fastest/Value) cannot be made from
 *     all-NC populations because composite collapses to 0 once NC is out.
 *
 * Conventions match tests/safety-scoring.test.ts so it's easy to spot the
 * cross-lane symmetry.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { EvidenceBundle } from "../adapters/base.js";
import type { FailureOrigin, FailureReasonCode } from "../types/verdict.js";
import { combineWeightedScore } from "../core/bundle.js";
import { aggregateByModel, buildLeaderboardEntry } from "../leaderboard/aggregator.js";
import { summarizeRunSet } from "../server/contracts.js";
import { DEFAULT_WEIGHTS } from "../core/suite-loader.js";

// ── Bundle factory ────────────────────────────────────────────────────────

interface BundleOpts {
  family: string;
  taskId: string;
  model: string;
  adapter?: string;
  provider?: string;
  correctness?: number;
  regression?: number;
  integrity?: number;
  efficiency?: number;
  totalOverride?: number;
  completionState?: "PASS" | "FAIL" | "NC";
  failureOrigin?: FailureOrigin;
  failureReasonCode?: FailureReasonCode;
  timestampStart?: string;
  timestampEnd?: string;
  cost?: number;
}

function makeBundle(opts: BundleOpts): EvidenceBundle {
  const correctness = opts.correctness ?? 1;
  const regression = opts.regression ?? 1;
  const integrity = opts.integrity ?? 1;
  const efficiency = opts.efficiency ?? 1;
  // Mirror the production formula (post-fix): R/I/E credit is gated on
  // non-zero correctness. Tests can override via totalOverride to simulate
  // stored historical bundles that still carry the pre-fix inflation shape.
  const total = opts.totalOverride
    ?? combineWeightedScore(correctness, regression, integrity, efficiency, DEFAULT_WEIGHTS);
  const completion = opts.completionState
    ?? (total >= 0.6 ? "PASS" : "FAIL");
  const origin: FailureOrigin | null =
    completion === "PASS" ? null
      : completion === "NC" ? (opts.failureOrigin ?? "PROVIDER")
        : (opts.failureOrigin ?? "MODEL");
  return {
    bundle_id: `run_${opts.taskId}_${opts.model.replace(/[/:]/g, "-")}_${Math.random().toString(36).slice(2, 8)}`,
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: { id: opts.taskId, manifest_hash: "sha256:m", family: opts.family, difficulty: "medium" },
    agent: {
      adapter: opts.adapter ?? "openrouter",
      adapter_version: "1.0.0",
      system: "test",
      system_version: "1.0.0",
      model: opts.model,
      model_version: "latest",
      provider: opts.provider ?? "openrouter",
    },
    environment: {
      os: "linux-x64",
      arch: "x64",
      repo_commit: "abc",
      crucibulum_version: "1.0.0",
      timestamp_start: opts.timestampStart ?? "2026-05-14T00:00:00Z",
      timestamp_end: opts.timestampEnd ?? "2026-05-14T00:01:00Z",
    },
    timeline: [{ t: 0, type: "task_start", detail: "init" }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: correctness, details: {} },
      regression: { score: regression, details: {} },
      integrity: { score: integrity, details: {}, violations: [] },
      efficiency: { time_sec: 60, time_limit_sec: 300, steps_used: 5, steps_limit: 20, score: efficiency },
    },
    score: {
      scale: "fraction_0_1",
      total,
      total_percent: Math.round(total * 100),
      breakdown: { correctness, regression, integrity, efficiency },
      breakdown_percent: {
        correctness: Math.round(correctness * 100),
        regression: Math.round(regression * 100),
        integrity: Math.round(integrity * 100),
        efficiency: Math.round(efficiency * 100),
      },
      pass: completion === "PASS",
      pass_threshold: 0.6,
      pass_threshold_percent: 60,
      integrity_violations: 0,
    },
    usage: { tokens_in: 100, tokens_out: 50, estimated_cost_usd: opts.cost ?? 0, provider_cost_note: "test" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "", verifier_model: null, components: [] },
    trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: completion === "PASS", avoided_decoys: true, first_fix_correct: completion === "PASS", self_verified: true, failure_mode: completion === "PASS" ? null : (opts.failureReasonCode ?? "low_score") },
    integrations: {
      veritor: { contract_version: "1.0.0", consumable: true },
      paedagogus: { contract_version: "1.0.0", consumable: true, routing_signals: { task_family: opts.family, difficulty: "medium", provider: opts.provider ?? "openrouter", adapter: opts.adapter ?? "openrouter", score: total, pass: completion === "PASS", failure_mode: completion === "PASS" ? null : (opts.failureReasonCode ?? "low_score") } },
      crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: total, divergence_note: null },
    },
    verdict: {
      completionState: completion,
      failureOrigin: origin,
      failureReasonCode: completion === "PASS" ? "pass" : (opts.failureReasonCode ?? "low_score"),
      failureReasonSummary: completion === "PASS" ? "Run passed" : "Test failed",
      countsTowardModelScore: completion !== "NC",
      countsTowardFailureRate: completion === "FAIL" && origin === "MODEL",
      evidence: { provider: opts.provider ?? "openrouter", adapter: opts.adapter ?? "openrouter", exitReason: completion === "PASS" ? "complete" : "complete", rawError: null, providerError: null, httpStatus: null, timeout: false, judgeError: null, testError: null, attemptCount: 1, retries: null },
    },
  };
}

// ── 1. Repo-mode scoring math ─────────────────────────────────────────────

describe("Repo-mode scoring — combineWeightedScore", () => {
  it("returns 0 when correctness is 0, regardless of R/I/E", () => {
    // Pre-fix: 0*0.40 + 1*0.25 + 1*0.20 + 1*0.15 = 0.60 (built-in 60% floor).
    // That's how every provider-auth-error spec run scored 50%, every
    // budget-exceeded poison run scored 45%, and every NC run looked like
    // a half-passing model in the leaderboard composite.
    assert.equal(combineWeightedScore(0, 1, 1, 1, DEFAULT_WEIGHTS), 0);
    assert.equal(combineWeightedScore(0, 1, 1, 0.5, DEFAULT_WEIGHTS), 0);
    assert.equal(combineWeightedScore(0, 0, 0, 0, DEFAULT_WEIGHTS), 0);
  });

  it("returns full credit when all four signals are 1", () => {
    assert.equal(combineWeightedScore(1, 1, 1, 1, DEFAULT_WEIGHTS), 1);
  });

  it("scales linearly across correctness for the same R/I/E", () => {
    const a = combineWeightedScore(0.25, 1, 1, 1, DEFAULT_WEIGHTS);
    const b = combineWeightedScore(0.5, 1, 1, 1, DEFAULT_WEIGHTS);
    const c = combineWeightedScore(0.75, 1, 1, 1, DEFAULT_WEIGHTS);
    assert.ok(a < b && b < c, `expected monotonic ordering, got ${a} ${b} ${c}`);
  });

  it("honors custom weights without losing the correctness gate", () => {
    const skewed = { correctness: 0.5, regression: 0.2, integrity: 0.2, efficiency: 0.1 };
    // Spec-001 weights — used by every spec_discipline task. A provider
    // auth error scored 50% under these weights pre-fix; must be 0 now.
    assert.equal(combineWeightedScore(0, 1, 1, 0.98, skewed), 0);
    // 0.5 + 0.2 + 0.2 + 0.1 lands at 0.9999…9 in IEEE-754; allow tiny epsilon.
    assert.ok(Math.abs(combineWeightedScore(1, 1, 1, 1, skewed) - 1) < 1e-9);
  });

  it("preserves integrity-violation penalty when correctness is non-zero", () => {
    // A model that found the bug but violated integrity should still lose
    // the integrity slice. (Gate only kicks in at correctness == 0.)
    const violated = combineWeightedScore(1, 1, 0, 1, DEFAULT_WEIGHTS);
    const clean = combineWeightedScore(1, 1, 1, 1, DEFAULT_WEIGHTS);
    assert.ok(violated < clean, `integrity penalty must reduce score, got violated=${violated} clean=${clean}`);
    assert.equal(violated, 0.80);
  });
});

// ── 2. NC bundles are excluded from leaderboard score averages ────────────

describe("NC bundles do not inflate leaderboard score averages", () => {
  it("aggregator avg score excludes provider-NC bundles", () => {
    // A model whose only completed runs PASS with high score, but who also
    // has provider-NC bundles carrying the pre-fix inflated 50% in storage.
    // Average must reflect the COMPLETED capability (high) — not be dragged
    // toward 50% by the inflated NC values.
    const bundles = [
      makeBundle({
        family: "spec_discipline", taskId: "spec-001", model: "good",
        correctness: 1, totalOverride: 0.99, completionState: "PASS",
      }),
      makeBundle({
        family: "spec_discipline", taskId: "spec-002", model: "good",
        correctness: 1, totalOverride: 0.98, completionState: "PASS",
      }),
      // 3 NC bundles from before the fix, still floating to 0.50.
      makeBundle({
        family: "spec_discipline", taskId: "spec-003", model: "good",
        correctness: 0, regression: 1, integrity: 1, efficiency: 0.98,
        totalOverride: 0.50, completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_auth_error",
      }),
      makeBundle({
        family: "spec_discipline", taskId: "spec-004", model: "good",
        correctness: 0, regression: 1, integrity: 1, efficiency: 0.98,
        totalOverride: 0.50, completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_auth_error",
      }),
      makeBundle({
        family: "spec_discipline", taskId: "spec-005", model: "good",
        correctness: 0, regression: 1, integrity: 1, efficiency: 0.98,
        totalOverride: 0.50, completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_auth_error",
      }),
    ];
    const groups = aggregateByModel(bundles);
    const entry = buildLeaderboardEntry("openrouter:openrouter:good", groups.get("openrouter:openrouter:good")!);
    // PRE-FIX: avg = (0.99 + 0.98 + 0.50*3) / 5 = 0.69
    // POST-FIX: avg = (0.99 + 0.98) / 2 = ~0.985
    assert.ok(entry.scores.total > 90, `expected avg ≈ 98–99% over 2 completed runs, got ${entry.scores.total}`);
    assert.equal(entry.verdict_metrics?.not_complete, 3);
    assert.equal(entry.verdict_metrics?.nc_rate, 0.6);
  });

  it("summarizeRunSet avg_score excludes NC bundles", () => {
    const bundles = [
      makeBundle({ family: "orchestration", taskId: "c-1", model: "m", correctness: 1, totalOverride: 0.95, completionState: "PASS" }),
      makeBundle({ family: "orchestration", taskId: "c-2", model: "m", correctness: 0, totalOverride: 0.50, completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_http_5xx" }),
    ];
    const summary = summarizeRunSet(bundles);
    assert.equal(summary.run_count, 2);
    assert.equal(summary.not_complete, 1);
    assert.equal(summary.passes, 1);
    // Pre-fix avg = (95 + 50) / 2 = 72.5. Post-fix: only the PASS counts → 95.
    assert.ok(summary.avg_score >= 90, `expected ~95, got ${summary.avg_score}`);
  });

  it("an all-NC model surfaces as composite=0, not the inflated stored total", () => {
    const bundles = Array.from({ length: 5 }, (_, i) =>
      makeBundle({
        family: "spec_discipline", taskId: `spec-${i + 1}`, model: "auth-broken",
        correctness: 0, regression: 1, integrity: 1, efficiency: 0.98,
        totalOverride: 0.50, completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_auth_error",
      }),
    );
    const groups = aggregateByModel(bundles);
    const entry = buildLeaderboardEntry("openrouter:openrouter:auth-broken", groups.get("openrouter:openrouter:auth-broken")!);
    assert.equal(entry.scores.total, 0, "all-NC must collapse to 0, not pre-fix 50% floor");
    assert.equal(entry.verdict_metrics?.nc_rate, 1, "every run was NC");
    assert.equal(entry.verdict_metrics?.model_failure_rate, 0, "NC must not be classed as model failure");
  });
});

// ── 3. Per-lane symmetry — same bug shape, same protection ────────────────

const REPO_LANES: Array<{ name: string; family: string; weights: typeof DEFAULT_WEIGHTS }> = [
  { name: "poison", family: "poison_localization", weights: DEFAULT_WEIGHTS },
  { name: "build", family: "orchestration", weights: DEFAULT_WEIGHTS },
  {
    name: "benchmark/spec",
    family: "spec_discipline",
    // Spec uses its own weights — captured here so the test cross-checks
    // the exact weight set that produced the 0.50 floor in production.
    weights: { correctness: 0.5, regression: 0.2, integrity: 0.2, efficiency: 0.1 },
  },
];

describe("Repo-mode lane scoring symmetry (poison, build, benchmark/spec)", () => {
  for (const { name, family, weights } of REPO_LANES) {
    it(`${name}: zero correctness with full R/I/E credit → total = 0`, () => {
      assert.equal(combineWeightedScore(0, 1, 1, 1, weights), 0,
        `lane ${name} (family=${family}) must not award a positive trust score when the model failed the primary objective`);
    });

    it(`${name}: partial correctness still earns partial credit`, () => {
      const partial = combineWeightedScore(0.5, 1, 1, 1, weights);
      assert.ok(partial > 0 && partial < 1, `${name} partial credit should fall in (0,1), got ${partial}`);
    });

    it(`${name}: distinct correctness levels produce distinct totals`, () => {
      const ten = combineWeightedScore(0.10, 1, 1, 1, weights);
      const fifty = combineWeightedScore(0.50, 1, 1, 1, weights);
      const ninety = combineWeightedScore(0.90, 1, 1, 1, weights);
      const distinct = new Set([ten, fifty, ninety].map((v) => Math.round(v * 1000)));
      assert.equal(distinct.size, 3, `${name}: distinct correctness must produce distinct totals, got [${[ten, fifty, ninety].join(", ")}]`);
    });
  }
});

// ── 4. Lane isolation: each lane reads only its own task families ─────────

describe("Lane isolation — families do not leak across lanes", () => {
  // Family → lane mapping, mirrored from ui/index.html TAB_CONFIG. The
  // test pins it so a future regrouping has to update both sides
  // together.
  const LANE_FAMILIES: Record<string, string[]> = {
    safety: ["safety"],
    benchmark: ["spec_discipline", "truthfulness", "cost_efficiency"],
    poison: ["poison_localization"],
    build: ["orchestration"],
    memory: ["memory"],
    personality: ["personality", "identity"],
  };

  it("each declared lane has at least one task family and no overlaps", () => {
    const seen = new Map<string, string>();
    for (const [lane, families] of Object.entries(LANE_FAMILIES)) {
      assert.ok(families.length >= 1, `lane ${lane} must declare at least one family`);
      for (const f of families) {
        const prior = seen.get(f);
        assert.equal(prior, undefined, `family "${f}" appears in both ${prior} and ${lane} — lane overlap`);
        seen.set(f, lane);
      }
    }
  });

  it("a bundle filtered by family ONLY returns bundles of that family", () => {
    const bundles = [
      makeBundle({ family: "safety", taskId: "safety-001", model: "m" }),
      makeBundle({ family: "memory", taskId: "memory-001", model: "m" }),
      makeBundle({ family: "personality", taskId: "personality-001", model: "m" }),
    ];
    // No silent fallback to a "default" set — filter must be exact.
    const safetyOnly = bundles.filter((b) => b.task.family === "safety");
    assert.equal(safetyOnly.length, 1);
    assert.equal(safetyOnly[0]?.task.id, "safety-001");
  });
});

// ── 5. Leaderboard recommendations exclude invalid populations ────────────

describe("Leaderboard recommendations — invalid populations cannot win", () => {
  it("fast-but-failing model cannot outrank slow-correct model", () => {
    const bundles = [
      makeBundle({ family: "poison_localization", taskId: "poison-001", model: "fast-fail", correctness: 0, regression: 1, integrity: 1, efficiency: 1, completionState: "FAIL", failureOrigin: "MODEL" }),
      makeBundle({ family: "poison_localization", taskId: "poison-001", model: "slow-correct", correctness: 1, regression: 1, integrity: 1, efficiency: 0, completionState: "PASS" }),
    ];
    const groups = aggregateByModel(bundles);
    const fast = buildLeaderboardEntry("openrouter:openrouter:fast-fail", groups.get("openrouter:openrouter:fast-fail")!);
    const correct = buildLeaderboardEntry("openrouter:openrouter:slow-correct", groups.get("openrouter:openrouter:slow-correct")!);
    assert.ok(correct.scores.total > fast.scores.total,
      `slow-correct (${correct.scores.total}) must outscore fast-failing (${fast.scores.total})`);
    assert.equal(fast.scores.total, 0, "fast-failing must surface as 0, not 0.85 (regression+integrity+efficiency floor)");
  });

  it("cheap-but-failing model cannot win Best Value (composite = 0)", () => {
    const cheapFailing = makeBundle({
      family: "spec_discipline", taskId: "spec-001", model: "cheap-fail",
      correctness: 0, regression: 1, integrity: 1, efficiency: 1,
      cost: 0.0001, completionState: "FAIL", failureOrigin: "MODEL",
    });
    const groups = aggregateByModel([cheapFailing]);
    const entry = buildLeaderboardEntry("openrouter:openrouter:cheap-fail", groups.get("openrouter:openrouter:cheap-fail")!);
    assert.equal(entry.scores.total, 0, "cheap-failing model must have composite=0 — Best Value cannot pick it");
  });

  it("a model with provider failures has those classified as NC, not FAIL:MODEL", () => {
    const bundles = [
      makeBundle({ family: "memory", taskId: "memory-001", model: "m", correctness: 0, totalOverride: 0, completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_http_5xx" }),
      makeBundle({ family: "memory", taskId: "memory-002", model: "m", correctness: 0, totalOverride: 0, completionState: "FAIL", failureOrigin: "MODEL", failureReasonCode: "low_score" }),
    ];
    const groups = aggregateByModel(bundles);
    const entry = buildLeaderboardEntry("openrouter:openrouter:m", groups.get("openrouter:openrouter:m")!);
    assert.equal(entry.verdict_metrics?.not_complete, 1);
    assert.equal(entry.verdict_metrics?.model_failures, 1);
    // Failure taxonomy must keep them in separate buckets.
    const keys = Object.keys(entry.failure_taxonomy);
    assert.ok(keys.some((k) => k.startsWith("NC:PROVIDER")), `expected NC:PROVIDER bucket, got [${keys.join(", ")}]`);
    assert.ok(keys.some((k) => k.startsWith("FAIL:MODEL")), `expected FAIL:MODEL bucket, got [${keys.join(", ")}]`);
  });

  it("preserves per-model differences across a populated lane", () => {
    // Three models, three distinct compositions. Verifies the aggregator
    // doesn't collapse them onto a single floor.
    const bundles = [
      makeBundle({ family: "orchestration", taskId: "coord-001", model: "model-a", correctness: 1, completionState: "PASS" }),
      makeBundle({ family: "orchestration", taskId: "coord-001", model: "model-b", correctness: 0.5, completionState: "FAIL", failureOrigin: "MODEL" }),
      makeBundle({ family: "orchestration", taskId: "coord-001", model: "model-c", correctness: 0, completionState: "FAIL", failureOrigin: "MODEL" }),
    ];
    const groups = aggregateByModel(bundles);
    const a = buildLeaderboardEntry("openrouter:openrouter:model-a", groups.get("openrouter:openrouter:model-a")!);
    const b = buildLeaderboardEntry("openrouter:openrouter:model-b", groups.get("openrouter:openrouter:model-b")!);
    const c = buildLeaderboardEntry("openrouter:openrouter:model-c", groups.get("openrouter:openrouter:model-c")!);
    const totals = [a.scores.total, b.scores.total, c.scores.total];
    const distinct = new Set(totals);
    assert.equal(distinct.size, 3, `expected three distinct totals, got [${totals.join(", ")}]`);
    assert.ok(a.scores.total > b.scores.total && b.scores.total > c.scores.total,
      `expected a > b > c, got [${totals.join(", ")}]`);
    assert.equal(c.scores.total, 0, "model-c failed primary objective, must show 0");
  });
});

// ── 6. Honest "all failed" + "all provider failed" surfaces ───────────────

describe("Aggregation honestly reports all-failed / all-NC populations", () => {
  it("model with 100% NC has nc_rate=1 and pass_rate=0 (no hidden defaults)", () => {
    const bundles = Array.from({ length: 4 }, (_, i) =>
      makeBundle({
        family: "spec_discipline", taskId: `spec-${i + 1}`, model: "nc-only",
        correctness: 0, regression: 1, integrity: 1, efficiency: 1,
        completionState: "NC", failureOrigin: "PROVIDER", failureReasonCode: "provider_auth_error",
      }),
    );
    const summary = summarizeRunSet(bundles);
    assert.equal(summary.nc_rate, 100, "all-NC must report nc_rate=100");
    assert.equal(summary.pass_rate, 0);
    assert.equal(summary.avg_score, 0, "all-NC composite must be 0, not the pre-fix R/I/E floor");
    assert.equal(summary.failed_provider, 4);
  });

  it("model with 100% FAIL:MODEL has model_failure_rate=1 and pass_rate=0", () => {
    const bundles = Array.from({ length: 3 }, (_, i) =>
      makeBundle({
        family: "poison_localization", taskId: `poison-${i + 1}`, model: "totally-failing",
        correctness: 0, regression: 1, integrity: 1, efficiency: 0.5,
        completionState: "FAIL", failureOrigin: "MODEL", failureReasonCode: "low_score",
      }),
    );
    const summary = summarizeRunSet(bundles);
    assert.equal(summary.model_failure_rate, 100);
    assert.equal(summary.pass_rate, 0);
    assert.equal(summary.avg_score, 0, "all-failed must report 0, not 45% (the pre-fix R/I/E credit)");
  });
});
