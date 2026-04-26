import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { validateFixtureCorpus, listManifestPaths, listOraclePaths } from "../core/fixture-validation.js";
import { scanOracleHashes } from "../core/oracle-hash-util.js";

describe("fixture corpus validation", () => {
  it("discovers task manifests and oracle files", () => {
    const manifests = listManifestPaths();
    const oracles = listOraclePaths();

    assert.ok(manifests.length >= 30, `expected full manifest corpus, got ${manifests.length}`);
    assert.ok(oracles.length >= 15, `expected oracle corpus, got ${oracles.length}`);
  });

  it("has no manifest, oracle, or corpus consistency issues", () => {
    const issues = validateFixtureCorpus();
    assert.deepEqual(issues, []);
  });

  it("has real, matching oracle hashes for every release task", () => {
    const result = scanOracleHashes();
    assert.equal(result.issues.length, 0, JSON.stringify(result.issues, null, 2));
    assert.ok(result.scanned > 0);
    assert.equal(result.valid, result.scanned);
  });
});
