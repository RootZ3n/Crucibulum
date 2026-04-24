/**
 * Crucible — Suite Flake Integration Tests
 *
 * Suite-level flake config resolution and confidence computation. Originally
 * authored against vitest; ported to node:test so the project's `node --test`
 * runner picks them up. Logic is unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveFlakeConfig, computeConfidence, DEFAULT_FLAKE_CONFIG } from "../core/suite-loader.js";
describe("resolveFlakeConfig", () => {
    it("returns defaults when no suite and no override", () => {
        const config = resolveFlakeConfig(undefined);
        assert.deepEqual(config, DEFAULT_FLAKE_CONFIG);
        assert.equal(config.enabled, true);
        assert.equal(config.retries, 3);
    });
    it("loads config from suite manifest", () => {
        const config = resolveFlakeConfig("v1");
        assert.equal(config.enabled, true);
        assert.equal(config.retries, 3);
    });
    it("request override takes precedence over suite manifest", () => {
        const config = resolveFlakeConfig("v1", { retries: 5 });
        assert.equal(config.retries, 5);
        assert.equal(config.enabled, true);
    });
    it("can disable flake detection via override", () => {
        const config = resolveFlakeConfig("v1", { enabled: false });
        assert.equal(config.enabled, false);
    });
    it("returns defaults for nonexistent suite", () => {
        const config = resolveFlakeConfig("nonexistent");
        assert.deepEqual(config, DEFAULT_FLAKE_CONFIG);
    });
    it("override can change both enabled and retries", () => {
        const config = resolveFlakeConfig(undefined, { enabled: false, retries: 1 });
        assert.equal(config.enabled, false);
        assert.equal(config.retries, 1);
    });
});
describe("computeConfidence", () => {
    it("high: pass_rate 1.0 and not flaky", () => {
        assert.equal(computeConfidence(1.0, false), "high");
    });
    it("high: pass_rate 1.0 with flaky is medium", () => {
        assert.equal(computeConfidence(1.0, true), "medium");
    });
    it("medium: pass_rate 0.8 and not flaky", () => {
        assert.equal(computeConfidence(0.8, false), "medium");
    });
    it("medium: pass_rate 0.6 and flaky", () => {
        assert.equal(computeConfidence(0.6, true), "medium");
    });
    it("low: pass_rate 0.5 and not flaky", () => {
        assert.equal(computeConfidence(0.5, false), "low");
    });
    it("low: pass_rate 0.3", () => {
        assert.equal(computeConfidence(0.3, false), "low");
        assert.equal(computeConfidence(0.3, true), "low");
    });
    it("medium: pass_rate 0.7 and not flaky", () => {
        assert.equal(computeConfidence(0.7, false), "medium");
    });
    it("low: pass_rate 0.69", () => {
        assert.equal(computeConfidence(0.69, false), "low");
    });
});
describe("suite flake summary structure", () => {
    it("defines expected outcome types", () => {
        const outcomes = ["stable_pass", "stable_fail", "flaky_pass", "flaky_fail"];
        assert.equal(outcomes.length, 4);
        assert.ok(outcomes.includes("stable_pass"));
        assert.ok(outcomes.includes("stable_fail"));
        assert.ok(outcomes.includes("flaky_pass"));
        assert.ok(outcomes.includes("flaky_fail"));
    });
});
//# sourceMappingURL=suite-flake.test.js.map