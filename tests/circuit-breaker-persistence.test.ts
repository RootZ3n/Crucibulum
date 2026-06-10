/**
 * Luak — Circuit breaker persistence (Audit C3)
 *
 * Circuit state used to be module-level only: a restart reset every circuit to
 * CLOSED, re-thrashing a provider that was mid-cooldown and escalating a
 * transient rate-limit into a ban. State now persists to
 * state/circuit-breaker.json and reloads on startup, with the cooldown keyed to
 * the absolute openedAt timestamp so elapsed real time is honored across
 * restarts.
 *
 * The suite-wide runner sets LUAK_DISABLE_CIRCUIT_PERSIST=1 to keep parallel
 * test files from contaminating each other through the shared state dir. This
 * file deliberately re-enables persistence against its OWN temp file (safe:
 * node --test isolates each file in its own process).
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  circuitFailure,
  circuitAllow,
  getCircuitState,
  clearAll,
  initCircuitBreaker,
} from "../core/circuit-breaker.js";

describe("circuit breaker persistence (C3)", () => {
  let tempDir: string;
  let stateFile: string;
  let savedDisable: string | undefined;
  let savedFile: string | undefined;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "luak-cb-persist-"));
    stateFile = join(tempDir, "circuit-breaker.json");
    savedDisable = process.env["LUAK_DISABLE_CIRCUIT_PERSIST"];
    savedFile = process.env["LUAK_CIRCUIT_STATE_FILE"];
    // Re-enable persistence (suite runner disables it globally) and point it at
    // our isolated temp file.
    delete process.env["LUAK_DISABLE_CIRCUIT_PERSIST"];
    process.env["LUAK_CIRCUIT_STATE_FILE"] = stateFile;
  });

  after(() => {
    if (savedDisable === undefined) delete process.env["LUAK_DISABLE_CIRCUIT_PERSIST"];
    else process.env["LUAK_DISABLE_CIRCUIT_PERSIST"] = savedDisable;
    if (savedFile === undefined) delete process.env["LUAK_CIRCUIT_STATE_FILE"];
    else process.env["LUAK_CIRCUIT_STATE_FILE"] = savedFile;
    clearAll();
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Start every test from a clean slate AND a clean file.
    rmSync(stateFile, { force: true });
    clearAll();
  });

  it("persists an opened circuit to disk", () => {
    const cfg = { failureThreshold: 5, cooldownMs: 30_000, successThreshold: 3 };
    for (let i = 0; i < 5; i += 1) circuitFailure("openrouter", cfg);
    assert.equal(getCircuitState("openrouter").state, "open");

    assert.ok(existsSync(stateFile), "circuit state file must be written on transition");
    const persisted = JSON.parse(readFileSync(stateFile, "utf-8"));
    assert.equal(persisted.openrouter.state, "open");
    assert.equal(persisted.openrouter.failureCount, 5);
    assert.ok(typeof persisted.openrouter.openedAt === "number", "openedAt persisted as a timestamp");
    assert.ok(typeof persisted.openrouter.lastFailureAt === "number", "lastFailureAt persisted");
  });

  it("a new breaker instance from the same file sees the circuit still OPEN with cooldown remaining", () => {
    const cfg = { failureThreshold: 5, cooldownMs: 30_000, successThreshold: 3 };
    for (let i = 0; i < 5; i += 1) circuitFailure("openrouter", cfg);
    assert.equal(getCircuitState("openrouter").state, "open");
    const openedAt = JSON.parse(readFileSync(stateFile, "utf-8")).openrouter.openedAt as number;

    // Simulate a restart: drop in-memory state, reload from the same file.
    clearAll();
    initCircuitBreaker();

    const reloaded = getCircuitState("openrouter");
    assert.equal(reloaded.state, "open", "circuit must survive the restart as OPEN");

    // Cooldown is keyed to the original openedAt, so a request is still blocked
    // immediately after restart (well within the 30s window).
    assert.equal(circuitAllow("openrouter", cfg), false, "still cooling down after restart — request blocked");

    // And the remaining cooldown is computed from the original open time.
    const elapsed = Date.now() - openedAt;
    assert.ok(elapsed < cfg.cooldownMs, "test runs well within the cooldown window");
  });

  it("after the cooldown elapses, a restarted circuit transitions OPEN → HALF-OPEN", () => {
    const cfg = { failureThreshold: 5, cooldownMs: 30_000, successThreshold: 3 };
    for (let i = 0; i < 5; i += 1) circuitFailure("zai", cfg);
    assert.equal(getCircuitState("zai").state, "open");

    // Simulate a crash that happened well past the cooldown: backdate openedAt
    // on disk so the reloaded circuit's cooldown is already expired. This pins
    // the across-restart, absolute-timestamp cooldown behavior deterministically
    // (no sleep / no sub-ms timing race).
    const persisted = JSON.parse(readFileSync(stateFile, "utf-8"));
    persisted.zai.openedAt = Date.now() - 60_000; // 60s ago, past the 30s cooldown
    writeFileSync(stateFile, JSON.stringify(persisted));

    clearAll();
    initCircuitBreaker();

    assert.equal(circuitAllow("zai", cfg), true, "expired cooldown lets a probe through");
    assert.equal(getCircuitState("zai").state, "half-open");
  });
});
