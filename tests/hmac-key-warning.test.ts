/**
 * Luak — HMAC key startup-warning test (Audit C4)
 *
 * The server can be started directly (bypassing start.sh's key
 * auto-generation), leaving LUAK_HMAC_KEY unset and bundle signing inert.
 * warnIfHmacKeyMissing() must shout about it at startup. We assert both the
 * returned status AND that the warning actually lands in the persisted log
 * (the C1 file transport), since a detached operator only ever sees the file.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { warnIfHmacKeyMissing } from "../server/app.js";
import { readRecentLogs } from "../utils/logger.js";

describe("HMAC key startup warning (C4)", () => {
  let tempDir: string;
  let logFile: string;
  let savedLuak: string | undefined;
  let savedCrucible: string | undefined;
  let savedLogFile: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "luak-hmac-warn-"));
    logFile = join(tempDir, "server.log");
    savedLuak = process.env["LUAK_HMAC_KEY"];
    savedCrucible = process.env["CRUCIBLE_HMAC_KEY"];
    savedLogFile = process.env["LUAK_LOG_FILE"];
    process.env["LUAK_LOG_FILE"] = logFile;
  });

  afterEach(() => {
    if (savedLuak === undefined) delete process.env["LUAK_HMAC_KEY"];
    else process.env["LUAK_HMAC_KEY"] = savedLuak;
    if (savedCrucible === undefined) delete process.env["CRUCIBLE_HMAC_KEY"];
    else process.env["CRUCIBLE_HMAC_KEY"] = savedCrucible;
    if (savedLogFile === undefined) delete process.env["LUAK_LOG_FILE"];
    else process.env["LUAK_LOG_FILE"] = savedLogFile;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("logs a warning when no HMAC key is configured", () => {
    delete process.env["LUAK_HMAC_KEY"];
    delete process.env["CRUCIBLE_HMAC_KEY"];

    const status = warnIfHmacKeyMissing();
    assert.equal(status, "missing");

    const content = readFileSync(logFile, "utf-8");
    assert.ok(
      content.includes("No HMAC key configured"),
      "missing-key startup warning must be persisted to the log file",
    );
    const warned = readRecentLogs(20).some(
      (e) => e["component"] === "hmac" && String(e["message"]).includes("No HMAC key configured"),
    );
    assert.ok(warned, "warning must be a structured hmac-component log entry");
  });

  it("does not warn when LUAK_HMAC_KEY is set", () => {
    process.env["LUAK_HMAC_KEY"] = "operational-test-key";
    delete process.env["CRUCIBLE_HMAC_KEY"];

    const status = warnIfHmacKeyMissing();
    assert.equal(status, "ok");

    const warned = readRecentLogs(20).some(
      (e) => e["component"] === "hmac" && String(e["message"]).includes("No HMAC key configured"),
    );
    assert.ok(!warned, "no missing-key warning should be emitted when the key is present");
  });

  it("flags the deprecated CRUCIBLE_HMAC_KEY alias", () => {
    delete process.env["LUAK_HMAC_KEY"];
    process.env["CRUCIBLE_HMAC_KEY"] = "legacy-key";
    assert.equal(warnIfHmacKeyMissing(), "legacy-alias");
  });
});
