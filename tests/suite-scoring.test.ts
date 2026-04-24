/**
 * Crucible — Suite-Level Scoring Weights Tests
 *
 * Suite-level weight resolution and precedence. Originally written against
 * vitest; ported to node:test so the project's `node --test` runner picks
 * them up. Logic is unchanged.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
    assert.deepEqual(result, DEFAULT_WEIGHTS);
  });

  it("returns defaults when suite not found", () => {
    const result = resolveScoringWeights(undefined, "nonexistent-suite");
    assert.deepEqual(result, DEFAULT_WEIGHTS);
  });

  it("task-level weights override suite-level weights", () => {
    const taskWeights: SuiteScoringWeights = {
      correctness: 0.80,
      regression: 0.10,
      integrity: 0.05,
      efficiency: 0.05,
    };
    const result = resolveScoringWeights(taskWeights, "v1");
    assert.deepEqual(result, taskWeights);
  });

  it("task-level partial override works correctly", () => {
    const taskWeights: SuiteScoringWeights = {
      correctness: 0.90,
      regression: 0.05,
      integrity: 0.03,
      efficiency: 0.02,
    };
    const result = resolveScoringWeights(taskWeights, "v1");
    assert.equal(result.correctness, 0.90);
    assert.equal(result.regression, 0.05);
    assert.equal(result.integrity, 0.03);
    assert.equal(result.efficiency, 0.02);
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
    assert.equal(sum, 1.0);
  });
});

describe("resolvePassThreshold", () => {
  it("returns task-level threshold when provided", () => {
    const result = resolvePassThreshold(0.75, "v1");
    assert.equal(result, 0.75);
  });

  it("returns default when no task or suite threshold", () => {
    const result = resolvePassThreshold(undefined, undefined);
    assert.equal(result, DEFAULT_PASS_THRESHOLD);
  });

  it("returns default when suite not found", () => {
    const result = resolvePassThreshold(undefined, "nonexistent");
    assert.equal(result, DEFAULT_PASS_THRESHOLD);
  });

  it("task-level threshold overrides suite-level", () => {
    const result = resolvePassThreshold(0.85, "v1");
    assert.equal(result, 0.85);
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
    assert.equal(result.correctness, 1.0);
    assert.equal(result.regression, 0.0);
  });

  it("suite weights win over defaults when no task weights", () => {
    const result = resolveScoringWeights(undefined, "v1");
    assert.equal(result.correctness, 0.40);
    assert.equal(result.regression, 0.25);
    assert.equal(result.integrity, 0.20);
    assert.equal(result.efficiency, 0.15);
  });

  it("defaults win when no suite and no task weights", () => {
    const result = resolveScoringWeights(undefined, undefined);
    assert.deepEqual(result, DEFAULT_WEIGHTS);
  });
});
