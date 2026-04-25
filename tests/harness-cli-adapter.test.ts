/**
 * Crucible — harness CLI adapter selection regression tests.
 *
 * Pins the user-visible contract:
 *
 *   1. No flags → mock adapter. (operator opt-in to spend money)
 *   2. --adapter <id> --model <m> → live mode with that adapter; never
 *      silently falls back to mock.
 *   3. Missing required env var → clear error naming the env var; no fallback.
 *   4. Unknown adapter id → clear "Unknown adapter" error; no fallback.
 *   5. --live → OpenRouter live mode + the configured judge model.
 *   6. --adapter <id> with no --model → fails because the registry needs one.
 *
 * Tests target the planner (`planAdapter`) so they don't need network or
 * env keys. The full `buildAdapter` path is exercised in
 * `harness-cli-buildadapter` below for the env-var error paths.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { parseArgs, planAdapter, type HarnessArgs } from "../cli/commands/harness.js";

function withEnv(key: string, value: string | undefined, fn: () => void): void {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}

describe("harness CLI — argv parsing", () => {
  it("parses --adapter, --model, --task in any order", () => {
    const a = parseArgs(["--adapter", "openrouter", "--model", "minimax/m2.7", "--task", "safety-001"]);
    assert.equal(a.adapter, "openrouter");
    assert.equal(a.model, "minimax/m2.7");
    assert.deepEqual(a.taskIds, ["safety-001"]);
    assert.equal(a.live, false);
  });

  it("parses --provider for configurable adapters", () => {
    const a = parseArgs(["--adapter", "squidley", "--provider", "minimax", "--model", "MiniMax-M2.7"]);
    assert.equal(a.adapter, "squidley");
    assert.equal(a.provider, "minimax");
    assert.equal(a.model, "MiniMax-M2.7");
  });

  it("parses legacy --live", () => {
    const a = parseArgs(["--live"]);
    assert.equal(a.live, true);
    assert.equal(a.adapter, null);
  });

  it("defaults all selection fields to null without flags", () => {
    const a = parseArgs([]);
    assert.equal(a.adapter, null);
    assert.equal(a.model, null);
    assert.equal(a.live, false);
  });
});

describe("harness CLI — adapter planner", () => {
  function args(over: Partial<HarnessArgs> = {}): HarnessArgs {
    return {
      tabs: null, taskIds: null, live: false, adapter: null, provider: null,
      model: null, outputPath: null, verbose: false, enableJudge: false, ...over,
    };
  }

  it("default (no flags) → mock", () => {
    const plan = planAdapter(args());
    assert.equal(plan.kind, "mock");
  });

  it("--adapter openrouter --model X → live, openrouter, X", () => {
    const plan = planAdapter(args({ adapter: "openrouter", model: "minimax/m2.7" }));
    assert.equal(plan.kind, "live");
    if (plan.kind !== "live") return;
    assert.equal(plan.adapterId, "openrouter");
    assert.equal(plan.model, "minimax/m2.7");
    assert.equal(plan.provider, "openrouter");
    assert.equal(plan.sourceFlag, "adapter");
  });

  it("--adapter minimax --model MiniMax-M2.7 → live, minimax, MiniMax-M2.7", () => {
    const plan = planAdapter(args({ adapter: "minimax", model: "MiniMax-M2.7" }));
    assert.equal(plan.kind, "live");
    if (plan.kind !== "live") return;
    assert.equal(plan.adapterId, "minimax");
    assert.equal(plan.model, "MiniMax-M2.7");
    assert.equal(plan.provider, "minimax");
  });

  it("--adapter <id> with no --model → clear error", () => {
    assert.throws(
      () => planAdapter(args({ adapter: "openrouter" })),
      /requires --model/,
      "should fail when --model is missing on a registry that requires one",
    );
  });

  it("--adapter unknown-thing → 'Unknown adapter' error", () => {
    assert.throws(
      () => planAdapter(args({ adapter: "unknown-thing", model: "x" })),
      /Unknown adapter/,
    );
  });

  it("--live (no --adapter) → live mode using openrouter + judge default", () => {
    withEnv("CRUCIBLE_JUDGE_MODEL", undefined, () => {
      withEnv("OPENROUTER_JUDGE_MODEL", undefined, () => {
        const plan = planAdapter(args({ live: true }));
        assert.equal(plan.kind, "live");
        if (plan.kind !== "live") return;
        assert.equal(plan.adapterId, "openrouter");
        assert.equal(plan.sourceFlag, "live");
        assert.ok(plan.model.length > 0, "judge model id must default to something non-empty");
      });
    });
  });

  it("--live --model X → live mode using X (operator override of judge default)", () => {
    const plan = planAdapter(args({ live: true, model: "anthropic/claude-3.5-sonnet" }));
    assert.equal(plan.kind, "live");
    if (plan.kind !== "live") return;
    assert.equal(plan.adapterId, "openrouter");
    assert.equal(plan.model, "anthropic/claude-3.5-sonnet");
  });

  it("--adapter takes precedence over --live", () => {
    const plan = planAdapter(args({ adapter: "minimax", model: "MiniMax-M2.7", live: true }));
    assert.equal(plan.kind, "live");
    if (plan.kind !== "live") return;
    assert.equal(plan.adapterId, "minimax", "explicit --adapter must win over --live");
  });
});

// ── buildAdapter integration ───────────────────────────────────────────────

import { buildAdapter } from "../cli/commands/harness.js";

describe("harness CLI — buildAdapter", () => {
  it("returns the mock adapter when no flags are set, with mode=mock", async () => {
    const a = parseArgs([]);
    const r = await buildAdapter(a);
    assert.equal(r.mode, "mock");
    assert.equal(r.adapterId, "harness-mock");
    assert.equal(r.model, "harness-mock");
    assert.equal(r.adapter.id, "harness-mock");
  });

  it("does NOT return the mock adapter when --adapter openrouter --model X is passed", async () => {
    await withEnvAsync("OPENROUTER_API_KEY", "test-key-for-resolution-only", async () => {
      const a = parseArgs(["--adapter", "openrouter", "--model", "minimax/m2.7"]);
      const r = await buildAdapter(a);
      assert.equal(r.mode, "live");
      assert.notEqual(r.adapterId, "harness-mock", "must never silently return the mock");
      assert.equal(r.adapterId, "openrouter");
      assert.equal(r.model, "minimax/m2.7");
      assert.equal(r.provider, "openrouter");
    });
  });

  it("fails clearly when --adapter openrouter is set but OPENROUTER_API_KEY is missing", async () => {
    await withEnvAsync("OPENROUTER_API_KEY", undefined, async () => {
      const a = parseArgs(["--adapter", "openrouter", "--model", "minimax/m2.7"]);
      await assert.rejects(
        () => buildAdapter(a),
        /OPENROUTER_API_KEY/,
        "error must name the missing env var, not generic 'auth error'",
      );
    });
  });

  it("fails clearly when --adapter minimax is set but MINIMAX_API_KEY is missing", async () => {
    await withEnvAsync("MINIMAX_API_KEY", undefined, async () => {
      const a = parseArgs(["--adapter", "minimax", "--model", "MiniMax-M2.7"]);
      await assert.rejects(
        () => buildAdapter(a),
        /MINIMAX_API_KEY/,
      );
    });
  });

  it("fails clearly on an unknown adapter id", async () => {
    const a = parseArgs(["--adapter", "totally-fake", "--model", "x"]);
    await assert.rejects(
      () => buildAdapter(a),
      /Unknown adapter/,
    );
  });

  it("fails clearly when --adapter is set without --model on a registry that needs one", async () => {
    await withEnvAsync("OPENROUTER_API_KEY", "test-key", async () => {
      const a = parseArgs(["--adapter", "openrouter"]);
      await assert.rejects(
        () => buildAdapter(a),
        /requires --model/,
      );
    });
  });
});

async function withEnvAsync(key: string, value: string | undefined, fn: () => Promise<void>): Promise<void> {
  const prev = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  try {
    await fn();
  } finally {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  }
}
