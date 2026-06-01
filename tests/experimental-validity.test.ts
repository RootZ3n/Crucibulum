import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyRecommendation,
  buildVerdict,
  assessRunValidity,
  type RouteMetrics,
} from "../core/experimental-targets.js";

/**
 * A route shaped like the 2026-06-01 incident: every task failed at the
 * provider, so 0 tokens, $0 spend, no completed calls. Pass/tool numbers are
 * meaningless artefacts here and must NOT drive a model verdict.
 */
function providerErrorOnly(partial: Partial<RouteMetrics> = {}): RouteMetrics {
  return {
    model: "minimax/minimax-m3",
    tasksRun: 11,
    tasksPassed: 1,
    passRate: 0.091,
    avgLatencyMs: 32,
    totalCostUsd: 0,
    costPerUsefulUsd: 0,
    toolJsonTasksRun: 3,
    toolJsonReliability: 0.333,
    failureModes: ["provider:AUTH"],
    completedCalls: 0,
    providerFailures: 11,
    tokensObserved: 0,
    spendObserved: 0,
    ...partial,
  };
}

function healthy(partial: Partial<RouteMetrics> = {}): RouteMetrics {
  return {
    model: "minimax/minimax-m3",
    tasksRun: 10,
    tasksPassed: 2,
    passRate: 0.2,
    avgLatencyMs: 900,
    totalCostUsd: 0.05,
    costPerUsefulUsd: 0.025,
    toolJsonTasksRun: 4,
    toolJsonReliability: 0.25,
    failureModes: ["low_score"],
    completedCalls: 10,
    providerFailures: 0,
    tokensObserved: 40_000,
    spendObserved: 0.05,
    ...partial,
  };
}

describe("experimental run validity", () => {
  it("assessRunValidity flags a provider-error-only run as PROVIDER_FAILURE", () => {
    const v = assessRunValidity(providerErrorOnly());
    assert.equal(v.valid, false);
    assert.equal(v.recommendation, "PROVIDER_FAILURE");
  });

  it("classifies a provider_error-only run as PROVIDER_FAILURE, NOT REJECT", () => {
    const rec = classifyRecommendation({ candidate: providerErrorOnly(), hasData: true }).recommendation;
    assert.equal(rec, "PROVIDER_FAILURE");
    assert.notEqual(rec, "REJECT");
  });

  it("0 tokens + 0 spend + provider_error cannot produce a model-quality comparison", () => {
    const candidate = providerErrorOnly();
    const mimo = providerErrorOnly({ model: "xiaomi/mimo-v2.5" });
    const mimoPro = providerErrorOnly({ model: "xiaomi/mimo-v2.5-pro" });
    const verdict = buildVerdict({ candidate, mimo, mimoPro, hasData: true });

    assert.ok(verdict.recommendation === "PROVIDER_FAILURE" || verdict.recommendation === "INVALID_RUN");
    assert.notEqual(verdict.recommendation, "REJECT");
    // The candidate must NOT be compared against the MiMo family.
    assert.ok(/not compared/i.test(verdict.qualityVsMimo), verdict.qualityVsMimo);
    assert.ok(/not compared/i.test(verdict.qualityVsMimoPro), verdict.qualityVsMimoPro);
    assert.ok(!/Δ|vs \d/.test(verdict.qualityVsMimo), verdict.qualityVsMimo);
    assert.equal(verdict.costPerUsefulResult, "n/a (run invalid)");
  });

  it("zero usage without recorded provider failures is INVALID_RUN, not REJECT", () => {
    const candidate = healthy({ completedCalls: 0, providerFailures: 0, tokensObserved: 0, spendObserved: 0 });
    const rec = classifyRecommendation({ candidate, hasData: true }).recommendation;
    assert.equal(rec, "INVALID_RUN");
    assert.notEqual(rec, "REJECT");
  });

  it("a genuinely measured weak run STILL REJECTs (validity gate is narrow)", () => {
    // Completed calls, real tokens + spend, but below the reliability floor.
    const rec = classifyRecommendation({ candidate: healthy(), hasData: true }).recommendation;
    assert.equal(rec, "REJECT");
  });

  it("does not stamp PROVIDER_FAILURE on a partially-degraded but completed run", () => {
    const candidate = healthy({ providerFailures: 2, completedCalls: 8 });
    const rec = classifyRecommendation({ candidate, hasData: true }).recommendation;
    assert.notEqual(rec, "PROVIDER_FAILURE");
    assert.notEqual(rec, "INVALID_RUN");
  });
});
