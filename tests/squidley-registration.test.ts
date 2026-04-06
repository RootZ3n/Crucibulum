import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const allowlist = readFileSync("/mnt/ai/squidley/apps/api/src/tools/allowlist.ts", "utf-8");
const runner = readFileSync("/mnt/ai/squidley/apps/api/src/tools/runner.ts", "utf-8");

describe("squidley crucibulum tool registration", () => {
  it("registers crucibulum tools in the allowlist", () => {
    for (const toolId of [
      "crucibulum.adapters",
      "crucibulum.tasks",
      "crucibulum.run",
      "crucibulum.status",
      "crucibulum.summary",
      "crucibulum.bundle",
      "crucibulum.compare",
      "crucibulum.receipts",
      "crucibulum.crucible-link",
    ]) {
      assert.match(allowlist, new RegExp(`"${toolId}"`));
    }
  });

  it("implements crucibulum tool dispatch in the runner", () => {
    assert.match(runner, /opts\.tool_id\.startsWith\("crucibulum\."\)/);
    assert.match(runner, /\/api\/adapters/);
    assert.match(runner, /\/api\/run/);
    assert.match(runner, /\/api\/compare/);
  });
});
