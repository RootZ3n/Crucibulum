import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TaskManifest } from "../adapters/base.js";
import { hashOracleBytes, loadOracleWithIntegrity } from "../core/oracle.js";
import { scanOracleHashes } from "../core/oracle-hash-util.js";

function oracleRaw(taskId: string): string {
  return JSON.stringify({
    task_id: taskId,
    version: "1.0.0",
    hash: "sha256:ignored",
    ground_truth: {
      bug_location: "src/index.js",
      bug_line_range: [1, 2],
      bug_description: "bug",
      correct_fix_pattern: "fix",
    },
    checks: {
      correctness: [],
      regression: [],
      integrity: [],
      anti_cheat: { forbidden_code_patterns: [], forbidden_comment_patterns: [], suspicious_behaviors: [] },
      decoys: [],
    },
  }, null, 2) + "\n";
}

function manifest(taskId: string, oraclePath: string, hash: string | undefined): TaskManifest {
  return {
    id: taskId,
    version: "1.0.0",
    family: "spec_discipline",
    difficulty: "easy",
    repo: { source: "local", path: ".", commit: "abc", setup_script: null, reset_script: null },
    task: { title: "t", description: "d", entrypoints: [], hints_allowed: false },
    constraints: { time_limit_sec: 1, max_steps: 1, max_file_edits: 0, max_files_read: 0, allowed_tools: [], forbidden_paths: [], network_allowed: false },
    verification: { public_tests_command: null, build_command: null, runtime_command: null, lint_command: null },
    scoring: { weights: { correctness: 1, regression: 0, integrity: 0, efficiency: 0 }, pass_threshold: 1 },
    oracle_ref: { type: "local", path: oraclePath, ...(hash === undefined ? {} : { hash }) },
    metadata: { author: "test", created: "2026-04-26", tags: [], diagnostic_purpose: "test" },
    seed: 1,
  };
}

function writeManifest(root: string, taskId: string, oraclePath: string, hash: string): void {
  const dir = join(root, "spec", taskId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest(taskId, oraclePath, hash), null, 2) + "\n", "utf-8");
}

describe("oracle integrity verification", () => {
  it("valid oracle hash passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-ok-"));
    const path = join(dir, "task.oracle.json");
    const raw = oracleRaw("task-ok");
    writeFileSync(path, raw, "utf-8");
    const loaded = loadOracleWithIntegrity(manifest("task-ok", path, hashOracleBytes(raw)));
    assert.equal(loaded.oracle.task_id, "task-ok");
    assert.equal(loaded.integrity.oracle_hash_status, "valid");
    assert.equal(loaded.integrity.oracle_hash_verified, true);
  });

  it("mismatched oracle hash throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-mismatch-"));
    const path = join(dir, "task.oracle.json");
    writeFileSync(path, oracleRaw("task-mismatch"), "utf-8");
    assert.throws(() => loadOracleWithIntegrity(manifest("task-mismatch", path, `sha256:${"0".repeat(64)}`)), /mismatch/);
  });

  it("missing oracle file throws", () => {
    const path = join(mkdtempSync(join(tmpdir(), "oracle-missing-")), "missing.oracle.json");
    assert.throws(() => loadOracleWithIntegrity(manifest("task-missing", path, `sha256:${"0".repeat(64)}`)), /missing/);
  });

  it("malformed oracle hash throws", () => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-malformed-"));
    const path = join(dir, "task.oracle.json");
    writeFileSync(path, oracleRaw("task-malformed"), "utf-8");
    assert.throws(() => loadOracleWithIntegrity(manifest("task-malformed", path, "sha256:not-a-real-hash")), /malformed/);
  });

  it("placeholder hash is rejected for release tasks", () => {
    const dir = mkdtempSync(join(tmpdir(), "oracle-placeholder-"));
    const path = join(dir, "task.oracle.json");
    writeFileSync(path, oracleRaw("task-placeholder"), "utf-8");
    assert.throws(() => loadOracleWithIntegrity(manifest("task-placeholder", path, "sha256:placeholder")), /placeholder/);
  });

  it("hash utility check detects placeholders and mismatches", () => {
    const root = mkdtempSync(join(tmpdir(), "oracle-scan-"));
    const oracleDir = mkdtempSync(join(tmpdir(), "oracle-files-"));
    const goodPath = join(oracleDir, "good.oracle.json");
    const badPath = join(oracleDir, "bad.oracle.json");
    const placeholderPath = join(oracleDir, "placeholder.oracle.json");
    const goodRaw = oracleRaw("good");
    writeFileSync(goodPath, goodRaw, "utf-8");
    writeFileSync(badPath, oracleRaw("bad"), "utf-8");
    writeFileSync(placeholderPath, oracleRaw("placeholder"), "utf-8");
    writeManifest(root, "good", goodPath, hashOracleBytes(goodRaw));
    writeManifest(root, "bad", badPath, `sha256:${"0".repeat(64)}`);
    writeManifest(root, "placeholder", placeholderPath, "sha256:placeholder");

    const result = scanOracleHashes({ root });
    assert.equal(result.scanned, 3);
    assert.equal(result.valid, 1);
    assert.deepEqual(result.issues.map((issue) => issue.status).sort(), ["mismatch", "placeholder"]);
  });

  it("hash utility write updates placeholder hashes", () => {
    const root = mkdtempSync(join(tmpdir(), "oracle-write-"));
    const oracleDir = mkdtempSync(join(tmpdir(), "oracle-files-"));
    const path = join(oracleDir, "write.oracle.json");
    const raw = oracleRaw("write");
    writeFileSync(path, raw, "utf-8");
    writeManifest(root, "write", path, "sha256:placeholder");

    const result = scanOracleHashes({ root, write: true });
    assert.equal(result.updated, 1);
    assert.equal(result.issues.length, 0);
    assert.equal(scanOracleHashes({ root }).issues.length, 0);
  });
});

