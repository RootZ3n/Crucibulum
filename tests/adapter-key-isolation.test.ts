/**
 * Luak — H3 regression: per-adapter credential isolation.
 *
 * Inline provider keys configured in the Providers tab must reach the adapter
 * via the per-run AdapterConfig.api_key, NOT by mutating global process.env
 * (a shared mutable global that bled keys across concurrent runs / presets).
 */
import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const STATE_DIR = mkdtempSync(join(tmpdir(), "h3-registry-"));
process.env["CRUCIBULUM_STATE_DIR"] = STATE_DIR;
delete process.env["OPENROUTER_API_KEY"];

const registry = await import("../core/provider-registry.js");
const adapters = await import("../adapters/registry.js");

before(() => { registry.__resetRegistryForTests(); });
beforeEach(() => {
  registry.__resetRegistryForTests();
  delete process.env["OPENROUTER_API_KEY"];
});
afterEach(() => { delete process.env["OPENROUTER_API_KEY"]; });

describe("adapter credential isolation (H3)", () => {
  it("inline key reaches config.api_key and does NOT land in process.env", async () => {
    const inlineKey = "sk-or-v1-isolationtestkey000000000000";
    registry.addProvider({ presetId: "openrouter", apiKey: inlineKey, enabled: true });

    assert.equal(process.env["OPENROUTER_API_KEY"], undefined, "precondition: env unset");

    const { config } = await adapters.instantiateAdapterForRun({
      adapter: "openrouter",
      model: "some/unregistered-model",
    });

    const keyed = config as { api_key?: string };
    assert.equal(keyed.api_key, inlineKey, "inline key should flow via config.api_key");
    assert.equal(process.env["OPENROUTER_API_KEY"], undefined, "process.env must NOT be mutated with the provider key");
  });

  it("getAdapterCatalog does not leak inline keys into process.env", async () => {
    const inlineKey = "sk-or-v1-catalogtestkey1111111111111111";
    registry.addProvider({ presetId: "openrouter", apiKey: inlineKey, enabled: true });

    await adapters.getAdapterCatalog();

    assert.equal(process.env["OPENROUTER_API_KEY"], undefined, "catalog health checks must not write keys to env");
  });
});
