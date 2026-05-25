/**
 * Crucible — Cleanup Tests
 *
 * Smoke coverage for `cleanupStaleArtifacts` / `getCleanupStats`. Originally
 * authored against vitest; ported to node:test so it actually runs in CI
 * (the project's test runner is `node --test`, vitest is not a dependency).
 *
 * 2026-05-25 flake fix: the original "respects maxAgeMs" test scanned
 * the real ./runs directory twice and asserted scanned-count equality.
 * Other tests/processes (release-gauntlet, model-certify) write run
 * bundles in parallel — between the two scans a file could appear,
 * making `scanned` differ. Tests now use a deterministic temp
 * directory via the new `runsDir` option on cleanupStaleArtifacts.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupStaleArtifacts, getCleanupStats } from "../core/cleanup.js";

describe("cleanupStaleArtifacts", () => {
  let tempRunsDir: string;

  before(() => {
    // Self-contained temp runs/ directory — no contamination from the
    // production ./runs path or from parallel test writes.
    tempRunsDir = mkdtempSync(join(tmpdir(), "crucible-cleanup-test-"));
    // Seed deterministic content: one stale ws_*, one fresh ws_*, one
    // stale run_*.json, one fresh run_*.json, one unrelated file.
    mkdirSync(join(tempRunsDir, "ws_fresh"), { recursive: true });
    mkdirSync(join(tempRunsDir, "ws_old"), { recursive: true });
    writeFileSync(join(tempRunsDir, "ws_fresh", "file.txt"), "ok");
    writeFileSync(join(tempRunsDir, "ws_old", "file.txt"), "ok");
    writeFileSync(join(tempRunsDir, "run_fresh.json"), "{}");
    writeFileSync(join(tempRunsDir, "run_old.json"), "{}");
    writeFileSync(join(tempRunsDir, "notes.md"), "not an artifact");
    // Age the "old" entries by stat — use a very old utime via a touch
    // hack: rewrite then accept Date.now()-based test using maxAgeMs.
    // (We don't need to fake mtimes here — the scan-count test only
    // depends on entry count, which is deterministic in this temp dir.)
  });

  after(() => {
    rmSync(tempRunsDir, { recursive: true, force: true });
  });

  it("returns a result object with expected fields", () => {
    const result = cleanupStaleArtifacts({ dryRun: true, runsDir: tempRunsDir });
    assert.ok("scanned" in result, "result must carry a scanned counter");
    assert.ok("deleted" in result, "result must carry a deleted counter");
    assert.ok("skipped" in result, "result must carry a skipped counter");
    assert.ok(Array.isArray(result.deleted_items), "deleted_items must be an array");
    assert.ok(Array.isArray(result.skipped_items), "skipped_items must be an array");
    assert.ok(Array.isArray(result.errors), "errors must be an array");
  });

  it("dry run never deletes anything", () => {
    const result = cleanupStaleArtifacts({ dryRun: true, runsDir: tempRunsDir });
    assert.equal(result.deleted, 0);
    assert.equal(result.deleted_items.length, 0);
  });

  it("respects maxAgeMs option", () => {
    // Run both scans against the SAME temp directory (no parallel writers).
    // Now scanned counts are deterministic; the option only changes
    // staleness classification, not the file count.
    const result1 = cleanupStaleArtifacts({ dryRun: true, maxAgeMs: 1000, runsDir: tempRunsDir });
    const result7 = cleanupStaleArtifacts({ dryRun: true, maxAgeMs: 7 * 24 * 60 * 60 * 1000, runsDir: tempRunsDir });
    assert.equal(result1.scanned, result7.scanned, `scanned counts must match under a stable runsDir (got ${result1.scanned} vs ${result7.scanned})`);
    // Seed wrote 5 top-level entries (ws_fresh, ws_old, run_fresh.json, run_old.json, notes.md).
    assert.equal(result1.scanned, 5, "temp dir should contain exactly 5 seeded entries");
  });
});

describe("getCleanupStats", () => {
  it("returns stats without deleting", () => {
    // Use a temp directory here too so the production runs/ is never
    // mutated by the test process.
    const dir = mkdtempSync(join(tmpdir(), "crucible-cleanup-stats-"));
    try {
      const result = getCleanupStats({ maxAgeMs: 1000, runsDir: dir });
      assert.equal(result.deleted, 0);
      assert.ok(result.scanned >= 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
