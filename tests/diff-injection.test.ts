/**
 * Luak — C4 regression: model-controlled filenames cannot inject shell
 * commands into the git-diff collection path.
 *
 * The diff is computed over files the model-under-test created. A filename
 * like `$(touch INJECTED)` must be passed to git literally, never expanded by
 * a shell.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getGitDiff } from "../utils/diff.js";

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });

function gitInitRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "c4-diff-"));
  cleanups.push(() => rmSync(repo, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@local", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@local" };
  execFileSync("git", ["init"], { cwd: repo, stdio: "pipe" });
  writeFileSync(join(repo, "README.md"), "base\n", "utf-8");
  execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repo, stdio: "pipe", env });
  return repo;
}

describe("git diff command injection (C4)", () => {
  it("treats a $(...) filename literally and never executes it", () => {
    const repo = gitInitRepo();
    // The injected command runs with cwd=repo, so a successful injection drops
    // the marker at repo/INJECTED. Filenames can't contain "/", so keep the
    // payload's target relative.
    const marker = join(repo, "INJECTED");
    // A file whose NAME is a shell substitution. On a vulnerable
    // `git diff HEAD -- "${filePath}"` this would run `touch INJECTED`.
    const evilName = "$(touch INJECTED).txt";
    writeFileSync(join(repo, evilName), "payload\n", "utf-8");
    // Stage it so it appears in `git diff --name-status HEAD` and reaches the
    // per-file `git diff HEAD -- <name>` call — the actual injection point.
    execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "pipe" });

    const diff = getGitDiff(repo);

    assert.equal(existsSync(marker), false, "injected command must NOT have executed");
    // The file is still reported as created, by its literal name.
    assert.ok(diff.files_created.includes(evilName), `expected ${evilName} reported as created, got ${JSON.stringify(diff.files_created)}`);
  });

  it("handles backtick filenames literally too", () => {
    const repo = gitInitRepo();
    const marker = join(repo, "BACKTICK_PWNED");
    const evilName = "`touch BACKTICK_PWNED`.txt";
    writeFileSync(join(repo, evilName), "payload\n", "utf-8");
    // Stage it so it appears in `git diff --name-status HEAD` and reaches the
    // per-file `git diff HEAD -- <name>` call — the actual injection point.
    execFileSync("git", ["add", "-A"], { cwd: repo, stdio: "pipe" });

    const diff = getGitDiff(repo);

    assert.equal(existsSync(marker), false, "backtick injection must NOT have executed");
    assert.ok(diff.files_created.includes(evilName));
  });
});
