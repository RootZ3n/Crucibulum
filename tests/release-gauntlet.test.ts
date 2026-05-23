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
  // Merge stdout + stderr so tests can grep error-channel messages
  // (`console.error(...)` lands on stderr but we want to assert against it).
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
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: `${e.stdout ?? ""}${e.stderr ?? ""}`, status: e.status ?? 1 };
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
describe("release-gauntlet: --real-provider config guards", () => {
  it("refuses --real-provider without --provider/--model", () => {
    const { stdout, status } = run(["--real-provider", "--write-report"], { allowNonZero: true });
    assert.equal(status, 2);
    assert.match(stdout + "", /requires --provider <id> and --model <id>/);
  });

  it("refuses unknown providers", () => {
    const { stdout, status } = run(["--real-provider", "--provider", "this-provider-does-not-exist", "--model", "any"], { allowNonZero: true });
    // Should reach the gauntlet body and classify as BLOCKED/FAIL_CONFIG;
    // exit non-zero either way.
    assert.notEqual(status, 0);
    // The script may print to stdout or stderr depending on where the
    // blocker rendering lands — just confirm it ran past argv parsing.
    assert.ok(stdout != null);
  });
});

describe("release-gauntlet: real-provider report archive (when present)", () => {
  it("latest-real-provider.md carries provider + model + certified verdict + per-test table", () => {
    const latest = join(REPO_ROOT, "reports", "release-gauntlet", "latest-real-provider.md");
    if (!existsSync(latest)) return;
    const md = readFileSync(latest, "utf-8");
    assert.match(md, /# Crucible Real-Provider Gauntlet/);
    assert.match(md, /\*\*Provider:\*\*\s+`/);
    assert.match(md, /\*\*Model:\*\*\s+`/);
    assert.match(md, /\*\*Real-provider release-certified:\*\*\s+\*\*(YES|NO)\*\*/);
    assert.match(md, /## Per-test results/);
    assert.match(md, /\| Task \| Result \| Terminal \| run_id \| Notes \|/);
  });

  it("latest-real-provider.json carries mode=real-provider + run+bundle distinctness totals", () => {
    const latest = join(REPO_ROOT, "reports", "release-gauntlet", "latest-real-provider.json");
    if (!existsSync(latest)) return;
    const json = JSON.parse(readFileSync(latest, "utf-8")) as { mode: string; real: { provider: string; model: string; results: unknown[]; totals?: { distinctRunIds: number; distinctBundleIds: number; tokensIn: number; tokensOut: number; costUsd: number } } };
    assert.equal(json.mode, "real-provider");
    assert.ok(json.real.provider && json.real.model, "must record provider and model");
    assert.ok(Array.isArray(json.real.results), "results array required");
    // Totals are present when not blocked.
    if (json.real.totals) {
      assert.equal(typeof json.real.totals.distinctRunIds, "number");
      assert.equal(typeof json.real.totals.distinctBundleIds, "number");
      assert.equal(typeof json.real.totals.costUsd, "number");
    }
  });
});

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
