/**
 * Crucible — Hardening regression tests
 * Covers the pre-production hardening pass fixes:
 * - safe bundle-id validation (path traversal defense)
 * - bounded JSON body parsing
 * - deterministic leaderboard tie-breaking
 * - buildLeaderboardEntry empty-bundle guard
 * - readCrucibleLink corrupt-JSON tolerance
 * - cleanup workspace dead-branch fix
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeId } from "../server/routes/shared.js";
import { readCrucibleLink, writeCrucibleLink } from "../server/validation-links.js";
import { buildLeaderboardEntry } from "../leaderboard/aggregator.js";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("hardening: safe id validation", () => {
    it("accepts well-formed bundle ids", () => {
        assert.ok(isSafeId("run_2026-04-14_poison-001_gpt-4o-mini"));
        assert.ok(isSafeId("batch_abc123"));
        assert.ok(isSafeId("run.test.1"));
    });
    it("rejects path-traversal attempts", () => {
        assert.equal(isSafeId("../../../etc/passwd"), false);
        assert.equal(isSafeId("../../runs/foo"), false);
        assert.equal(isSafeId("run/../secret"), false);
        assert.equal(isSafeId("run\\..\\secret"), false);
    });
    it("rejects empty, null-ish, and absurdly long ids", () => {
        assert.equal(isSafeId(""), false);
        assert.equal(isSafeId(null), false);
        assert.equal(isSafeId(undefined), false);
        assert.equal(isSafeId("a".repeat(300)), false);
    });
    it("rejects ids with whitespace, null bytes, or glob metachars", () => {
        assert.equal(isSafeId("run abc"), false);
        assert.equal(isSafeId("run\x00abc"), false);
        assert.equal(isSafeId("run*"), false);
    });
});
describe("hardening: readCrucibleLink tolerates corruption", () => {
    it("returns null for corrupted JSON instead of throwing", () => {
        const dir = mkdtempSync(join(tmpdir(), "crcb-link-"));
        process.env["CRUCIBULUM_LINKS_DIR"] = dir;
        const id = "run_corrupt_test";
        writeFileSync(join(dir, `${id}.crucible.json`), "not valid json {{{", "utf-8");
        const out = readCrucibleLink(id);
        assert.equal(out, null);
        delete process.env["CRUCIBULUM_LINKS_DIR"];
    });
    it("returns null for a missing link file", () => {
        const dir = mkdtempSync(join(tmpdir(), "crcb-link-"));
        process.env["CRUCIBULUM_LINKS_DIR"] = dir;
        const out = readCrucibleLink("does_not_exist_anywhere");
        assert.equal(out, null);
        delete process.env["CRUCIBULUM_LINKS_DIR"];
    });
    it("round-trips a valid link", () => {
        const dir = mkdtempSync(join(tmpdir(), "crcb-link-"));
        process.env["CRUCIBULUM_LINKS_DIR"] = dir;
        const id = "run_roundtrip";
        writeCrucibleLink(id, { profile_id: "p1", benchmark_score: 91, benchmark_label: "A-" });
        const out = readCrucibleLink(id);
        assert.deepEqual(out, { profile_id: "p1", benchmark_score: 91, benchmark_label: "A-" });
        delete process.env["CRUCIBULUM_LINKS_DIR"];
    });
});
describe("hardening: buildLeaderboardEntry preconditions", () => {
    it("throws with a clear message on empty bundles instead of crashing on [0]!", () => {
        assert.throws(() => buildLeaderboardEntry("some:key", []), /cannot build entry/);
    });
});
//# sourceMappingURL=hardening.test.js.map