import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { listRegisteredAdapters, resolveAdapter } from "../adapters/registry.js";

describe("compare command adapter resolution via registry", () => {
  it("resolves all registered adapter IDs without throwing", () => {
    const adapters = listRegisteredAdapters();
    assert.ok(adapters.length > 0, "Registry should have at least one adapter");
    for (const entry of adapters) {
      const resolved = resolveAdapter(entry.id);
      assert.equal(resolved.id, entry.id, `resolveAdapter('${entry.id}') should return matching entry`);
      assert.equal(typeof resolved.create, "function", `Adapter '${entry.id}' should have a create() method`);
    }
  });

  it("throws for unknown adapter IDs", () => {
    assert.throws(() => resolveAdapter("nonexistent-adapter"), /Unknown adapter/);
  });

  it("includes expected core adapters", () => {
    const ids = listRegisteredAdapters().map((e) => e.id);
    for (const expected of ["ollama", "openrouter", "openclaw", "claudecode", "anthropic", "openai"]) {
      assert.ok(ids.includes(expected), `Registry should include '${expected}'`);
    }
  });
});
