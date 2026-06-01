import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MINIMAX_M3,
  EXPERIMENTAL_TARGETS,
  resolveExperimentalTarget,
  BENCHMARK_CATEGORIES,
  supportedCategories,
  unsupportedCategories,
  plannedTaskIds,
  SMOKE_TASK_ID,
  estimateUsdCost,
  pricingFor,
  evaluateBatch,
  classifyRecommendation,
  buildVerdict,
  type RouteMetrics,
} from "../core/experimental-targets.js";

function route(partial: Partial<RouteMetrics>): RouteMetrics {
  return {
    model: "x",
    tasksRun: 10,
    tasksPassed: 8,
    passRate: 0.8,
    avgLatencyMs: 1000,
    totalCostUsd: 0.1,
    costPerUsefulUsd: 0.0125,
    toolJsonTasksRun: 4,
    toolJsonReliability: 0.9,
    failureModes: [],
    ...partial,
  };
}

describe("experimental targets — registration", () => {
  it("registers minimax-m3 as an OpenRouter experimental route, never default", () => {
    assert.equal(MINIMAX_M3.alias, "minimax-m3");
    assert.equal(MINIMAX_M3.adapter, "openrouter");
    assert.equal(MINIMAX_M3.model, "minimax/minimax-m3");
    assert.equal(MINIMAX_M3.tier, "EXPERIMENTAL");
    assert.equal(MINIMAX_M3.affects_leaderboard, false);
    assert.equal(MINIMAX_M3.affects_certification, false);
    assert.ok(MINIMAX_M3.default_max_output_tokens > 0 && MINIMAX_M3.default_max_output_tokens <= 4096,
      "default output cap should be moderate, not the 8192 adapter default");
  });

  it("compares against the MiMo v2.5 family", () => {
    assert.deepEqual(MINIMAX_M3.comparison_models, ["xiaomi/mimo-v2.5", "xiaomi/mimo-v2.5-pro"]);
  });

  it("resolves by alias and by raw model slug, and rejects unknowns", () => {
    assert.equal(resolveExperimentalTarget("minimax-m3"), MINIMAX_M3);
    assert.equal(resolveExperimentalTarget("  MiniMax-M3 "), MINIMAX_M3);
    assert.equal(resolveExperimentalTarget("minimax/minimax-m3"), MINIMAX_M3);
    assert.equal(resolveExperimentalTarget("xiaomi/mimo-v2.5"), null, "baselines are not experimental targets");
    assert.equal(resolveExperimentalTarget("gpt-5"), null);
    assert.equal(resolveExperimentalTarget(""), null);
  });

  it("only the registered experimental aliases exist", () => {
    assert.deepEqual(Object.keys(EXPERIMENTAL_TARGETS), ["minimax-m3"]);
  });
});

describe("experimental targets — categories", () => {
  it("covers the seven requested categories", () => {
    const keys = BENCHMARK_CATEGORIES.map((c) => c.key);
    assert.deepEqual(keys.sort(), [
      "coding-patch-reasoning",
      "long-context-repo-comprehension",
      "migration-audit-reasoning",
      "prompt-refinement-luna",
      "refusal-overblocking",
      "structured-json-reliability",
      "tool-call-planning",
    ]);
  });

  it("marks Luna prompt-refinement unsupported (no harness task) rather than silently dropping it", () => {
    const luna = BENCHMARK_CATEGORIES.find((c) => c.key === "prompt-refinement-luna")!;
    assert.equal(luna.supported, false);
    assert.deepEqual(luna.taskIds, []);
    assert.ok(unsupportedCategories().some((c) => c.key === "prompt-refinement-luna"));
  });

  it("every supported category names real-looking task ids", () => {
    for (const c of supportedCategories()) {
      assert.ok(c.taskIds.length > 0, `${c.key} must list tasks`);
      for (const id of c.taskIds) assert.match(id, /^[a-z]+-\d+$/i);
    }
  });

  it("plannedTaskIds dedupes across categories and includes the smoke task", () => {
    const ids = plannedTaskIds();
    assert.equal(new Set(ids).size, ids.length, "no duplicate task ids");
    assert.ok(ids.includes(SMOKE_TASK_ID));
    // tool-001 appears in both tool-call-planning and structured-json-reliability.
    assert.equal(ids.filter((id) => id === "tool-001").length, 1);
  });
});

