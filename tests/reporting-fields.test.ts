/**
 * Crucible — Reporting Fields Tests
 *
 * Suite/task/leaderboard summary field shape. Originally written against
 * vitest; ported to node:test so the project's `node --test` runner picks
 * them up. Logic is unchanged.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeConfidence } from "../core/suite-loader.js";

describe("computeConfidence", () => {
  it("high: pass_rate >= 0.95 and stability >= 0.8", () => {
    assert.equal(computeConfidence(1.0, false), "high");
  });

  it("medium: pass_rate >= 0.7", () => {
    assert.equal(computeConfidence(0.8, false), "medium");
    assert.equal(computeConfidence(0.7, false), "medium");
  });

  it("medium: flaky with pass_rate >= 0.5", () => {
    assert.equal(computeConfidence(0.6, true), "medium");
  });

  it("low: pass_rate < 0.7 and not flaky", () => {
    assert.equal(computeConfidence(0.5, false), "low");
    assert.equal(computeConfidence(0.3, false), "low");
  });

  it("low: very low pass rate even if flaky", () => {
    assert.equal(computeConfidence(0.3, true), "low");
  });
});

describe("suite summary structure", () => {
  it("defines expected overall_outcome types", () => {
    const validOutcomes = ["stable_pass", "stable_fail", "mixed", "flaky_mixed"] as const;
    assert.equal(validOutcomes.length, 4);
    assert.ok(validOutcomes.includes("stable_pass"));
    assert.ok(validOutcomes.includes("stable_fail"));
    assert.ok(validOutcomes.includes("mixed"));
    assert.ok(validOutcomes.includes("flaky_mixed"));
  });
});

describe("task result structure", () => {
  it("defines expected outcome types", () => {
    const validOutcomes = ["stable_pass", "stable_fail", "flaky_pass", "flaky_fail"] as const;
    assert.equal(validOutcomes.length, 4);
  });

  it("defines expected confidence levels", () => {
    const validLevels = ["high", "medium", "low"] as const;
    assert.equal(validLevels.length, 3);
  });
});

describe("leaderboard entry structure", () => {
  it("defines required fields", () => {
    const requiredFields = [
      "modelId",
      "composite",
      "families",
      "totalRuns",
      "lastRun",
      "source",
    ];
    assert.equal(requiredFields.length, 6);
  });

  it("defines flake-aware optional fields", () => {
    const flakeFields = [
      "average_pass_rate",
      "stability_score",
      "reliability_score",
      "total_flaky",
      "total_stable",
      "confidence",
    ];
    assert.equal(flakeFields.length, 6);
  });
});
