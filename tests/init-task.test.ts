import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { initTaskCommand } from "../cli/commands/init-task.js";
import { loadManifestRaw, resolveRepoPath } from "../core/manifest.js";
import { scanOracleHashes } from "../core/oracle-hash-util.js";

describe("init-task command", () => {
  it("scaffolds a loader-valid task with fixtures and task-local oracle", async () => {
    const previousCwd = process.cwd();
    const root = mkdtempSync(join(tmpdir(), "luak-init-task-"));

    try {
      process.chdir(root);
      await initTaskCommand(["quality", "quality-001", "--yes"]);

      const taskDir = join(root, "tasks", "quality", "quality-001");
      const manifestPath = join(taskDir, "manifest.json");
      const fixturesDir = join(taskDir, "fixtures");
      const oraclePath = join(taskDir, "oracle", "quality-001.oracle.json");

      assert.equal(existsSync(manifestPath), true);
      assert.equal(existsSync(fixturesDir), true);
      assert.equal(existsSync(oraclePath), true);

      const manifest = loadManifestRaw("quality-001");
      assert.equal(manifest.id, "quality-001");
      assert.equal(manifest.family, "quality");
      assert.equal(manifest.metadata.benchmark_provenance.public_status, "private");
      assert.equal(manifest.metadata.benchmark_provenance.oracle_visibility, "hidden");
      assert.equal(manifest.oracle_ref.hash, "sha256:placeholder");
      assert.equal(resolveRepoPath(manifest), fixturesDir);

      const result = scanOracleHashes({ write: true });
      assert.equal(result.scanned, 1);
      assert.equal(result.updated, 1);
      assert.equal(result.issues.length, 0);

      const updatedManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
      assert.match(updatedManifest.oracle_ref.hash, /^sha256:[0-9a-f]{64}$/);
    } finally {
      process.chdir(previousCwd);
    }
  });
});
