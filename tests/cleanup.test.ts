import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cleanupStaleArtifacts, getCleanupStats } from "../core/cleanup.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRunsDir(): string {
  return mkdtempSync(join(tmpdir(), "luak-cleanup-test-"));
}

function agePath(path: string, ageMs: number): void {
  const date = new Date(Date.now() - ageMs);
  utimesSync(path, date, date);
}

function writeArtifact(dir: string, name: string, ageMs: number): string {
  const path = join(dir, name);
  writeFileSync(path, "{}");
  agePath(path, ageMs);
  return path;
}

function writeWorkspace(dir: string, name: string, ageMs: number): string {
  const path = join(dir, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "file.txt"), "workspace");
  agePath(join(path, "file.txt"), ageMs);
  agePath(path, ageMs);
  return path;
}

describe("cleanupStaleArtifacts", () => {
  it("deletes old run artifacts and stale workspaces", () => {
    const tempRunsDir = makeRunsDir();
    try {
      const oldRun = writeArtifact(tempRunsDir, "run_old.json", 10 * DAY_MS);
      const oldWorkspace = writeWorkspace(tempRunsDir, "ws_old", 10 * DAY_MS);

      const result = cleanupStaleArtifacts({ runsDir: tempRunsDir, maxAgeMs: 7 * DAY_MS });

      assert.equal(result.scanned, 2);
      assert.equal(result.deleted, 2);
      assert.deepEqual(result.deleted_items.sort(), ["run_old.json", "ws_old"]);
      assert.equal(existsSync(oldRun), false);
      assert.equal(existsSync(oldWorkspace), false);
      assert.deepEqual(result.errors, []);
    } finally {
      rmSync(tempRunsDir, { recursive: true, force: true });
    }
  });

  it("preserves fresh artifacts and unrelated stale files", () => {
    const tempRunsDir = makeRunsDir();
    try {
      const freshRun = writeArtifact(tempRunsDir, "run_fresh.json", 1000);
      const freshWorkspace = writeWorkspace(tempRunsDir, "ws_fresh", 1000);
      const unrelated = writeArtifact(tempRunsDir, "notes.md", 10 * DAY_MS);

      const result = cleanupStaleArtifacts({ runsDir: tempRunsDir, maxAgeMs: 7 * DAY_MS });

      assert.equal(result.deleted, 0);
      assert.equal(existsSync(freshRun), true);
      assert.equal(existsSync(freshWorkspace), true);
      assert.equal(existsSync(unrelated), true);
      assert.deepEqual(
        result.skipped_items.map((item) => [item.name, item.reason]).sort(),
        [
          ["notes.md", "not a recognized artifact"],
          ["run_fresh.json", "not stale"],
          ["ws_fresh", "not stale"],
        ],
      );
    } finally {
      rmSync(tempRunsDir, { recursive: true, force: true });
    }
  });

  it("keeps stale workspaces when keepWorkspaces is enabled", () => {
    const tempRunsDir = makeRunsDir();
    try {
      const oldRun = writeArtifact(tempRunsDir, "run_old.json", 10 * DAY_MS);
      const oldWorkspace = writeWorkspace(tempRunsDir, "ws_old", 10 * DAY_MS);

      const result = cleanupStaleArtifacts({ runsDir: tempRunsDir, maxAgeMs: 7 * DAY_MS, keepWorkspaces: true });

      assert.equal(result.deleted, 1);
      assert.deepEqual(result.deleted_items, ["run_old.json"]);
      assert.equal(existsSync(oldRun), false);
      assert.equal(existsSync(oldWorkspace), true);
      assert.deepEqual(result.skipped_items, [{ name: "ws_old", reason: "workspace protected" }]);
    } finally {
      rmSync(tempRunsDir, { recursive: true, force: true });
    }
  });

  it("records permission errors without aborting the cleanup pass", { skip: process.platform === "win32" }, () => {
    const tempRunsDir = makeRunsDir();
    try {
      const oldRun = writeArtifact(tempRunsDir, "run_locked.json", 10 * DAY_MS);
      chmodSync(tempRunsDir, 0o555);

      const result = cleanupStaleArtifacts({ runsDir: tempRunsDir, maxAgeMs: 7 * DAY_MS });

      assert.equal(result.scanned, 1);
      assert.equal(result.deleted, 0);
      assert.equal(existsSync(oldRun), true);
      assert.equal(result.errors.length, 1);
      assert.match(result.errors[0]!, /Error processing run_locked\.json:/);
    } finally {
      chmodSync(tempRunsDir, 0o755);
      rmSync(tempRunsDir, { recursive: true, force: true });
    }
  });

  it("getCleanupStats is a dry-run wrapper over real cleanup classification", () => {
    const tempRunsDir = makeRunsDir();
    try {
      const oldRun = writeArtifact(tempRunsDir, "run_old.json", 10 * DAY_MS);

      const result = getCleanupStats({ runsDir: tempRunsDir, maxAgeMs: 7 * DAY_MS });

      assert.equal(result.deleted, 0);
      assert.equal(result.skipped, 1);
      assert.deepEqual(result.skipped_items, [{ name: "run_old.json", reason: "dry run" }]);
      assert.equal(existsSync(oldRun), true);
    } finally {
      rmSync(tempRunsDir, { recursive: true, force: true });
    }
  });
});
