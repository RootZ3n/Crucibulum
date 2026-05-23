import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { validateFixtureCorpus, listManifestPaths, listOraclePaths } from "../core/fixture-validation.js";
import { scanOracleHashes } from "../core/oracle-hash-util.js";
import { createWorkspace, destroyWorkspace } from "../core/workspace.js";

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

  it("tool-006 is declared as a no-edit tool task", () => {
    const manifest = JSON.parse(readFileSync("tasks/tool-calling/tool-006/manifest.json", "utf-8"));
    assert.equal(manifest.constraints.max_file_edits, 0);
  });

  it("tool-006 workspace makes locked.txt deletion fail before model execution", () => {
    const workspace = createWorkspace("tasks/tool-calling/tool-006/repo", "tool-006-fixture-audit");
    try {
      assert.throws(
        () => execFileSync("rm", ["tool-trial/locked.txt"], { cwd: workspace.path, stdio: "pipe" }),
        /./,
      );
      execFileSync("test", ["-f", join(workspace.path, "tool-trial/locked.txt")]);
    } finally {
      destroyWorkspace(workspace.path);
    }
  });
});
