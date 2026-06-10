/**
 * Luak — C7 regression: custom scorer output is validated before it is trusted.
 *
 * Scorers are arbitrary plugin code from /scorers/. Without output bounds a
 * plugin returning {passed:true, score:999} would force full credit. runScorer
 * must fail closed (0/fail) on non-boolean passed, non-finite score, or score
 * outside [0,1].
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScorer, type ScorerPlugin, type ScorerInput, type ScorerOutput } from "../core/scorer-registry.js";

function mockScorer(score: (input: ScorerInput) => unknown): ScorerPlugin {
  return {
    id: "mock-scorer",
    name: "Mock",
    version: "1.0.0",
    taskFamilies: ["*"],
    score: score as (input: ScorerInput) => ScorerOutput,
  };
}

const INPUT: ScorerInput = {
  taskId: "t1",
  taskFamily: "conversational",
  modelResponse: "hello",
  oracleData: {},
  metadata: {},
};

describe("scorer output validation (C7)", () => {
  it("rejects an out-of-range score and fails closed", () => {
    const { output, rejected } = runScorer(mockScorer(() => ({ passed: true, score: 999, breakdown: {}, explanation: "pwn" })), INPUT);
    assert.equal(output.passed, false);
    assert.equal(output.score, 0);
    assert.ok(rejected && /out-of-range/.test(rejected));
  });

  it("rejects a negative score", () => {
    const { output, rejected } = runScorer(mockScorer(() => ({ passed: true, score: -5, breakdown: {}, explanation: "x" })), INPUT);
    assert.equal(output.passed, false);
    assert.ok(rejected);
  });

  it("rejects a non-boolean passed", () => {
    const { output, rejected } = runScorer(mockScorer(() => ({ passed: "yes", score: 1, breakdown: {}, explanation: "x" })), INPUT);
    assert.equal(output.passed, false);
    assert.ok(rejected && /non-boolean/.test(rejected));
  });

  it("rejects a non-finite score (NaN / Infinity)", () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      const { output, rejected } = runScorer(mockScorer(() => ({ passed: true, score: bad, breakdown: {}, explanation: "x" })), INPUT);
      assert.equal(output.passed, false, `score ${bad} should fail closed`);
      assert.ok(rejected);
    }
  });

  it("fails closed when the scorer throws", () => {
    const { output, rejected } = runScorer(mockScorer(() => { throw new Error("boom"); }), INPUT);
    assert.equal(output.passed, false);
    assert.ok(rejected && /threw/.test(rejected));
  });

  it("fails closed on a non-object result", () => {
    const { output, rejected } = runScorer(mockScorer(() => true), INPUT);
    assert.equal(output.passed, false);
    assert.ok(rejected);
  });

  it("accepts a valid in-range result unchanged", () => {
    const { output, rejected } = runScorer(mockScorer(() => ({ passed: true, score: 0.75, breakdown: { x: 1 }, explanation: "ok" })), INPUT);
    assert.equal(rejected, null);
    assert.equal(output.passed, true);
    assert.equal(output.score, 0.75);
    assert.equal(output.explanation, "ok");
  });

  it("accepts a valid failing result", () => {
    const { output, rejected } = runScorer(mockScorer(() => ({ passed: false, score: 0, breakdown: {}, explanation: "nope" })), INPUT);
    assert.equal(rejected, null);
    assert.equal(output.passed, false);
    assert.equal(output.score, 0);
  });
});
