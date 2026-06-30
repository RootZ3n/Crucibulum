import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { ModelScore, ScoreFamily } from "../types/scores.js";

function score(modelId: string, passed: boolean, value: number, index: number): ModelScore {
  return {
    modelId,
    taskId: `task-${index}`,
    family: "A" as ScoreFamily,
    category: "unit",
    passed,
    score: value,
    rawScore: value,
    duration_ms: 1000,
    timestamp: `2026-06-30T00:00:0${index}.000Z`,
    completionState: passed ? "PASS" : "FAIL",
    failureOrigin: passed ? null : "MODEL",
    failureReasonCode: passed ? "pass" : "wrong_output",
    countsTowardModelScore: true,
    countsTowardFailureRate: !passed,
  };
}

function runRealLeaderboard(scores: ModelScore[]): Array<Record<string, unknown>> {
  const stateDir = mkdtempSync(join(tmpdir(), "luak-score-store-test-"));
  const scoreStoreUrl = new URL("../core/score-store.js", import.meta.url).href;
  const outputPath = join(stateDir, "leaderboard.json");
  const script = `
    import { writeFileSync } from "node:fs";
    const { storeScores, getLeaderboard } = await import(${JSON.stringify(scoreStoreUrl)});
    const scores = ${JSON.stringify(scores)};
    const stored = storeScores(scores, "crucibulum", "ranking-test");
    if (stored.errors.length) {
      console.error(JSON.stringify(stored.errors));
      process.exit(2);
    }
    writeFileSync(${JSON.stringify(outputPath)}, JSON.stringify(getLeaderboard(["A"])));
  `;

  try {
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      env: { ...process.env, LUAK_STATE_ROOT: stateDir },
    });
    assert.equal(child.status, 0, child.stderr || child.stdout);
    return JSON.parse(readFileSync(outputPath, "utf-8")) as Array<Record<string, unknown>>;
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
}

describe("real leaderboard ranking from score-store", () => {
  it("ranks by production reliability score before raw composite", () => {
    const leaderboard = runRealLeaderboard([
      score("flaky-high", true, 90, 1),
      score("flaky-high", true, 90, 2),
      score("flaky-high", false, 90, 3),
      score("stable-high", true, 88, 1),
      score("stable-high", true, 88, 2),
      score("stable-high", true, 88, 3),
    ]);

    assert.deepEqual(leaderboard.map((entry) => entry.modelId), ["stable-high", "flaky-high"]);
    assert.equal(leaderboard[0]!.composite, 88);
    assert.equal(leaderboard[0]!.average_pass_rate, 1);
    assert.equal(leaderboard[0]!.stability_score, 1);
    assert.equal(leaderboard[0]!.reliability_score, 88);
    assert.equal(leaderboard[0]!.confidence, "high");
    assert.equal(leaderboard[1]!.composite, 90);
    assert.equal(leaderboard[1]!.average_pass_rate, 0.67);
    assert.equal(leaderboard[1]!.stability_score, 0.34);
    assert.equal(leaderboard[1]!.reliability_score, 60.3);
    assert.equal(leaderboard[1]!.confidence, "low");
  });

  it("applies the production small-sample penalty", () => {
    const leaderboard = runRealLeaderboard([
      score("one-shot-perfect", true, 100, 1),
      score("sampled-good", true, 80, 1),
      score("sampled-good", true, 80, 2),
      score("sampled-good", true, 80, 3),
    ]);

    assert.deepEqual(leaderboard.map((entry) => entry.modelId), ["sampled-good", "one-shot-perfect"]);
    assert.equal(leaderboard[0]!.sample_adequate, true);
    assert.equal(leaderboard[0]!.sample_penalty, 1);
    assert.equal(leaderboard[0]!.reliability_score, 80);
    assert.equal(leaderboard[1]!.sample_adequate, false);
    assert.equal(leaderboard[1]!.sample_penalty, 0.33);
    assert.equal(leaderboard[1]!.reliability_score, 33.33);
    assert.equal(leaderboard[1]!.confidence, "low");
  });

  it("uses production tie-breakers for deterministic ordering", () => {
    const leaderboard = runRealLeaderboard([
      score("bravo", true, 75, 1),
      score("bravo", true, 75, 2),
      score("bravo", true, 75, 3),
      score("alpha", true, 75, 1),
      score("alpha", true, 75, 2),
      score("alpha", true, 75, 3),
    ]);

    assert.deepEqual(leaderboard.map((entry) => entry.modelId), ["alpha", "bravo"]);
    assert.equal(leaderboard[0]!.reliability_score, leaderboard[1]!.reliability_score);
  });
});
