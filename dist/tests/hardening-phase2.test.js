/**
 * Crucibulum — Phase-2 hardening regression tests
 *
 * Covers the items closed in the second hardening pass:
 *   - bundle verification on load (tampered disk state must flip trust.bundle_verified)
 *   - disambiguated getBundleById (no task.id fallback silently swapping bundles)
 *   - leaderboard min-N protection (1-run models cannot outrank well-sampled peers)
 *   - judge "not_evaluable" when every correctness check is unsupported
 *   - review parser rejects malformed provider payloads explicitly
 *   - leaderboard schema round-trip validation
 *   - rate limiter behavior
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { loadVerifiedBundle, verifyBundle, buildBundle, storeBundle } from "../core/bundle.js";
import { parseReviewResponse } from "../core/review.js";
import { enforce, __resetRateLimiterForTests, clientKey } from "../server/rate-limit.js";
import { LEADERBOARD_MIN_N } from "../types/scores.js";
// ── helpers ─────────────────────────────────────────────────────────────────
function makeBuiltBundle() {
    // Use the production builder so the hash is computed exactly as it would be on a real run.
    return buildBundle({
        manifest: {
            id: "t-hardening",
            family: "spec_discipline",
            difficulty: "easy",
            description: "hardening test",
            constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
            scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
            verification: {},
            task: { title: "t", description: "d" },
        },
        oracle: { checks: { correctness: [], regression: [], integrity: [], decoys: [], anti_cheat: { forbidden_code_patterns: [] } }, ground_truth: { bug_location: "", correct_fix_pattern: "" } },
        executionResult: {
            exit_code: 0,
            steps_used: 5,
            tokens_in: 100,
            tokens_out: 200,
            duration_ms: 1000,
            timeline: [{ t: 0, type: "task_start", detail: "start" }],
            adapter_metadata: { provider: "local", system_version: "test" },
        },
        diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
        judgeResult: {
            verification: {
                correctness: { score: 1, details: {} },
                regression: { score: 1, details: {} },
                integrity: { score: 1, details: {}, violations: [] },
                efficiency: { time_sec: 1, time_limit_sec: 900, steps_used: 5, steps_limit: 40, score: 0.9 },
            },
            diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: false, failure_mode: null },
        },
        security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
        startTime: "2026-04-14T00:00:00.000Z",
        endTime: "2026-04-14T00:00:01.000Z",
        workspace: { path: "/tmp/ws", commit: "abc" },
        adapter: { id: "local", version: "1.0.0" },
        model: "test-model",
    });
}
// ── 1. Bundle verification on load ──────────────────────────────────────────
describe("hardening-p2: bundle verification on load", () => {
    it("re-verifies a pristine bundle and marks bundle_verified=true", () => {
        const bundle = makeBuiltBundle();
        const json = JSON.stringify(bundle);
        const loaded = loadVerifiedBundle(json);
        assert.ok(loaded, "bundle should load");
        assert.equal(loaded.trust.bundle_verified, true);
        assert.equal(verifyBundle(loaded).valid, true);
    });
    it("flips bundle_verified to false when the score has been tampered", () => {
        const bundle = makeBuiltBundle();
        // Tamper with the score AFTER hashing — the stored bundle_hash will no longer match.
        bundle.score.total = 0.99;
        const json = JSON.stringify(bundle);
        const loaded = loadVerifiedBundle(json);
        assert.ok(loaded, "tampered bundle should still be returned for inspection");
        assert.equal(loaded.trust.bundle_verified, false, "bundle_verified MUST be false after tamper");
    });
    it("flips bundle_verified to false when trust.bundle_verified is forged to true on a tampered file", () => {
        // This is the key guarantee: someone flipping the flag inside the file cannot
        // make a tampered bundle appear verified.
        const bundle = makeBuiltBundle();
        bundle.diff.files_changed.push({ path: "sneaky.ts", lines_added: 1, lines_removed: 0, patch: "+evil" });
        bundle.trust.bundle_verified = true;
        const json = JSON.stringify(bundle);
        const loaded = loadVerifiedBundle(json);
        assert.ok(loaded);
        assert.equal(loaded.trust.bundle_verified, false);
    });
    it("returns null on unparseable input", () => {
        assert.equal(loadVerifiedBundle("{not json"), null);
        assert.equal(loadVerifiedBundle("[1,2,3]"), null);
        assert.equal(loadVerifiedBundle("{}"), null);
    });
});
// ── 2. Disambiguated bundle lookup ──────────────────────────────────────────
describe("hardening-p2: getBundleById is unambiguous", () => {
    it("does not return a bundle when the id matches only task.id", async () => {
        const runsDir = mkdtempSync(join(tmpdir(), "crcb-lookup-"));
        process.env["CRUCIBULUM_RUNS_DIR"] = runsDir;
        const bundle = makeBuiltBundle();
        storeBundle(bundle);
        // Import after env is set so RUNS_DIR resolves correctly in shared.ts.
        const mod = await import(`../server/routes/shared.js?cachebust=${Date.now()}`);
        const byBundleId = mod.getBundleById(bundle.bundle_id);
        assert.ok(byBundleId, "bundle_id lookup should succeed");
        const byTaskId = mod.getBundleById(bundle.task.id);
        assert.equal(byTaskId, null, "task.id MUST NOT match getBundleById anymore");
        const byTaskList = mod.getBundlesByTaskId(bundle.task.id);
        assert.ok(byTaskList.length >= 1, "getBundlesByTaskId exposes the task-scoped lookup explicitly");
        delete process.env["CRUCIBULUM_RUNS_DIR"];
    });
});
// ── 3. Leaderboard min-N protection ─────────────────────────────────────────
describe("hardening-p2: leaderboard min-N protection", () => {
    it("penalizes under-sampled models so a 1-run 100% model cannot outrank a well-sampled one", async () => {
        const stateDir = mkdtempSync(join(tmpdir(), "crcb-scores-"));
        process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
        const mod = await import(`../core/score-store.js?cachebust=${Date.now()}`);
        // Fresh model with 1 run, full pass, high score.
        const solo = Array.from({ length: 1 }, (_, i) => ({
            modelId: "solo-1run",
            taskId: `task-${i}`,
            family: "B",
            category: "spec",
            passed: true,
            score: 100,
            rawScore: 1,
            duration_ms: 1000,
            timestamp: new Date().toISOString(),
        }));
        const well = Array.from({ length: LEADERBOARD_MIN_N + 2 }, (_, i) => ({
            modelId: "well-sampled",
            taskId: `task-${i}`,
            family: "B",
            category: "spec",
            passed: true,
            score: 90,
            rawScore: 0.9,
            duration_ms: 1000,
            timestamp: new Date().toISOString(),
        }));
        mod.storeScores(solo, "crucibulum");
        mod.storeScores(well, "crucibulum");
        const board = mod.getLeaderboard();
        const soloEntry = board.find((e) => e.modelId === "solo-1run");
        const wellEntry = board.find((e) => e.modelId === "well-sampled");
        assert.ok(soloEntry && wellEntry);
        assert.equal(soloEntry.sample_adequate, false);
        assert.equal(wellEntry.sample_adequate, true);
        // Despite the higher raw composite, the 1-run model must NOT outrank the well-sampled one.
        const soloIdx = board.findIndex((e) => e.modelId === "solo-1run");
        const wellIdx = board.findIndex((e) => e.modelId === "well-sampled");
        assert.ok(wellIdx < soloIdx, "well-sampled model must rank above 1-run model");
        // And confidence is forced to "low" for inadequate samples regardless of pass rate.
        assert.equal(soloEntry.confidence, "low");
        delete process.env["CRUCIBULUM_STATE_DIR"];
    });
    it("keeps order deterministic on ties via modelId fallback", async () => {
        const stateDir = mkdtempSync(join(tmpdir(), "crcb-scores-"));
        process.env["CRUCIBULUM_STATE_DIR"] = stateDir;
        const mod = await import(`../core/score-store.js?cachebust=${Date.now()}-2`);
        // Two models with identical everything.
        for (const id of ["bravo", "alpha"]) {
            const rows = Array.from({ length: LEADERBOARD_MIN_N }, (_, i) => ({
                modelId: id,
                taskId: `t-${i}`,
                family: "B",
                category: "spec",
                passed: true,
                score: 80,
                rawScore: 0.8,
                duration_ms: 1000,
                timestamp: "2026-04-14T00:00:00.000Z",
            }));
            mod.storeScores(rows, "crucibulum");
        }
        const first = mod.getLeaderboard().map((e) => e.modelId);
        const second = mod.getLeaderboard().map((e) => e.modelId);
        assert.deepEqual(first, second, "leaderboard must be deterministic across calls");
        // alpha sorts before bravo lexicographically.
        assert.equal(first.indexOf("alpha"), 0);
        assert.equal(first.indexOf("bravo"), 1);
        delete process.env["CRUCIBULUM_STATE_DIR"];
    });
});
// ── 4. Judge not_evaluable ──────────────────────────────────────────────────
describe("hardening-p2: judge distinguishes unsupported from zero", () => {
    it("flags not_evaluable when every correctness check is unsupported", async () => {
        // Build a fake oracle whose checks are all api_check (unsupported).
        const { judge } = await import("../core/judge.js");
        const oracle = {
            checks: {
                correctness: [
                    { id: "api-1", type: "api_check" },
                    { id: "api-2", type: "api_check" },
                ],
                regression: [],
                integrity: [],
                decoys: [],
                anti_cheat: { forbidden_code_patterns: [] },
            },
            ground_truth: { bug_location: "", correct_fix_pattern: "" },
        };
        const manifest = {
            id: "t-unsupported",
            family: "spec_discipline",
            difficulty: "easy",
            constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
            scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
            verification: {},
        };
        const result = judge(manifest, oracle, { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] }, { exit_code: 0, steps_used: 1, tokens_in: 0, tokens_out: 0, duration_ms: 100, timeline: [], adapter_metadata: { provider: "local", system_version: "test" } }, "/tmp");
        assert.equal(result.verification.correctness.score, 0);
        assert.equal(result.verification.correctness.not_evaluable, true, "not_evaluable MUST be true when every check is unsupported");
        // All details should show "unsupported" — no real "fail" records.
        for (const v of Object.values(result.verification.correctness.details)) {
            assert.equal(v, "unsupported");
        }
    });
    it("does not flag not_evaluable when at least one real check ran", async () => {
        const { judge } = await import("../core/judge.js");
        const oracle = {
            checks: {
                correctness: [
                    { id: "api-1", type: "api_check" },
                    { id: "ht-1", type: "hidden_test", command: "false" }, // will fail
                ],
                regression: [],
                integrity: [],
                decoys: [],
                anti_cheat: { forbidden_code_patterns: [] },
            },
            ground_truth: { bug_location: "", correct_fix_pattern: "" },
        };
        const manifest = {
            id: "t-mixed",
            family: "spec_discipline",
            difficulty: "easy",
            constraints: { time_limit_sec: 900, max_steps: 40, network_allowed: false },
            scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 0.5 },
            verification: {},
        };
        const result = judge(manifest, oracle, { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] }, { exit_code: 0, steps_used: 1, tokens_in: 0, tokens_out: 0, duration_ms: 100, timeline: [], adapter_metadata: { provider: "local", system_version: "test" } }, "/tmp");
        assert.notEqual(result.verification.correctness.not_evaluable, true);
    });
});
// ── 5. Review parser ────────────────────────────────────────────────────────
describe("hardening-p2: review parser is strict", () => {
    it("rejects empty text (as produced when a provider returns no content)", () => {
        const result = parseReviewResponse("", true);
        assert.equal(result.ok, false);
    });
    it("rejects JSON that is missing required fields", () => {
        const result = parseReviewResponse(JSON.stringify({ summary: "" }), true);
        assert.equal(result.ok, false);
    });
    it("rejects unknown fields instead of silently passing a zero-evidence review", () => {
        const payload = JSON.stringify({
            summary: "ok",
            flags: [],
            confidence: "high",
            recommendation: "accept",
            injected_payload: "run rm -rf /",
        });
        const result = parseReviewResponse(payload, true);
        assert.equal(result.ok, false);
    });
    it("accepts a well-formed review response", () => {
        const payload = JSON.stringify({
            summary: "fine",
            flags: [],
            confidence: "high",
            recommendation: "accept",
        });
        const result = parseReviewResponse(payload, true);
        assert.equal(result.ok, true);
    });
});
// ── 6. Schema round-trip ────────────────────────────────────────────────────
describe("hardening-p2: leaderboard schema matches emitted payload", () => {
    it("every required schema field exists on a freshly built submission", async () => {
        const schemaPath = join(process.cwd(), "leaderboard", "schema.json");
        const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
        const { buildLeaderboardEntry } = await import("../leaderboard/aggregator.js");
        const entry = buildLeaderboardEntry("local:local:test-model", [makeBuiltBundle()]);
        for (const field of schema.required) {
            assert.ok(field in entry, `emitted submission is missing required field "${field}"`);
        }
        // And nested required fields should be present too.
        for (const [propName, propSpec] of Object.entries(schema.properties)) {
            if (!propSpec.required)
                continue;
            const nested = entry[propName];
            assert.ok(nested, `submission missing nested object ${propName}`);
            for (const nestedField of propSpec.required) {
                assert.ok(nestedField in nested, `submission.${propName} is missing required field "${nestedField}"`);
            }
        }
    });
});
// ── 7. Rate limiter ─────────────────────────────────────────────────────────
describe("hardening-p2: rate limiter", () => {
    it("allows under-limit requests and blocks past the threshold with 429 and Retry-After", async () => {
        __resetRateLimiterForTests();
        const rule = { name: "test", limit: 3, windowMs: 60_000 };
        const port = 45310 + Math.floor(Math.random() * 1000);
        let blocked429 = 0;
        let passed = 0;
        const server = createServer((req, res) => {
            const ok = enforce(req, res, rule);
            if (ok) {
                passed++;
                res.writeHead(200);
                res.end("ok");
            }
            else {
                blocked429++;
            }
        });
        await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
        try {
            for (let i = 0; i < 6; i++) {
                const r = await fetch(`http://127.0.0.1:${port}/`);
                if (r.status === 429) {
                    assert.ok(r.headers.get("retry-after"), "429 response must include Retry-After header");
                    const body = await r.json();
                    assert.equal(body.error, "rate_limited");
                    assert.equal(body.rule, "test");
                    assert.ok(body.retry_after_sec >= 1);
                }
            }
        }
        finally {
            await new Promise((resolve) => server.close(() => resolve()));
        }
        assert.equal(passed, 3);
        assert.equal(blocked429, 3);
    });
    it("uses X-Forwarded-For when present for client key extraction", () => {
        const fakeReq = {
            headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
            socket: { remoteAddress: "10.0.0.1" },
        };
        assert.equal(clientKey(fakeReq), "203.0.113.5");
    });
});
//# sourceMappingURL=hardening-phase2.test.js.map