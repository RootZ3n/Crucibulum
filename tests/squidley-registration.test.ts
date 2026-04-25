import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("squidley crucibulum tool registration", () => {
  it("documents the local Crucible tool contract without reading the Squidley repo", () => {
    const toolIds = [
      "crucibulum.adapters",
      "crucibulum.tasks",
      "crucibulum.run",
      "crucibulum.status",
      "crucibulum.summary",
      "crucibulum.bundle",
      "crucibulum.compare",
      "crucibulum.receipts",
      "crucibulum.crucible-link",
    ];
    assert.equal(toolIds.length, new Set(toolIds).size);
    assert.ok(toolIds.every((toolId) => toolId.startsWith("crucibulum.")));
    assert.deepEqual(toolIds.slice(0, 3), ["crucibulum.adapters", "crucibulum.tasks", "crucibulum.run"]);
  });
});
