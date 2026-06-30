/**
 * Luak — TTL reaper visibility tests (Audit C2)
 *
 * 78 stale workspaces survived a 3.6-day uptime under an hourly reaper that
 * left no trace it had run. These tests pin the new guarantees: the reaper
 * actually deletes backdated ws_* dirs, records a verifiable status
 * (getReaperStatus / GET /api/health/reaper), and touches state/.reaper-last-run
 * every cycle — including no-op cycles, so silence is never ambiguous.
 */

import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, utimesSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reapStaleWorkspaces, getReaperStatus } from "../core/cleanup.js";
import { handleReaperHealth } from "../server/routes/health.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function freshDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe("TTL reaper visibility (C2)", () => {
  it("deletes backdated ws_* dirs and records checked/deleted/kept", () => {
    const runsDir = freshDir("c2-runs-");
    const stateDir = freshDir("c2-state-");

    // Two stale (10-day-old) workspaces, one fresh, plus a bundle to protect.
    mkdirSync(join(runsDir, "ws_tool-006-fixture-audit_a"), { recursive: true });
    mkdirSync(join(runsDir, "ws_tool-006-fixture-audit_b"), { recursive: true });
    mkdirSync(join(runsDir, "ws_fresh"), { recursive: true });
    writeFileSync(join(runsDir, "run_evidence.json"), "{}", "utf-8");

    const tenDaysAgo = Date.now() / 1000 - 10 * 24 * 3600;
    utimesSync(join(runsDir, "ws_tool-006-fixture-audit_a"), tenDaysAgo, tenDaysAgo);
    utimesSync(join(runsDir, "ws_tool-006-fixture-audit_b"), tenDaysAgo, tenDaysAgo);

    const res = reapStaleWorkspaces({ maxAgeMs: 60 * 60 * 1000, runsDir, stateDir });
    assert.equal(res.checked, 3, "three ws_* dirs examined");
    assert.equal(res.deleted, 2, "two stale workspaces reaped");
    assert.equal(res.kept, 1, "one fresh workspace kept");
    assert.equal(existsSync(join(runsDir, "ws_tool-006-fixture-audit_a")), false);
    assert.equal(existsSync(join(runsDir, "ws_tool-006-fixture-audit_b")), false);
    assert.equal(existsSync(join(runsDir, "ws_fresh")), true);
    assert.equal(existsSync(join(runsDir, "run_evidence.json")), true, "bundle untouched");
  });

  it("touches state/.reaper-last-run every cycle, including no-op cycles", () => {
    const runsDir = freshDir("c2-runs-noop-");
    const stateDir = freshDir("c2-state-noop-");

    // No ws_* dirs at all — a no-op cycle must still leave a heartbeat.
    reapStaleWorkspaces({ runsDir, stateDir });
    const heartbeat = join(stateDir, ".reaper-last-run");
    assert.ok(existsSync(heartbeat), "heartbeat file written on a no-op cycle");
    assert.ok(readFileSync(heartbeat, "utf-8").trim().length > 0, "heartbeat carries a timestamp");
  });

  it("getReaperStatus reflects the most recent cycle", () => {
    const runsDir = freshDir("c2-runs-status-");
    const stateDir = freshDir("c2-state-status-");
    mkdirSync(join(runsDir, "ws_old"), { recursive: true });
    const old = Date.now() / 1000 - 7200;
    utimesSync(join(runsDir, "ws_old"), old, old);

    reapStaleWorkspaces({ maxAgeMs: 60 * 60 * 1000, runsDir, stateDir });
    const status = getReaperStatus();
    assert.ok(typeof status.lastRun === "number" && status.lastRun > 0, "lastRun populated");
    assert.equal(status.lastDeleted, 1);
    assert.equal(status.lastChecked, 1);
  });

  it("GET /api/health/reaper returns the last-run snapshot", async () => {
    const runsDir = freshDir("c2-runs-http-");
    const stateDir = freshDir("c2-state-http-");
    reapStaleWorkspaces({ runsDir, stateDir });

    let statusCode = 0;
    let payload: Record<string, unknown> = {};
    const res = {
      writeHead(code: number) { statusCode = code; return this; },
      end(body?: string) { if (body) payload = JSON.parse(body); },
      setHeader() { /* noop */ },
    } as unknown as import("node:http").ServerResponse;

    await handleReaperHealth({} as import("node:http").IncomingMessage, res);
    assert.equal(statusCode, 200);
    assert.ok("lastRun" in payload, "payload exposes lastRun");
    assert.ok("lastChecked" in payload, "payload exposes lastChecked");
    assert.ok("lastDeleted" in payload, "payload exposes lastDeleted");
    assert.ok("lastRunIso" in payload, "payload exposes ISO timestamp");
  });

  it("records an error when a stale workspace contains an undeletable locked subdir", (t) => {
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      t.skip("chmod permission-denial semantics are bypassed for uid 0");
      return;
    }

    const runsDir = freshDir("c2-runs-locked-");
    const stateDir = freshDir("c2-state-locked-");
    const ws = join(runsDir, "ws_locked");
    const locked = join(ws, "locked");
    mkdirSync(locked, { recursive: true });
    writeFileSync(join(locked, "child.txt"), "cannot remove while parent is locked", "utf-8");

    const old = Date.now() / 1000 - 7200;
    utimesSync(locked, old, old);
    utimesSync(ws, old, old);
    chmodSync(locked, 0o000);
    cleanups.push(() => { try { chmodSync(locked, 0o700); } catch { /* ignore */ } });

    const res = reapStaleWorkspaces({ maxAgeMs: 60 * 60 * 1000, runsDir, stateDir });
    assert.equal(res.checked, 1);
    assert.equal(res.deleted, 0);
    assert.equal(res.errors.length, 1, "locked workspace deletion failure should be reported");
    assert.match(res.errors[0]!, /ws_locked|EACCES|EPERM|permission/i);
    assert.equal(existsSync(ws), true, "failed delete leaves workspace for a later retry/manual inspection");

    const status = getReaperStatus();
    assert.equal(status.lastChecked, 1);
    assert.equal(status.lastDeleted, 0);
    assert.equal(status.lastErrors.length, 1);
  });

  it("handles a workspace created concurrently while the reaper is running", () => {
    const runsDir = freshDir("c2-runs-concurrent-");
    const stateDir = freshDir("c2-state-concurrent-");

    mkdirSync(join(runsDir, "ws_old"), { recursive: true });
    const old = Date.now() / 1000 - 7200;
    utimesSync(join(runsDir, "ws_old"), old, old);

    const first = reapStaleWorkspaces({ maxAgeMs: 60 * 60 * 1000, runsDir, stateDir });
    mkdirSync(join(runsDir, "ws_created_during_cycle"), { recursive: true });
    const second = reapStaleWorkspaces({ maxAgeMs: 60 * 60 * 1000, runsDir, stateDir });

    assert.equal(first.deleted, 1);
    assert.equal(first.errors.length, 0);
    assert.equal(second.checked, 1, "new workspace is observed on the next cycle");
    assert.equal(second.kept, 1, "fresh concurrent workspace must not be reaped");
    assert.equal(second.deleted, 0);
    assert.equal(existsSync(join(runsDir, "ws_created_during_cycle")), true);
  });
});
