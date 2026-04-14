/**
 * Crucibulum — Suite Flake Integration Tests
 * Tests for suite-level flake detection integration.
 */

import { describe, it, expect } from "vitest";
import { resolveFlakeConfig, computeConfidence, DEFAULT_FLAKE_CONFIG } from "../core/suite-loader.js";

describe("resolveFlakeConfig", () => {
  it("returns defaults when no suite and no override", () => {
    const config = resolveFlakeConfig(undefined);
    expect(config).toEqual(DEFAULT_FLAKE_CONFIG);
    expect(config.enabled).toBe(true);
    expect(config.retries).toBe(3);
  });

  it("loads config from suite manifest", () => {
    // v1 suite has flake_detection: { enabled: true, retries: 3 }
    const config = resolveFlakeConfig("v1");
    expect(config.enabled).toBe(true);
    expect(config.retries).toBe(3);
  });

  it("request override takes precedence over suite manifest", () => {
    const config = resolveFlakeConfig("v1", { retries: 5 });
    expect(config.retries).toBe(5);
    expect(config.enabled).toBe(true); // from suite
  });

  it("can disable flake detection via override", () => {
    const config = resolveFlakeConfig("v1", { enabled: false });
    expect(config.enabled).toBe(false);
  });

  it("returns defaults for nonexistent suite", () => {
    const config = resolveFlakeConfig("nonexistent");
    expect(config).toEqual(DEFAULT_FLAKE_CONFIG);
  });

  it("override can change both enabled and retries", () => {
    const config = resolveFlakeConfig(undefined, { enabled: false, retries: 1 });
    expect(config.enabled).toBe(false);
    expect(config.retries).toBe(1);
  });
});

describe("computeConfidence", () => {
  it("high: pass_rate 1.0 and not flaky", () => {
    expect(computeConfidence(1.0, false)).toBe("high");
  });

  it("high: pass_rate 1.0 with flaky is medium", () => {
    expect(computeConfidence(1.0, true)).toBe("medium");
  });

  it("medium: pass_rate 0.8 and not flaky", () => {
    expect(computeConfidence(0.8, false)).toBe("medium");
  });

  it("medium: pass_rate 0.6 and flaky", () => {
    expect(computeConfidence(0.6, true)).toBe("medium");
  });

  it("low: pass_rate 0.5 and not flaky", () => {
    expect(computeConfidence(0.5, false)).toBe("low");
  });

  it("low: pass_rate 0.3", () => {
    expect(computeConfidence(0.3, false)).toBe("low");
    expect(computeConfidence(0.3, true)).toBe("low");
  });

  it("medium: pass_rate 0.7 and not flaky", () => {
    expect(computeConfidence(0.7, false)).toBe("medium");
  });

  it("low: pass_rate 0.69", () => {
    expect(computeConfidence(0.69, false)).toBe("low");
  });
});

describe("suite flake summary structure", () => {
  it("defines expected outcome types", () => {
    const outcomes = ["stable_pass", "stable_fail", "flaky_pass", "flaky_fail"] as const;
    expect(outcomes).toHaveLength(4);
    expect(outcomes).toContain("stable_pass");
    expect(outcomes).toContain("stable_fail");
    expect(outcomes).toContain("flaky_pass");
    expect(outcomes).toContain("flaky_fail");
  });
});
