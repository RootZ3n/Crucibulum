import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeVerdict } from "../core/verdict.js";
import { summarizeRunSet } from "../server/contracts.js";
import { buildLeaderboardEntry } from "../leaderboard/aggregator.js";
function makeBundle(overrides = {}) {
    const pass = overrides.pass ?? true;
    const total = overrides.total ?? (pass ? 0.9 : 0.3);
    const correctnessScore = overrides.correctnessScore ?? (pass ? 1 : 0.2);
    return {
        bundle_id: "run_test_bundle",
        bundle_hash: "sha256:test",
        bundle_version: "1.0.0",
        task: { id: "task-1", manifest_hash: "sha256:m", family: "spec_discipline", difficulty: "medium" },
        agent: { adapter: "openrouter", adapter_version: "1.0.0", system: "test", system_version: "1.0.0", model: "model", model_version: "1.0.0", provider: "openrouter" },
        environment: { os: "linux-x64", arch: "x64", repo_commit: "abc", crucibulum_version: "1.0.0", timestamp_start: "2026-04-20T00:00:00.000Z", timestamp_end: "2026-04-20T00:00:05.000Z" },
        timeline: overrides.rawError ? [{ t: 0, type: "error", detail: overrides.rawError }] : [{ t: 0, type: "task_complete", detail: "done" }],
        diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
        security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
        verification_results: {
            correctness: { score: correctnessScore, details: {}, command_results: overrides.commandResults },
            regression: { score: 1, details: {}, command_results: [] },
            integrity: { score: 1, details: {}, violations: [] },
            efficiency: { time_sec: 5, time_limit_sec: 300, steps_used: 2, steps_limit: 20, score: 0.9 },
        },
        score: {
            scale: "fraction_0_1",
            total,
            total_percent: Math.round(total * 100),
            breakdown: { correctness: correctnessScore, regression: 1, integrity: 1, efficiency: 0.9 },
            breakdown_percent: { correctness: Math.round(correctnessScore * 100), regression: 100, integrity: 100, efficiency: 90 },
            pass,
            pass_threshold: 0.7,
            pass_threshold_percent: 70,
            integrity_violations: 0,
        },
        usage: { tokens_in: 100, tokens_out: 50, estimated_cost_usd: 0.01, provider_cost_note: "test" },
        judge: { kind: "deterministic", label: "Judge: deterministic", description: "test", verifier_model: null, components: ["judge"] },
        trust: {
            rubric_hidden: true,
            narration_ignored: true,
            state_based_scoring: true,
            bundle_verified: true,
            deterministic_judge_authoritative: true,
            review_layer_advisory: true,
        },
        diagnosis: { localized_correctly: pass, avoided_decoys: true, first_fix_correct: pass, self_verified: false, failure_mode: pass ? null : "wrong_output" },
        verdict: undefined,
        integrations: {
            veritor: { contract_version: "1.0.0", consumable: true },
            paedagogus: {
                contract_version: "1.0.0",
                consumable: true,
                routing_signals: {
                    task_family: "spec_discipline",
                    difficulty: "medium",
                    provider: "openrouter",
                    adapter: "openrouter",
                    score: total,
                    pass,
                    failure_mode: pass ? null : "wrong_output",
                },
            },
            crucible: { profile_id: null, benchmark_score: null, benchmark_label: null, execution_score: Math.round(total * 100), divergence_note: null },
        },
        ...overrides,
    };
}
describe("normalized verdict classification", () => {
    it("classifies successful completion as PASS", () => {
        const verdict = normalizeVerdict({ bundle: makeBundle({ pass: true, total: 0.92 }), executionMode: "repo", exitReason: "complete" });
        assert.equal(verdict.completionState, "PASS");
        assert.equal(verdict.failureOrigin, null);
        assert.equal(verdict.countsTowardModelScore, true);
    });
    it("classifies low score after successful completion as FAIL/MODEL", () => {
        const verdict = normalizeVerdict({ bundle: makeBundle({ pass: false, total: 0.3 }), executionMode: "repo", exitReason: "complete" });
        assert.equal(verdict.completionState, "FAIL");
        assert.equal(verdict.failureOrigin, "MODEL");
        assert.equal(verdict.failureReasonCode, "low_score");
        assert.equal(verdict.countsTowardFailureRate, true);
    });
    it("classifies provider timeout as NC/PROVIDER", () => {
        const verdict = normalizeVerdict({
            bundle: makeBundle({ pass: false, total: 0, rawError: "Model call failed: OpenAI timeout after 120000ms" }),
            executionMode: "repo",
            exitReason: "error",
            rawError: "OpenAI timeout after 120000ms",
        });
        assert.equal(verdict.completionState, "NC");
        assert.equal(verdict.failureOrigin, "PROVIDER");
        assert.equal(verdict.failureReasonCode, "provider_timeout");
        assert.equal(verdict.countsTowardFailureRate, false);
    });
    it("classifies connection resets as NC/NETWORK", () => {
        const verdict = normalizeVerdict({
            bundle: makeBundle({ pass: false, total: 0, rawError: "ECONNRESET while contacting provider" }),
            executionMode: "conversational",
            exitReason: "error",
            rawError: "ECONNRESET while contacting provider",
        });
        assert.equal(verdict.completionState, "NC");
        assert.equal(verdict.failureOrigin, "NETWORK");
        assert.equal(verdict.failureReasonCode, "network_connection_reset");
    });
    it("classifies provider 5xx and empty response as NC/PROVIDER", () => {
        const provider5xx = normalizeVerdict({
            bundle: makeBundle({ pass: false, total: 0, rawError: "OpenRouter returned 502 bad gateway" }),
            executionMode: "conversational",
            exitReason: "error",
            rawError: "OpenRouter returned 502 bad gateway",
        });
        const empty = normalizeVerdict({
            bundle: makeBundle({ pass: false, total: 0, rawError: "MiniMax returned empty content. Raw body: {}" }),
            executionMode: "conversational",
            exitReason: "error",
            rawError: "MiniMax returned empty content. Raw body: {}",
        });
        assert.equal(provider5xx.failureReasonCode, "provider_http_5xx");
        assert.equal(empty.failureReasonCode, "provider_empty_response");
    });
    it("classifies judge and test harness failures as NC", () => {
        const judgeVerdict = normalizeVerdict({
            bundle: makeBundle({
                pass: false,
                total: 0,
                commandResults: [{
                        id: "hidden-1",
                        scope: "correctness",
                        command: "node judge.js",
                        status: "error",
                        summary: "Command timed out: node judge.js",
                        timedOut: true,
                        errorKind: "timeout",
                    }],
            }),
            executionMode: "repo",
            exitReason: "complete",
        });
        const testBundle = makeBundle({
            pass: false,
            total: 0,
            verification_results: {
                correctness: { score: 1, details: {}, command_results: [] },
                regression: {
                    score: 0,
                    details: { public: "fail" },
                    command_results: [{
                            id: "public",
                            scope: "regression",
                            command: "npm test",
                            status: "error",
                            summary: "Command could not start (ENOENT): npm test",
                            errorKind: "spawn_error",
                        }],
                },
                integrity: { score: 1, details: {}, violations: [] },
                efficiency: { time_sec: 5, time_limit_sec: 300, steps_used: 2, steps_limit: 20, score: 0.9 },
            },
        });
        const testVerdict = normalizeVerdict({ bundle: testBundle, executionMode: "repo", exitReason: "complete" });
        assert.equal(judgeVerdict.failureOrigin, "JUDGE");
        assert.equal(judgeVerdict.completionState, "NC");
        assert.equal(testVerdict.failureOrigin, "TEST");
        assert.equal(testVerdict.completionState, "NC");
    });
});
describe("verdict-aware aggregation", () => {
    it("does not count NC toward model failure rate", () => {
        const passBundle = makeBundle({ pass: true, total: 0.9, bundle_id: "run_pass" });
        const failBundle = makeBundle({ pass: false, total: 0.2, bundle_id: "run_fail" });
        const ncBundle = makeBundle({ pass: false, total: 0, bundle_id: "run_nc", rawError: "OpenAI returned 429" });
        const bundles = [passBundle, failBundle, ncBundle];
        const summary = summarizeRunSet(bundles);
        const leaderboard = buildLeaderboardEntry("openrouter:openrouter:model", bundles);
        assert.equal(summary.failures, 1);
        assert.equal(summary.not_complete, 1);
        assert.equal(summary.model_failure_rate, 33.3333);
        assert.equal(summary.nc_rate, 33.3333);
        assert.equal(leaderboard.verdict_metrics?.model_failures, 1);
        assert.equal(leaderboard.verdict_metrics?.not_complete, 1);
    });
});
//# sourceMappingURL=verdict-classification.test.js.map