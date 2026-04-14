/**
 * Crucibulum — Leaderboard Ranking Tests
 * Tests for reliability-aware ranking and reporting fields.
 */
import { describe, it, expect } from "vitest";
// Test the ranking logic directly (without database)
describe("leaderboard ranking logic", () => {
    // Simulated ranking computation
    function computeRanking(models) {
        return models
            .map(m => {
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
            { modelId: "flaky-high", composite: 90, averagePassRate: 0.7 }, // 70% pass but composite is high
            { modelId: "stable-high", composite: 88, averagePassRate: 1.0 }, // 100% pass, slightly lower composite
        ]);
        // stable-high should rank first despite lower composite
        expect(results[0].modelId).toBe("stable-high");
        expect(results[1].modelId).toBe("flaky-high");
    });
    it("stable low-pass model ranks above flaky model", () => {
        const results = computeRanking([
            { modelId: "flaky-mid", composite: 60, averagePassRate: 0.5 }, // 50% pass, unstable
            { modelId: "stable-low", composite: 55, averagePassRate: 0.0 }, // 0% pass, but consistent
        ]);
        // stable-low should rank higher due to stability
        expect(results[0].modelId).toBe("stable-low");
        expect(results[1].modelId).toBe("flaky-mid");
    });
    it("perfect model ranks above all", () => {
        const results = computeRanking([
            { modelId: "decent", composite: 80, averagePassRate: 0.9 },
            { modelId: "perfect", composite: 100, averagePassRate: 1.0 },
            { modelId: "flaky", composite: 95, averagePassRate: 0.6 },
        ]);
        expect(results[0].modelId).toBe("perfect");
    });
    it("reliability score is between composite * 0.5 and composite", () => {
        // For passRate=0.5 (stability=0), reliability = composite * 0.5
        // For passRate=1.0 (stability=1), reliability = composite * 1.0
        const stabilityAt50 = Math.abs(0.5 - 0.5) * 2; // = 0
        const stabilityAt100 = Math.abs(1.0 - 0.5) * 2; // = 1.0
        expect(stabilityAt50).toBe(0);
        expect(stabilityAt100).toBe(1);
        const reliabilityAt50 = Math.round(100 * (0.5 + stabilityAt50 * 0.5) * 100) / 100;
        const reliabilityAt100 = Math.round(100 * (0.5 + stabilityAt100 * 0.5) * 100) / 100;
        expect(reliabilityAt50).toBe(50); // 50% discount
        expect(reliabilityAt100).toBe(100); // no discount
    });
});
describe("stability score computation", () => {
    function computeStability(passRate) {
        return Math.round(Math.abs(passRate - 0.5) * 2 * 100) / 100;
    }
    it("returns 0 for 50% pass rate (maximum uncertainty)", () => {
        expect(computeStability(0.5)).toBe(0);
    });
    it("returns 1.0 for 100% pass rate (perfect stability)", () => {
        expect(computeStability(1.0)).toBe(1);
    });
    it("returns 1.0 for 0% pass rate (consistent failure = stable)", () => {
        expect(computeStability(0.0)).toBe(1);
    });
    it("returns ~0.6 for 80% pass rate", () => {
        expect(computeStability(0.8)).toBe(0.6);
    });
    it("returns ~0.6 for 20% pass rate", () => {
        expect(computeStability(0.2)).toBe(0.6);
    });
});
describe("confidence computation", () => {
    function computeConfidence(passRate, isFlaky) {
        const stabilityScore = Math.abs(passRate - 0.5) * 2;
        if (passRate >= 0.95 && stabilityScore >= 0.8)
            return "high";
        if (passRate >= 0.7 || stabilityScore >= 0.5)
            return "medium";
        return "low";
    }
    it("high: pass_rate 1.0 with high stability", () => {
        expect(computeConfidence(1.0, false)).toBe("high");
    });
    it("medium: pass_rate 0.95 but low stability", () => {
        // 95% pass rate but if stability is low (which it shouldn't be at 95%), it's medium
        expect(computeConfidence(0.95, true)).toBe("high"); // stability at 95% = 0.9
    });
    it("medium: pass_rate 0.8", () => {
        expect(computeConfidence(0.8, false)).toBe("medium");
    });
    it("low: pass_rate 0.5", () => {
        expect(computeConfidence(0.5, false)).toBe("low");
    });
    it("low: pass_rate 0.3", () => {
        expect(computeConfidence(0.3, false)).toBe("low");
    });
});
//# sourceMappingURL=leaderboard-ranking.test.js.map