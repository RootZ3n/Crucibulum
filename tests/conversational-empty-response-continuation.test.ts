/**
 * Regression: a single EMPTY_RESPONSE mid-sequence must NOT abort the rest of
 * a conversational task.
 *
 * MiniMax (and other thinking models) intermittently return a blank completion
 * for one question — the adapter surfaces that as a thrown EMPTY_RESPONSE
 * provider error. The runner used to treat any thrown chat error as terminal:
 * it set terminalChatError and broke the question loop, so every later question
 * was filled in as "UNATTEMPTED: runner stopped before this question". One
 * transient blank on question 2 turned a 9/10 run into a 3/10 "provider
 * failure" (observed across 14 tasks in the 2026-06-30 MiniMax-M3 sweep).
 *
 * After the fix, an EMPTY_RESPONSE fails only that one question (recorded with a
 * PROVIDER_EMPTY_RESPONSE reason) and the run continues. Genuinely terminal
 * errors (auth/network/rate-limit) still stop the run — covered separately.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  CrucibulumAdapter,
  ChatMessage,
  ChatResult,
  ExecutionResult,
} from "../adapters/base.js";
import { makeEmptyResponseError } from "../core/provider-errors.js";
import { runConversationalTask } from "../core/conversational-runner.js";

const UNATTEMPTED = "UNATTEMPTED: runner stopped before this question";

/** Answers every question except the Nth chat() call, which throws an
 *  EMPTY_RESPONSE provider error exactly the way MiniMax's callMiniMax does. */
class EmptyOnNthCallAdapter implements CrucibulumAdapter {
  id = "minimax";
  name = "Empty-on-Nth Mock";
  version = "1.0.0";
  private calls = 0;
  constructor(private readonly emptyOnCall: number) {}
  supports(): boolean { return true; }
  supportsToolCalls(): boolean { return false; }
  supportsChat(): boolean { return true; }
  async init(): Promise<void> { /* no-op */ }
  async healthCheck(): Promise<{ ok: boolean }> { return { ok: true }; }
  async teardown(): Promise<void> { /* no-op */ }
  async execute(): Promise<ExecutionResult> { throw new Error("execute() not used in conversational mode"); }
  async chat(_messages: ChatMessage[]): Promise<ChatResult> {
    this.calls += 1;
    if (this.calls === this.emptyOnCall) {
      throw makeEmptyResponseError(
        { provider: "minimax", adapter: "minimax" },
        "MiniMax returned empty content. Raw body: {}",
      );
    }
    return { text: "bug", tokens_in: 6, tokens_out: 2, duration_ms: 1 };
  }
}

describe("conversational runner — empty response does not abort the sequence", () => {
  it("scores the blank question as a provider failure and still attempts the rest", async () => {
    const adapter = new EmptyOnNthCallAdapter(2); // blank on question 2 of 10
    await adapter.init();
    const tmp = mkdtempSync(join(tmpdir(), "luak-empty-continue-"));
    const prevRunsDir = process.env["CRUCIBULUM_RUNS_DIR"];
    process.env["CRUCIBULUM_RUNS_DIR"] = tmp;
    try {
      const result = await runConversationalTask({
        taskId: "classification-001",
        adapter,
        model: "MiniMax-M3",
      });
      const results = result.bundle.conversational?.results ?? [];

      // All ten questions are present and NONE were skipped as UNATTEMPTED —
      // the single blank no longer cascades into the rest of the task.
      assert.equal(results.length, 10, "every manifest question must be recorded");
      const unattempted = results.filter((r) => r.failure_reason === UNATTEMPTED);
      assert.equal(unattempted.length, 0, `no question should be UNATTEMPTED, got ${unattempted.length}`);

      // The blank question (index 1 / 2nd call) is recorded as a provider-empty
      // failure, not a model wrong-answer.
      const blank = results[1]!;
      assert.equal(blank.passed, false);
      assert.match(blank.failure_reason ?? "", /PROVIDER_EMPTY_RESPONSE/);
      assert.equal(blank.response, "");

      // Every OTHER question actually reached the scorer (got the "bug" answer),
      // proving the loop kept going past the blank.
      const attemptedAfterBlank = results.slice(2).filter((r) => r.response === "bug");
      assert.equal(attemptedAfterBlank.length, 8, "questions after the blank must still be asked");

      // The run is NOT marked as a terminal provider-empty failure — that whole-
      // run verdict was the bug we fixed.
      assert.notEqual(result.bundle.verdict?.failureReasonCode, "provider_empty_response");
    } finally {
      if (prevRunsDir === undefined) delete process.env["CRUCIBULUM_RUNS_DIR"];
      else process.env["CRUCIBULUM_RUNS_DIR"] = prevRunsDir;
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
