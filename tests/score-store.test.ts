import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelScore } from "../types/scores.js";

function score(overrides: Partial<ModelScore> = {}): ModelScore {
  return {
    modelId: "score-store-model",
    taskId: "score-store-task",
    family: "B",
    category: "spec",
    passed: true,
    score: 88,
    rawScore: 0.88,
    duration_ms: 1234,
    tokensUsed: 42,
    costEstimate: 0.001,
    anomalyFlags: ["fixture"],
    timestamp: "2026-06-11T00:00:00.000Z",
    metadata: { source: "test" },
    completionState: "PASS",
    failureReasonCode: "pass",
    failureReasonSummary: "Run completed and passed evaluation",
    countsTowardModelScore: true,
    countsTowardFailureRate: false,
    ...overrides,
  };
}

describe("score-store persistence", () => {
  it("stores queryable score rows in an isolated sqlite state dir", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "luak-score-store-"));
    process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
    const mod = await import(`../core/score-store.js?score-store=${Date.now()}-persist`) as typeof import("../core/score-store.js");

    const stored = mod.storeScores([score()], "crucibulum", "run-score-store");
    assert.deepEqual(stored, { stored: 1, errors: [] });

    const rows = mod.queryScores({ modelId: "score-store-model", limit: 5 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.taskId, "score-store-task");
    assert.equal(rows[0]?.completionState, "PASS");
    assert.deepEqual(rows[0]?.anomalyFlags, ["fixture"]);
    assert.deepEqual(rows[0]?.metadata, { source: "test" });
    delete process.env["CRUCIBULUM_STATE_DIR"];
  });

  it("accumulates insert errors without dropping valid rows from the same batch", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "luak-score-store-"));
    process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
    const mod = await import(`../core/score-store.js?score-store=${Date.now()}-errors`) as typeof import("../core/score-store.js");

    const bad = score({ taskId: undefined as unknown as string });
    const result = mod.storeScores([score({ taskId: "valid-task" }), bad], "crucibulum", "run-score-store-errors");
    assert.equal(result.stored, 1);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0] ?? "", /score-store-task|undefined|Task/i);

    const rows = mod.queryScores({ modelId: "score-store-model", limit: 5 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.taskId, "valid-task");
    delete process.env["CRUCIBULUM_STATE_DIR"];
  });
});
