/**
 * Luak — C3 regression: task-provided .crucibulum/setup.sh is NOT auto-executed.
 *
 * Auto-running setup.sh from an arbitrary task repo was a direct RCE vector
 * (untrusted shell as the service user, with read access to provider keys).
 * It must only run when the operator explicitly opts in via
 * LUAK_ALLOW_SETUP_EXEC=true. The script is still copied into the workspace.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cleanups: Array<() => void> = [];

afterEach(() => {
  delete process.env["LUAK_ALLOW_SETUP_EXEC"];
  while (cleanups.length) cleanups.pop()!();
});

function makeTaskRepoWithSetup(markerPath: string): string {
  const repo = mkdtempSync(join(tmpdir(), "c3-taskrepo-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  writeFileSync(join(repo, "README.md"), "task\n", "utf-8");
  mkdirSync(join(repo, ".crucibulum"), { recursive: true });
  const setup = join(repo, ".crucibulum", "setup.sh");
  // If this runs, it drops a sentinel file we can detect.
  writeFileSync(setup, `#!/bin/bash\ntouch "${markerPath}"\n`, "utf-8");
  chmodSync(setup, 0o755);
  return repo;
}

describe("workspace setup.sh execution gate (C3)", () => {
  it("does NOT execute setup.sh when LUAK_ALLOW_SETUP_EXEC is unset", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "c3-runs-"));
    cleanups.push(() => rmSync(runsDir, { recursive: true, force: true }));
    const marker = join(runsDir, "PWNED");
    const repo = makeTaskRepoWithSetup(marker);

    const prevRuns = process.env["CRUCIBULUM_RUNS_DIR"];
    process.env["CRUCIBULUM_RUNS_DIR"] = runsDir;
    delete process.env["LUAK_ALLOW_SETUP_EXEC"];
    cleanups.push(() => {
      if (prevRuns === undefined) delete process.env["CRUCIBULUM_RUNS_DIR"];
      else process.env["CRUCIBULUM_RUNS_DIR"] = prevRuns;
    });

    const { createWorkspace } = await import("../core/workspace.js");
    const ws = createWorkspace(repo, "c3-task");

    assert.equal(existsSync(marker), false, "setup.sh must NOT run when exec is not opted in");
    // But it must still have been copied into the workspace.
    assert.equal(existsSync(join(ws.path, ".crucibulum", "setup.sh")), true, "setup.sh should be copied into the workspace");
  });

  it("DOES execute setup.sh when LUAK_ALLOW_SETUP_EXEC=true", async () => {
    const runsDir = mkdtempSync(join(tmpdir(), "c3-runs-"));
    cleanups.push(() => rmSync(runsDir, { recursive: true, force: true }));
    const marker = join(runsDir, "ALLOWED");
    const repo = makeTaskRepoWithSetup(marker);

    const prevRuns = process.env["CRUCIBULUM_RUNS_DIR"];
    process.env["CRUCIBULUM_RUNS_DIR"] = runsDir;
    process.env["LUAK_ALLOW_SETUP_EXEC"] = "true";
    cleanups.push(() => {
      if (prevRuns === undefined) delete process.env["CRUCIBULUM_RUNS_DIR"];
      else process.env["CRUCIBULUM_RUNS_DIR"] = prevRuns;
    });

    const { createWorkspace } = await import("../core/workspace.js");
    createWorkspace(repo, "c3-task-opt-in");

    assert.equal(existsSync(marker), true, "setup.sh should run when explicitly opted in");
  });
});
