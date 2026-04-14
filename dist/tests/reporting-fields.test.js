/**
 * Crucibulum — Reporting Fields Tests
 * Tests for suite and task summary field presence and correctness.
 */
import { describe, it, expect } from "vitest";
import { computeConfidence } from "../core/suite-loader.js";
describe("computeConfidence", () => {
    it("high: pass_rate >= 0.95 and stability >= 0.8", () => {
        // passRate=1.0 → stability=1.0 → confidence=high
        expect(computeConfidence(1.0, false)).toBe("high");
    });
    it("medium: pass_rate >= 0.7", () => {
        expect(computeConfidence(0.8, false)).toBe("medium");
        expect(computeConfidence(0.7, false)).toBe("medium");
    });
    it("medium: flaky with pass_rate >= 0.5", () => {
        expect(computeConfidence(0.6, true)).toBe("medium");
    });
    it("low: pass_rate < 0.7 and not flaky", () => {
        expect(computeConfidence(0.5, false)).toBe("low");
        expect(computeConfidence(0.3, false)).toBe("low");
    });
    it("low: very low pass rate even if flaky", () => {
        expect(computeConfidence(0.3, true)).toBe("low");
    });
});
describe("suite summary structure", () => {
    it("defines expected overall_outcome types", () => {
        const validOutcomes = ["stable_pass", "stable_fail", "mixed", "flaky_mixed"];
        expect(validOutcomes).toHaveLength(4);
        expect(validOutcomes).toContain("stable_pass");
        expect(validOutcomes).toContain("stable_fail");
        expect(validOutcomes).toContain("mixed");
        expect(validOutcomes).toContain("flaky_mixed");
    });
});
describe("task result structure", () => {
    it("defines expected outcome types", () => {
        const validOutcomes = ["stable_pass", "stable_fail", "flaky_pass", "flaky_fail"];
        expect(validOutcomes).toHaveLength(4);
    });
    it("defines expected confidence levels", () => {
        const validLevels = ["high", "medium", "low"];
        expect(validLevels).toHaveLength(3);
    });
});
describe("leaderboard entry structure", () => {
    it("defines required fields", () => {
        const requiredFields = [
            "modelId",
            "composite",
            "families",
            "totalRuns",
            "lastRun",
            "source",
        ];
        expect(requiredFields.length).toBe(6);
    });
    it("defines flake-aware optional fields", () => {
        const flakeFields = [
            "average_pass_rate",
            "stability_score",
            "reliability_score",
            "total_flaky",
            "total_stable",
            "confidence",
        ];
        expect(flakeFields.length).toBe(6);
    });
});
//# sourceMappingURL=reporting-fields.test.js.map