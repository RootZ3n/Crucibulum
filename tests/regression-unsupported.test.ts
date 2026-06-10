/**
 * Luak — H6 regression: command-less regression checks do not grant free credit.
 *
 * A regression check with no runnable command used to count as a pass, letting
 * an under-specified oracle inflate the regression score. It must be marked
 * "unsupported" and excluded from the score.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge } from "../core/judge.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function ws(): string {
  const d = mkdtempSync(join(tmpdir(), "h6-ws-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

const MANIFEST = {
  id: "h6-task",
  family: "code",
  difficulty: "easy",
  description: "h6",
  constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
  scoring: { weights: { correctness: 1, regression: 1, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
  verification: {},
  task: { title: "t", description: "d" },
  metadata: { author: "test", created: "2026-06-10", tags: [], diagnostic_purpose: "test", benchmark_provenance: "h6" },
} as never;

const EXEC = {
  exit_code: 0, steps_used: 1, tokens_in: 1, tokens_out: 1, duration_ms: 100,
  timeline: [{ t: 0, type: "task_start", detail: "s" }],
  adapter_metadata: { provider: "local", system_version: "test" },
} as never;

const DIFF = { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] } as never;

function oracle(regression: Array<{ id: string; command?: string }>): never {
  return {
    checks: { correctness: [], regression, integrity: [], decoys: [], anti_cheat: { forbidden_code_patterns: [] } },
    ground_truth: { bug_location: "", correct_fix_pattern: "" },
  } as never;
}

describe("regression command-less checks (H6)", () => {
  it("marks a command-less regression check as unsupported, not pass", () => {
    const result = judge(MANIFEST, oracle([{ id: "reg-no-cmd" }]), DIFF, EXEC, ws());
    assert.equal(result.verification.regression.details["reg-no-cmd"], "unsupported");
  });

  it("a command-less check does NOT dilute a real failing check into a partial pass", () => {
    const result = judge(
      MANIFEST,
      oracle([{ id: "reg-fail", command: "exit 1" }, { id: "reg-no-cmd" }]),
      DIFF, EXEC, ws(),
    );
    // Only the runnable check counts; it failed → regression score is 0, not 0.5.
    assert.equal(result.verification.regression.score, 0);
    assert.equal(result.verification.regression.details["reg-fail"], "fail");
    assert.equal(result.verification.regression.details["reg-no-cmd"], "unsupported");
  });

  it("a passing runnable check still scores 1 alongside an unsupported one", () => {
    const result = judge(
      MANIFEST,
      oracle([{ id: "reg-pass", command: "exit 0" }, { id: "reg-no-cmd" }]),
      DIFF, EXEC, ws(),
    );
    assert.equal(result.verification.regression.score, 1);
  });
});
