/**
 * Regression: MiniMax-M3 leaks its native tool-call markup into `content`.
 *
 * On the 2026-06-30 sweep, MiniMax-M3 ended each visible turn with the
 * structural separator `]<]minimax[>[` followed by a `<tool_call>` block. The
 * text-command parser captured the whole line, so a command like
 * `SHELL pwd && ls -la` was executed as `pwd && ls -la]<]minimax[>[<tool_call>`
 * — coord-002 ran 37 shells with 36 non-zero exits and wrote 0 files before
 * hitting the step budget. stripMiniMaxStructuralTokens cuts the response at
 * the first structural marker so the parser sees a clean command.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripMiniMaxStructuralTokens } from "../adapters/minimax.js";

describe("stripMiniMaxStructuralTokens", () => {
  it("strips the `]<]minimax[>[<tool_call>` trailer observed in the M3 sweep", () => {
    assert.equal(
      stripMiniMaxStructuralTokens("pwd && ls -la]<]minimax[>[<tool_call>"),
      "pwd && ls -la",
    );
    assert.equal(
      stripMiniMaxStructuralTokens('find . -not -path "*/node_modules/*"]<]minimax[>[<tool_call>'),
      'find . -not -path "*/node_modules/*"',
    );
  });

  it("preserves a full agentic turn while dropping the native tool block", () => {
    const raw = [
      "I'll inspect the repo first.",
      "READ_FILE src/index.js",
      "SHELL npm test",
      "]<]minimax[>[<tool_call>",
      '{"name":"shell","arguments":{"command":"npm test"}}',
      "</tool_call>",
    ].join("\n");
    const cleaned = stripMiniMaxStructuralTokens(raw);
    assert.match(cleaned, /READ_FILE src\/index\.js/);
    assert.match(cleaned, /SHELL npm test/);
    assert.doesNotMatch(cleaned, /minimax/);
    assert.doesNotMatch(cleaned, /tool_call/);
  });

  it("also cuts at a bare <tool_call> with no separator", () => {
    assert.equal(stripMiniMaxStructuralTokens("DONE<tool_call>{}"), "DONE");
  });

  it("is a no-op for clean text and empty input", () => {
    assert.equal(stripMiniMaxStructuralTokens("WRITE_FILE a.js"), "WRITE_FILE a.js");
    assert.equal(stripMiniMaxStructuralTokens(""), "");
  });
});
