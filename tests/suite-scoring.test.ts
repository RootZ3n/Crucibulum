/**
 * Crucibulum — Suite-Level Scoring Weights Tests
 * Tests for suite-level weight resolution and precedence.
 */

import { describe, it, expect } from "vitest";
import {
  resolveScoringWeights,
  resolvePassThreshold,
  DEFAULT_WEIGHTS,
  DEFAULT_PASS_THRESHOLD,
} from "../core/suite-loader.js";
import type { SuiteScoringWeights } from "../types/scores.js";

describe("resolveScoringWeights", () => {
  it("returns defaults when no task or suite weights provided", () => {
    const result = resolveScoringWeights(undefined, undefined);
    expect(result).toEqual(DEFAULT_WEIGHTS);
  });

  it("returns defaults when suite not found", () => {
    const result = resolveScoringWeights(undefined, "nonexistent-suite");
    expect(result).toEqual(DEFAULT_WEIGHTS);
  });

  it("task-level weights override suite-level weights", () => {
    const taskWeights: SuiteScoringWeights = {
      correctness: 0.80,
      regression: 0.10,
      integrity: 0.05,
      efficiency: 0.05,
    };
    const result = resolveScoringWeights(taskWeights, "v1");
    // Task weights should fully replace suite weights
    expect(result).toEqual(taskWeights);
  });

  it("task-level partial override works correctly", () => {
    // If task only specifies some weights, the rest come from suite
    // But since we use spread, task weights must be complete
    const taskWeights: SuiteScoringWeights = {
      correctness: 0.90,
      regression: 0.05,
      integrity: 0.03,
      efficiency: 0.02,
    };
    const result = resolveScoringWeights(taskWeights, "v1");
    expect(result.correctness).toBe(0.90);
    expect(result.regression).toBe(0.05);
    expect(result.integrity).toBe(0.03);
    expect(result.efficiency).toBe(0.02);
  });

  it("weights sum check (task-level)", () => {
    const taskWeights: SuiteScoringWeights = {
      correctness: 0.50,
      regression: 0.25,
      integrity: 0.15,
      efficiency: 0.10,
    };
    const result = resolveScoringWeights(taskWeights, undefined);
    const sum = result.correctness + result.regression + result.integrity + result.efficiency;
    expect(sum).toBe(1.0);
  });
});

describe("resolvePassThreshold", () => {
  it("returns task-level threshold when provided", () => {
    const result = resolvePassThreshold(0.75, "v1");
    expect(result).toBe(0.75);
  });

  it("returns default when no task or suite threshold", () => {
    const result = resolvePassThreshold(undefined, undefined);
    expect(result).toBe(DEFAULT_PASS_THRESHOLD);
  });

  it("returns default when suite not found", () => {
    const result = resolvePassThreshold(undefined, "nonexistent");
    expect(result).toBe(DEFAULT_PASS_THRESHOLD);
  });

  it("task-level threshold overrides suite-level", () => {
    // v1 suite has pass_threshold of 0.60
    const result = resolvePassThreshold(0.85, "v1");
    expect(result).toBe(0.85);
  });
});

describe("suite-level precedence", () => {
  it("task weights win over suite weights", () => {
    const taskWeights: SuiteScoringWeights = {
      correctness: 1.0,
      regression: 0.0,
      integrity: 0.0,
      efficiency: 0.0,
    };
    const result = resolveScoringWeights(taskWeights, "v1");
    // Task weights should completely override suite weights
    expect(result.correctness).toBe(1.0);
    expect(result.regression).toBe(0.0);
  });

  it("suite weights win over defaults when no task weights", () => {
    // v1 suite has weights: { correctness: 0.40, regression: 0.25, integrity: 0.20, efficiency: 0.15 }
    const result = resolveScoringWeights(undefined, "v1");
    expect(result.correctness).toBe(0.40);
    expect(result.regression).toBe(0.25);
    expect(result.integrity).toBe(0.20);
    expect(result.efficiency).toBe(0.15);
  });

  it("defaults win when no suite and no task weights", () => {
    const result = resolveScoringWeights(undefined, undefined);
    expect(result).toEqual(DEFAULT_WEIGHTS);
  });
});