describe("experimental targets — cost", () => {
  it("prices MiniMax-M3 at its OpenRouter rate (0.30/1.20 per M)", () => {
    const p = pricingFor("minimax/minimax-m3")!;
    assert.equal(p.input_per_m, 0.30);
    assert.equal(p.output_per_m, 1.20);
    // 1M in + 1M out = 0.30 + 1.20 = 1.50
    assert.equal(Number(estimateUsdCost("minimax/minimax-m3", 1_000_000, 1_000_000).toFixed(4)), 1.5);
  });

  it("falls back to the (most expensive) candidate rate for unknown routes — never under-states", () => {
    const unknown = estimateUsdCost("some/unknown-model", 1_000_000, 1_000_000);
    assert.equal(Number(unknown.toFixed(4)), 1.5);
  });

  it("mimo-v2.5 is cheaper than the candidate per the table", () => {
    const m3 = estimateUsdCost("minimax/minimax-m3", 100_000, 100_000);
    const mimo = estimateUsdCost("xiaomi/mimo-v2.5", 100_000, 100_000);
    assert.ok(mimo < m3);
  });
});

describe("experimental targets — batch policy", () => {
  it("single model, single pass, small task count is NOT a batch", () => {
    assert.equal(evaluateBatch({ modelCount: 1, runs: 1, taskCount: 3 }).isBatch, false);
  });
  it("multi-model is a batch", () => {
    assert.equal(evaluateBatch({ modelCount: 3, runs: 1, taskCount: 2 }).isBatch, true);
  });
  it("repeated runs are a batch", () => {
    assert.equal(evaluateBatch({ modelCount: 1, runs: 3, taskCount: 2 }).isBatch, true);
  });
  it("too many tasks in one pass is a batch", () => {
    const d = evaluateBatch({ modelCount: 1, runs: 1, taskCount: 9 });
    assert.equal(d.isBatch, true);
    assert.ok(d.reasons.some((r) => /tasks/.test(r)));
  });
});

describe("experimental targets — verdict", () => {
  it("returns EXPERIMENTAL when there is no data", () => {
    const c = route({ tasksRun: 0, tasksPassed: 0, passRate: 0 });
    assert.equal(classifyRecommendation({ candidate: c, hasData: false }).recommendation, "EXPERIMENTAL");
  });

  it("REJECTs below the reliability floor", () => {
    const c = route({ passRate: 0.3, toolJsonReliability: 0.2 });
    assert.equal(classifyRecommendation({ candidate: c, hasData: true }).recommendation, "REJECT");
  });

  it("does NOT reject on a 0% tool/JSON score when no tool/JSON tasks were measured", () => {
    // Regression: a smoke / category-filtered run leaves toolJsonTasksRun=0;
    // that must read as "not measured", never as a 0% failure.
    const c = route({ passRate: 1.0, toolJsonTasksRun: 0, toolJsonReliability: 0 });
    const rec = classifyRecommendation({ candidate: c, hasData: true }).recommendation;
    assert.notEqual(rec, "REJECT");
    const v = buildVerdict({ candidate: c, hasData: true });
    assert.match(v.toolJsonReliability, /not measured/);
  });

  it("recommends DEFAULT when it matches Pro quality at no worse cost with strong tool/JSON", () => {
    const c = route({ passRate: 0.9, toolJsonReliability: 0.95, costPerUsefulUsd: 0.01 });
    const mimoPro = route({ model: "xiaomi/mimo-v2.5-pro", passRate: 0.88, costPerUsefulUsd: 0.02 });
    assert.equal(classifyRecommendation({ candidate: c, mimoPro, hasData: true }).recommendation, "DEFAULT");
  });

  it("recommends SPECIALIST when strong on tool/JSON but uneven overall", () => {
    const c = route({ passRate: 0.6, toolJsonReliability: 0.9 });
    assert.equal(classifyRecommendation({ candidate: c, hasData: true }).recommendation, "SPECIALIST");
  });

  it("recommends FALLBACK when competitive but not a clear cheaper win", () => {
    const c = route({ passRate: 0.75, toolJsonReliability: 0.6, costPerUsefulUsd: 0.5 });
    const mimoPro = route({ model: "xiaomi/mimo-v2.5-pro", passRate: 0.74, costPerUsefulUsd: 0.05 });
    assert.equal(classifyRecommendation({ candidate: c, mimoPro, hasData: true }).recommendation, "FALLBACK");
  });

  it("buildVerdict answers every required question", () => {
    const c = route({ failureModes: ["FAIL", "provider:RATE_LIMIT"] });
    const mimo = route({ model: "xiaomi/mimo-v2.5", passRate: 0.7 });
    const mimoPro = route({ model: "xiaomi/mimo-v2.5-pro", passRate: 0.85 });
    const v = buildVerdict({ candidate: c, mimo, mimoPro, hasData: true });
    assert.match(v.qualityVsMimo, /MiMo v2\.5/);
    assert.match(v.qualityVsMimoPro, /Pro/);
    assert.match(v.latency, /ms/);
    assert.match(v.toolJsonReliability, /%/);
    assert.ok(v.failureModes.length > 0);
    assert.match(v.costPerUsefulResult, /\$/);
    assert.ok(["DEFAULT", "FALLBACK", "SPECIALIST", "EXPERIMENTAL", "REJECT"].includes(v.recommendation));
  });
});
