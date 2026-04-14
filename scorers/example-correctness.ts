/**
 * Example custom scorer — correctness checker.
 * Place custom scorers in the /scorers/ directory.
 * Each must export default a ScorerPlugin.
 */
import type { ScorerPlugin, ScorerInput, ScorerOutput } from "../core/scorer-registry.js";

const plugin: ScorerPlugin = {
  id: "custom/correctness",
  name: "Correctness Scorer",
  version: "1.0.0",
  taskFamilies: ["*"],

  score(input: ScorerInput): ScorerOutput {
    const expected = input.oracleData["expected_output"] as string | undefined;
    if (!expected) {
      return {
        score: 0,
        passed: false,
        breakdown: { correctness: 0 },
        explanation: "No expected output in oracle data — cannot score correctness",
      };
    }

    const response = input.modelResponse.toLowerCase().trim();
    const expectedLower = expected.toLowerCase().trim();

    // Exact match
    if (response === expectedLower) {
      return {
        score: 1.0,
        passed: true,
        breakdown: { correctness: 1.0 },
        explanation: "Exact match with expected output",
      };
    }

    // Contains match
    if (response.includes(expectedLower)) {
      return {
        score: 0.8,
        passed: true,
        breakdown: { correctness: 0.8 },
        explanation: "Expected output found within model response",
      };
    }

    // Keyword overlap
    const expectedWords = new Set(expectedLower.split(/\s+/).filter(w => w.length > 3));
    const responseWords = new Set(response.split(/\s+/));
    const overlap = [...expectedWords].filter(w => responseWords.has(w)).length;
    const keywordScore = expectedWords.size > 0 ? overlap / expectedWords.size : 0;

    return {
      score: Math.round(keywordScore * 100) / 100,
      passed: keywordScore >= 0.5,
      breakdown: { correctness: keywordScore },
      explanation: `Keyword overlap: ${overlap}/${expectedWords.size} (${Math.round(keywordScore * 100)}%)`,
    };
  },
};

export default plugin;
