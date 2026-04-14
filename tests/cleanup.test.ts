/**
 * Crucibulum — Cleanup Tests
 * Tests for workspace/artifact cleanup logic.
 */

import { describe, it, expect } from "vitest";
import { cleanupStaleArtifacts, getCleanupStats } from "../core/cleanup.js";

describe("cleanupStaleArtifacts", () => {
  it("returns a result object with expected fields", () => {
    const result = cleanupStaleArtifacts({ dryRun: true });
    expect(result).toHaveProperty("scanned");
    expect(result).toHaveProperty("deleted");
    expect(result).toHaveProperty("skipped");
    expect(result).toHaveProperty("deleted_items");
    expect(result).toHaveProperty("skipped_items");
    expect(result).toHaveProperty("errors");
    expect(Array.isArray(result.deleted_items)).toBe(true);
    expect(Array.isArray(result.skipped_items)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it("dry run never deletes anything", () => {
    const result = cleanupStaleArtifacts({ dryRun: true });
    expect(result.deleted).toBe(0);
    expect(result.deleted_items.length).toBe(0);
  });

  it("respects maxAgeMs option", () => {
    const result1 = cleanupStaleArtifacts({ dryRun: true, maxAgeMs: 1000 });
    const result7 = cleanupStaleArtifacts({ dryRun: true, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    // Shorter maxAge should scan the same items but potentially mark more as stale
    expect(result1.scanned).toBe(result7.scanned);
  });
});

describe("getCleanupStats", () => {
  it("returns stats without deleting", () => {
    const result = getCleanupStats();
    expect(result.deleted).toBe(0);
    expect(result.scanned).toBeGreaterThanOrEqual(0);
  });
});
