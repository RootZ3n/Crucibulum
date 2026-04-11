import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normalizeVerumIngest } from "../core/verum.js";

describe("verum ingest normalization", () => {
  it("maps adversarial results into canonical score rows with provenance", () => {
    const scores = normalizeVerumIngest({
      modelId: "openrouter::example/model",
      provider: "openrouter",
      adapter: "openrouter",
      runId: "verum-run-001",
      results: [
        {
          caseId: "attack-001",
          category: "instruction_override",
          attackClass: "jailbreak",
          passed: false,
          score: 0.42,
          duration_ms: 1800,
          timestamp: "2026-04-11T20:00:00.000Z",
          transcriptHash: "sha256:abc",
          rubricVersion: "2026-04-11"
        }
      ]
    });

    assert.equal(scores.length, 1);
    assert.equal(scores[0]?.family, "A");
    assert.equal(scores[0]?.score, 42);
    assert.equal(scores[0]?.rawScore, 42);
    assert.equal(scores[0]?.metadata?.["attack_class"], "jailbreak");
    assert.equal(scores[0]?.metadata?.["transcript_hash"], "sha256:abc");
    assert.equal(scores[0]?.metadata?.["source"], "verum");
  });
});
