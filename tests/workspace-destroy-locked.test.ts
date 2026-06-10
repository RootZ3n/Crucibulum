/**
 * Luak — destroyWorkspace permission recovery (Audit H3)
 *
 * Root cause of the 78 leaked ws_tool-006-fixture-audit_* dirs: tool-006's
 * setup.sh chmods a subdirectory non-writable so a delete fails; the same
 * non-writable subdir then defeated destroyWorkspace's rmSync, and the error
 * was swallowed. destroyWorkspace must now restore permissions and retry so a
 * locked tree can't leak forever.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { destroyWorkspace } from "../core/workspace.js";

describe("destroyWorkspace permission recovery (H3)", () => {
  it("removes a workspace whose subdirectory was chmod'd non-writable", () => {
    const ws = mkdtempSync(join(tmpdir(), "ws_h3-locked-"));
    const locked = join(ws, "locked-dir");
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, "file.txt"), "data");

    // Lock the subdir like tool-006's setup.sh does (read+execute, no write):
    // its entries can't be deleted until the dir is chmod'd writable again.
    chmodSync(locked, 0o500);

    try {
      destroyWorkspace(ws);
      assert.equal(existsSync(ws), false, "locked workspace must be fully removed");
    } finally {
      // Safety net if the assertion path leaves anything behind.
      try { chmodSync(locked, 0o700); } catch { /* already gone */ }
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("is a no-op (no throw) for an already-absent path", () => {
    const ghost = join(tmpdir(), "ws_h3-does-not-exist-zzz");
    assert.doesNotThrow(() => destroyWorkspace(ghost));
  });
});
