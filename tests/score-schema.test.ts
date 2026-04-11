import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SCORE_FAMILIES,
  SCORE_FAMILY_SPECS,
  FAMILY_WEIGHTS,
  taskFamiliesForScoreFamilies,
  canonicalPercent,
  fractionToPercent,
  percentToFraction,
} from "../types/scores.js";

describe("score schema", () => {
  it("defines a canonical spec for every public score family", () => {
    assert.deepEqual(SCORE_FAMILIES, ["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    for (const family of SCORE_FAMILIES) {
      assert.equal(SCORE_FAMILY_SPECS[family].id, family);
      assert.equal(typeof SCORE_FAMILY_SPECS[family].label, "string");
      assert.equal(typeof FAMILY_WEIGHTS[family], "number");
    }
  });

  it("maps score families to canonical task families from a shared source of truth", () => {
    assert.deepEqual(taskFamiliesForScoreFamilies(["A", "E", "F"]), [
      "poison_localization",
      "truthfulness",
      "cost_efficiency",
    ]);
    assert.deepEqual(taskFamiliesForScoreFamilies(["H", "I"]), ["safety", "memory"]);
  });

  it("normalizes legacy fractions and canonical percentages into 0-100 public scores", () => {
    assert.equal(fractionToPercent(0.955), 95.5);
    assert.equal(percentToFraction(95.5), 0.955);
    assert.equal(canonicalPercent(0.955), 95.5);
    assert.equal(canonicalPercent(95.5), 95.5);
  });
});
