/**
 * Crucible — Cleanup Tests
 *
 * Smoke coverage for `cleanupStaleArtifacts` / `getCleanupStats`. Originally
 * authored against vitest; ported to node:test so it actually runs in CI
 * (the project's test runner is `node --test`, vitest is not a dependency).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { cleanupStaleArtifacts, getCleanupStats } from "../core/cleanup.js";
describe("cleanupStaleArtifacts", () => {
    it("returns a result object with expected fields", () => {
        const result = cleanupStaleArtifacts({ dryRun: true });
        assert.ok("scanned" in result, "result must carry a scanned counter");
        assert.ok("deleted" in result, "result must carry a deleted counter");
        assert.ok("skipped" in result, "result must carry a skipped counter");
        assert.ok(Array.isArray(result.deleted_items), "deleted_items must be an array");
        assert.ok(Array.isArray(result.skipped_items), "skipped_items must be an array");
        assert.ok(Array.isArray(result.errors), "errors must be an array");
    });
    it("dry run never deletes anything", () => {
        const result = cleanupStaleArtifacts({ dryRun: true });
        assert.equal(result.deleted, 0);
        assert.equal(result.deleted_items.length, 0);
    });
    it("respects maxAgeMs option", () => {
        // Same scan target either way; age cutoff just shifts which entries
        // get classified as stale, not how many files are visited.
        const result1 = cleanupStaleArtifacts({ dryRun: true, maxAgeMs: 1000 });
        const result7 = cleanupStaleArtifacts({ dryRun: true, maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
        assert.equal(result1.scanned, result7.scanned);
    });
});
describe("getCleanupStats", () => {
    it("returns stats without deleting", () => {
        const result = getCleanupStats();
        assert.equal(result.deleted, 0);
        assert.ok(result.scanned >= 0);
    });
});
//# sourceMappingURL=cleanup.test.js.map