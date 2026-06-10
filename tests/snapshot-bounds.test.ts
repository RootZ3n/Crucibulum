/**
 * Luak — H8 regression: workspace snapshots are bounded and don't follow
 * symlinks.
 *
 * getGitDiff falls back to a baseline/current file snapshot when the workspace
 * isn't a git repo. That snapshot must (a) never read through a symlink — a
 * link to /etc/passwd or to a dir outside the workspace must not be disclosed —
 * and (b) cap per-file size so one huge file can't OOM the host.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitDiff } from "../utils/diff.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

// A workspace with a baseline file present but no .git → getGitDiff uses the
// snapshot path (getSnapshotDiff → snapshotFiles).
function snapshotWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), "h8-ws-"));
  cleanups.push(() => rmSync(ws, { recursive: true, force: true }));
  // Empty baseline so every current file shows as "created" in the diff.
  writeFileSync(join(ws, ".crucibulum-baseline.json"), JSON.stringify({}), "utf-8");
  return ws;
}

describe("workspace snapshot bounds (H8)", () => {
  it("does not read through a symlink to an out-of-workspace secret", () => {
    const secret = mkdtempSync(join(tmpdir(), "h8-secret-"));
    cleanups.push(() => rmSync(secret, { recursive: true, force: true }));
    const secretFile = join(secret, "passwd");
    writeFileSync(secretFile, "ROOT:x:0:0", "utf-8");

    const ws = snapshotWorkspace();
    writeFileSync(join(ws, "normal.txt"), "hello", "utf-8");
    symlinkSync(secretFile, join(ws, "leak.txt"));      // file symlink
    symlinkSync(secret, join(ws, "leakdir"));            // dir symlink

    const diff = getGitDiff(ws);
    const created = new Set(diff.files_created);
    assert.ok(created.has("normal.txt"), "normal file should be captured");
    assert.ok(!created.has("leak.txt"), "symlinked file must NOT be followed");
    assert.ok(!created.has("leakdir/passwd"), "symlinked dir must NOT be recursed");
    // And the secret content must not appear in any captured patch.
    const allPatches = diff.files_changed.map((f) => f.patch).join("\n");
    assert.ok(!allPatches.includes("ROOT:x:0:0"), "secret content must not be disclosed");
  });

  it("skips an oversized file (>1MB) instead of reading it into memory", () => {
    const ws = snapshotWorkspace();
    writeFileSync(join(ws, "small.txt"), "ok", "utf-8");
    writeFileSync(join(ws, "huge.bin"), Buffer.alloc(2 * 1024 * 1024, 0x41), "utf-8"); // 2MB

    const diff = getGitDiff(ws);
    const created = new Set(diff.files_created);
    assert.ok(created.has("small.txt"), "small file captured");
    assert.ok(!created.has("huge.bin"), "oversized file must be skipped");
  });
});
