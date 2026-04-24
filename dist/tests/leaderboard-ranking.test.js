/**
 * Crucible — Leaderboard Ranking Tests
 *
 * Reliability-aware ranking + reporting fields. Originally written against
 * vitest; ported to node:test so the project's `node --test` runner picks
 * them up. Logic is unchanged — only the test framework calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
describe("leaderboard ranking logic", () => {
    function computeRanking(models) {
        return models
            .map((m) => {
            const stabilityScore = Math.abs(m.averagePassRate - 0.5) * 2;
            const reliabilityScore = Math.round(m.composite * (0.5 + stabilityScore * 0.5) * 100) / 100;
            return { modelId: m.modelId, reliabilityScore, stabilityScore, composite: m.composite, averagePassRate: m.averagePassRate };
        })
            .sort((a, b) => {
            if (b.reliabilityScore !== a.reliabilityScore)
                return b.reliabilityScore - a.reliabilityScore;
            if (b.averagePassRate !== a.averagePassRate)
                return b.averagePassRate - a.averagePassRate;
            return b.composite - a.composite;
        })
            .map((m, i) => ({ modelId: m.modelId, reliabilityScore: m.reliabilityScore, rank: i + 1 }));
    }
    it("stable high-pass model ranks above flaky model with similar raw score", () => {
        const results = computeRanking([
            { modelId: "flaky-high", composite: 90, averagePassRate: 0.7 },
            { modelId: "stable-high", composite: 88, averagePassRate: 1.0 },
        ]);
        assert.equal(results[0].modelId, "stable-high");
        assert.equal(results[1].modelId, "flaky-high");
    });
    it("stable low-pass model ranks above flaky model", () => {
        const results = computeRanking([
            { modelId: "flaky-mid", composite: 60, averagePassRate: 0.5 },
            { modelId: "stable-low", composite: 55, averagePassRate: 0.0 },
        ]);
        assert.equal(results[0].modelId, "stable-low");
        assert.equal(results[1].modelId, "flaky-mid");
    });
    it("perfect model ranks above all", () => {
        const results = computeRanking([
            { modelId: "decent", composite: 80, averagePassRate: 0.9 },
            { modelId: "perfect", composite: 100, averagePassRate: 1.0 },
            { modelId: "flaky", composite: 95, averagePassRate: 0.6 },
        ]);
        assert.equal(results[0].modelId, "perfect");
    });
    it("reliability score is between composite * 0.5 and composite", () => {
        const stabilityAt50 = Math.abs(0.5 - 0.5) * 2;
        const stabilityAt100 = Math.abs(1.0 - 0.5) * 2;
        assert.equal(stabilityAt50, 0);
        assert.equal(stabilityAt100, 1);
        const reliabilityAt50 = Math.round(100 * (0.5 + stabilityAt50 * 0.5) * 100) / 100;
        const reliabilityAt100 = Math.round(100 * (0.5 + stabilityAt100 * 0.5) * 100) / 100;
        assert.equal(reliabilityAt50, 50);
        assert.equal(reliabilityAt100, 100);
    });
});
describe("stability score computation", () => {
    function computeStability(passRate) {
        return Math.round(Math.abs(passRate - 0.5) * 2 * 100) / 100;
    }
    it("returns 0 for 50% pass rate (maximum uncertainty)", () => {
        assert.equal(computeStability(0.5), 0);
    });
    it("returns 1.0 for 100% pass rate (perfect stability)", () => {
        assert.equal(computeStability(1.0), 1);
    });
    it("returns 1.0 for 0% pass rate (consistent failure = stable)", () => {
        assert.equal(computeStability(0.0), 1);
    });
    it("returns ~0.6 for 80% pass rate", () => {
        assert.equal(computeStability(0.8), 0.6);
    });
    it("returns ~0.6 for 20% pass rate", () => {
        assert.equal(computeStability(0.2), 0.6);
    });
});
describe("confidence computation", () => {
    function computeConfidence(passRate, _isFlaky) {
        const stabilityScore = Math.abs(passRate - 0.5) * 2;
        if (passRate >= 0.95 && stabilityScore >= 0.8)
            return "high";
        if (passRate >= 0.7 || stabilityScore >= 0.5)
            return "medium";
        return "low";
    }
    it("high: pass_rate 1.0 with high stability", () => {
        assert.equal(computeConfidence(1.0, false), "high");
    });
    it("high: pass_rate 0.95 still resolves high (stability ≈ 0.9)", () => {
        assert.equal(computeConfidence(0.95, true), "high");
    });
    it("medium: pass_rate 0.8", () => {
        assert.equal(computeConfidence(0.8, false), "medium");
    });
    it("low: pass_rate 0.5", () => {
        assert.equal(computeConfidence(0.5, false), "low");
    });
    it("low: pass_rate 0.3", () => {
        assert.equal(computeConfidence(0.3, false), "low");
    });
});
//# sourceMappingURL=leaderboard-ranking.test.js.map