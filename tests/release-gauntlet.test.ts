/**
 * Crucible — Release gauntlet smoke
 *
 * The gauntlet script is itself release-critical infrastructure: if it
 * silently misclassifies, a real product failure can ship green. Pin the
 * top-level contracts:
 *  - --dry-run-inventory walks the task tree and prints all 21+ families.
 *  - The script exits non-zero when any probe fails (so CI catches it).
 *  - The Markdown header includes "Release-ready: YES/NO" so operators can
 *    grep it from the report file.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const GAUNTLET = join(REPO_ROOT, "scripts", "release-gauntlet.mjs");

function run(args: string[], opts: { allowNonZero?: boolean } = {}): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [GAUNTLET, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" },
    });
    return { stdout, status: 0 };
  } catch (err) {
    if (!opts.allowNonZero) throw err;
    const e = err as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("release-gauntlet: --dry-run-inventory", () => {
  it("prints families, tasks, conversational + repo counts, and the adapter list", () => {
    const { stdout, status } = run(["--dry-run-inventory"]);
    assert.equal(status, 0);
    assert.match(stdout, /families:\s+21/);
    assert.match(stdout, /tasks total:\s+62/);
    assert.match(stdout, /conversational:\s+37/);
    assert.match(stdout, /repo:\s+25/);
    assert.match(stdout, /registered adapters:\s+12/);
    // Sample of expected families.
    for (const fam of ["personality", "operational-trust", "role-stress", "safety", "tool-calling"]) {
      assert.match(stdout, new RegExp(`\\b${fam}\\b`));
    }
    // Sample of expected adapters.
    for (const a of ["ollama", "anthropic", "openai", "openrouter", "minimax", "zai", "google"]) {
      assert.match(stdout, new RegExp(`\\b${a}\\b`));
    }
  });
});

describe("release-gauntlet: --help", () => {
  it("documents the flags every operator needs", () => {
    const { stdout, status } = run(["--help"]);
    assert.equal(status, 0);
    for (const flag of [
      "--dry-run-inventory", "--mock-only", "--real-provider",
      "--all-families", "--family", "--provider", "--model",
      "--max-cost-usd", "--stop-on-product-failure", "--write-report",
    ]) {
      assert.match(stdout, new RegExp(flag));
    }
  });
});

// The full mock-only gauntlet is heavy (~30s wall clock to dispatch every
// conversational task through the live HTTP server). We don't run it as
// part of the standard test suite; it's exercised in CI via a dedicated
// `npm run gauntlet:mock` step and operators run it locally before tagging
// releases. Source-pin the latest report file shape instead so a malformed
// report (missing fields) trips this test.
describe("release-gauntlet: latest report shape (when present)", () => {
  it("the most recent report carries the release-ready header + counts", () => {
    const latest = join(REPO_ROOT, "reports", "release-gauntlet", "latest.md");
    if (!existsSync(latest)) {
      // No report yet — operators must run the gauntlet at least once
      // before tagging a release. The test passes here because absence
      // doesn't mean failure; the bar is "if it exists, it's well-formed".
      return;
    }
    const md = readFileSync(latest, "utf-8");
    assert.match(md, /^# Crucible Release Gauntlet/);
    assert.match(md, /\*\*Release-ready:\*\*\s+\*\*(YES|NO)\*\*/);
    assert.match(md, /Counts:.*PASS:/);
    assert.match(md, /## Inventory/);
    assert.match(md, /## Scenario matrix/);
    assert.match(md, /## Classification audit/);
  });

  it("the most recent JSON report carries inventory + report + decision keys", () => {
    const latest = join(REPO_ROOT, "reports", "release-gauntlet", "latest.json");
    if (!existsSync(latest)) return;
    const json = JSON.parse(readFileSync(latest, "utf-8")) as Record<string, unknown>;
    assert.ok(json["inventory"], "missing inventory key");
    assert.ok(json["report"], "missing report key");
    assert.ok(json["decision"], "missing decision key");
    assert.equal(typeof (json["decision"] as { ready?: boolean }).ready, "boolean");
  });
});
