/**
 * Luak — Logger File Transport Tests (Audit C1)
 *
 * Verifies that log() persists redacted JSON lines to disk (so a detached
 * server is no longer a blind operator) and that the file rotates at 10MB.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log, readRecentLogs, logFilePath } from "../utils/logger.js";

describe("logger file transport (C1)", () => {
  let tempDir: string;
  let logFile: string;
  let prevEnv: string | undefined;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "luak-log-test-"));
    logFile = join(tempDir, "server.log");
    prevEnv = process.env["LUAK_LOG_FILE"];
    process.env["LUAK_LOG_FILE"] = logFile;
  });

  after(() => {
    if (prevEnv === undefined) delete process.env["LUAK_LOG_FILE"];
    else process.env["LUAK_LOG_FILE"] = prevEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends JSON lines to the log file and reads them back", () => {
    log("info", "test-c1", "hello from the file transport", { run: "abc123" });
    assert.ok(existsSync(logFile), "log file must be created on first write");

    const content = readFileSync(logFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    const last = JSON.parse(lines[lines.length - 1]!);
    assert.equal(last.level, "info");
    assert.equal(last.component, "test-c1");
    assert.equal(last.message, "hello from the file transport");
    assert.ok(typeof last.ts === "string" && last.ts.length > 0, "entry must carry an ISO timestamp");
  });

  it("readRecentLogs returns parsed tail entries", () => {
    log("warn", "test-c1", "second entry");
    const recent = readRecentLogs(10);
    assert.ok(recent.length >= 2, "should read back at least the two entries written");
    const messages = recent.map((e) => e["message"]);
    assert.ok(messages.includes("second entry"));
  });

  it("rotates the log file at 10MB", () => {
    // Pre-fill the active file with >10MB so the next log() call rotates it
    // (rotation is checked before each append). Writing the bulk directly
    // keeps the test fast while still exercising the >10MB threshold.
    const elevenMB = "x".repeat(11 * 1024 * 1024);
    writeFileSync(logFile, elevenMB);

    log("info", "test-c1", "post-rotation entry");

    assert.ok(existsSync(`${logFile}.1`), "rotated file server.log.1 must exist after crossing 10MB");
    const fresh = readFileSync(logFile, "utf-8");
    assert.ok(fresh.length < 1024 * 1024, "active log should be fresh (small) after rotation");
    assert.ok(fresh.includes("post-rotation entry"), "new entry lands in the fresh active log");
  });

  it("logFilePath honors the LUAK_LOG_FILE override", () => {
    assert.equal(logFilePath(), logFile);
  });
});
