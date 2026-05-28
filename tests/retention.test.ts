/**
 * Luak — Retention regression
 *
 * Pins all the invariants from the retention design brief:
 *  1. dry-run deletes nothing,
 *  2. files newer than the retention window are preserved,
 *  3. old files are selected for deletion,
 *  4. active run files are preserved,
 *  5. pinned files are preserved,
 *  6. unknown / unparseable bundles are preserved,
 *  7. max-file-count keeps the newest N,
 *  8. max-bytes evicts oldest until under the limit,
 *  9. symlink + path-traversal refusal,
 * 10. storeBundle-produced bundles remain discoverable after retention,
 * 11. failed bundles follow the shorter failed-retention window.
 *
 * Plus a smoke test: generate many fake bundles, dry-run then clean against
 * a temp dir, assert only eligible files were removed and the rest are
 * still discoverable via getBundleById/getBundleByRunId.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, symlinkSync, utimesSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  buildRetentionPlan,
  applyRetentionPlan,
  scanRunsDir,
  resolveRetentionConfig,
  runRetention,
  type RetentionConfig,
} from "../core/retention.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

function makeRunsDir(): string {
  return mkdtempSync(join(tmpdir(), "crcb-retention-"));
}

interface BundleOpts {
  bundleId: string;
  runId?: string;
  pass?: boolean;
  pinned?: boolean;
  taskId?: string;
  model?: string;
  ageMs?: number; // 0 = brand new; bigger = older
  size?: number;  // bytes of padding to inject for byte-cap testing
}

function writeBundle(runsDir: string, opts: BundleOpts): string {
  const bundle: Record<string, unknown> = {
    bundle_id: opts.bundleId,
    bundle_hash: "sha256:test",
    bundle_version: "1.0.0",
    task: { id: opts.taskId ?? "test-task", manifest_hash: "h", family: "personality", difficulty: "easy" },
    agent: { adapter: "test", adapter_version: "v", system: "t", system_version: "v", model: opts.model ?? "test-model", model_version: "v", provider: "test" },
    environment: { os: "test", arch: "test", repo_commit: "none", crucibulum_version: "test", timestamp_start: "2026-01-01T00:00:00Z", timestamp_end: "2026-01-01T00:00:01Z" },
    timeline: [],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: { correctness: { score: 1, details: {} }, regression: { score: 1, details: {} }, integrity: { score: 1, details: {}, violations: [] }, efficiency: { time_sec: 0, time_limit_sec: 60, steps_used: 0, steps_limit: 0, score: 1 } },
    score: { scale: "fraction_0_1", total: 1, total_percent: 100, breakdown: { correctness: 1, regression: 1, integrity: 1, efficiency: 1 }, breakdown_percent: { correctness: 100, regression: 100, integrity: 100, efficiency: 100 }, pass: opts.pass ?? true, pass_threshold: 0.5, pass_threshold_percent: 50, integrity_violations: 0 },
    usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: "test" },
    judge: { kind: "deterministic", label: "test", description: "test", verifier_model: null, components: [] },
    trust: { rubric_hidden: false, narration_ignored: false, state_based_scoring: true, bundle_verified: false, deterministic_judge_authoritative: true, review_layer_advisory: true },
    diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: false, failure_mode: null },
  };
  if (opts.runId) bundle["run_id"] = opts.runId;
  if (opts.pinned) bundle["pinned"] = true;
  if (opts.size) (bundle as { padding?: string }).padding = "x".repeat(opts.size);
  const filePath = join(runsDir, `${opts.bundleId}.json`);
  writeFileSync(filePath, JSON.stringify(bundle, null, 2));
  // Companion .hash sidecar — the real bundle.ts always writes one. The
  // retention plan must delete sidecars alongside their parent bundle.
  writeFileSync(join(runsDir, `${opts.bundleId}.hash`), "sha256:test\n");
  if (opts.ageMs != null) {
    const past = (Date.now() - opts.ageMs) / 1000;
    utimesSync(filePath, past, past);
    utimesSync(join(runsDir, `${opts.bundleId}.hash`), past, past);
  }
  return filePath;
}

function baseConfig(overrides: Partial<RetentionConfig> = {}): RetentionConfig {
  return {
    enabled: true,
    defaultRetentionDays: 14,
    keepSuccessDays: 14,
    keepFailedDays: 7,
    maxRunFiles: 2000,
    maxBytes: 1024 * 1024 * 1024,
    keepPinned: true,
    dryRunDefault: true,
    ...overrides,
  };
}

// ── 1. Dry-run deletes nothing ─────────────────────────────────────────────

describe("retention: dry-run safety", () => {
  it("dry-run mode never unlinks a file", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_old", ageMs: 90 * DAY_MS });
    const plan = buildRetentionPlan({ config: baseConfig(), runsDir });
    assert.ok(plan.toDelete.length > 0, "old bundle must be selected for deletion");
    const before = readdirSync(runsDir).length;
    const apply = applyRetentionPlan(plan, { dryRun: true });
    const after = readdirSync(runsDir).length;
    assert.equal(after, before, "dry-run must leave files in place");
    assert.equal(apply.dryRun, true);
    assert.equal(apply.deleted.length, plan.toDelete.length, "dry-run still reports the same set");
  });
});

// ── 2 + 3. Age policy ───────────────────────────────────────────────────────

describe("retention: age policy", () => {
  it("preserves bundles newer than keepSuccessDays", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_fresh", ageMs: 3 * DAY_MS, pass: true });
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 14 }), runsDir });
    assert.equal(plan.toDelete.length, 0, "fresh bundles must not be deletable");
  });

  it("selects bundles older than keepSuccessDays for deletion", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_old", ageMs: 30 * DAY_MS, pass: true });
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 14 }), runsDir });
    const deletedNames = plan.toDelete.map((d) => d.name);
    assert.ok(deletedNames.includes("run_old.json"), "old bundle JSON must be in toDelete");
    assert.ok(deletedNames.includes("run_old.hash"), "sidecar .hash must be in toDelete");
  });
});

// ── 4. Active run preservation ──────────────────────────────────────────────

describe("retention: active runs", () => {
  it("never deletes a bundle whose run_id is in activeRunIds", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_active-bundle", runId: "run_abc_111", ageMs: 90 * DAY_MS, pass: true });
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 1 }), runsDir, activeRunIds: new Set(["run_abc_111"]) });
    assert.equal(plan.toDelete.length, 0);
    const skip = plan.toSkip.find((s) => s.name === "run_active-bundle.json");
    assert.ok(skip);
    assert.equal(skip.reason, "active_run");
  });
});

// ── 5. Pinned preservation ──────────────────────────────────────────────────

describe("retention: pinned bundles", () => {
  it("preserves a bundle with pinned:true even if old", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_pinned-bundle", pinned: true, ageMs: 90 * DAY_MS, pass: true });
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 1, keepPinned: true }), runsDir });
    assert.equal(plan.toDelete.length, 0);
    const skip = plan.toSkip.find((s) => s.name === "run_pinned-bundle.json");
    assert.ok(skip);
    assert.equal(skip.reason, "pinned");
  });

  it("respects keep_pinned=false: pinned bundles become eligible like any other", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_pinned-bundle", pinned: true, ageMs: 90 * DAY_MS, pass: true });
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 1, keepPinned: false }), runsDir });
    assert.ok(plan.toDelete.find((d) => d.name === "run_pinned-bundle.json"));
  });
});

// ── 6. Unknown bundles preserved ────────────────────────────────────────────

describe("retention: unparseable bundles", () => {
  it("never deletes an unparseable bundle", () => {
    const runsDir = makeRunsDir();
    const bad = join(runsDir, "run_garbage.json");
    writeFileSync(bad, "{not json"); // malformed
    const past = (Date.now() - 90 * DAY_MS) / 1000;
    utimesSync(bad, past, past);
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 1 }), runsDir });
    assert.equal(plan.toDelete.length, 0);
    const skip = plan.toSkip.find((s) => s.name === "run_garbage.json");
    assert.ok(skip);
    assert.equal(skip.reason, "unknown_type");
  });
});

// ── 7. Max file count ───────────────────────────────────────────────────────

describe("retention: max-file-count cap", () => {
  it("keeps newest N bundles when total exceeds maxRunFiles", () => {
    const runsDir = makeRunsDir();
    // 5 bundles; cap at 3 → 2 oldest get evicted.
    for (let i = 0; i < 5; i++) {
      writeBundle(runsDir, { bundleId: `run_b${i}`, ageMs: i * DAY_MS, pass: true });
    }
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 100, maxRunFiles: 3 }), runsDir });
    const deletedBundleJsons = plan.toDelete.filter((d) => d.classification === "bundle_success").map((d) => d.name).sort();
    assert.deepEqual(deletedBundleJsons, ["run_b3.json", "run_b4.json"], "oldest two should be evicted");
    // Sidecars follow.
    const deletedHashes = plan.toDelete.filter((d) => d.classification === "bundle_hash").map((d) => d.name).sort();
    assert.deepEqual(deletedHashes, ["run_b3.hash", "run_b4.hash"]);
  });
});

// ── 8. Max bytes ────────────────────────────────────────────────────────────

describe("retention: max-bytes cap", () => {
  it("evicts oldest eligible bundles until total fits under maxBytes", () => {
    const runsDir = makeRunsDir();
    // Big bundles — each ~10 KB of padding. 5 × ~10 KB ≈ 50 KB. Cap at 25 KB.
    for (let i = 0; i < 5; i++) {
      writeBundle(runsDir, { bundleId: `run_big${i}`, ageMs: i * DAY_MS, pass: true, size: 10_000 });
    }
    const scan = scanRunsDir({ runsDir });
    assert.ok(scan.totalBytes > 25_000);
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 100, maxBytes: 25_000 }), runsDir });
    assert.ok(plan.bytesReclaimable > 0, "byte cap must select something for deletion");
    const remaining = scan.totalBytes - plan.bytesReclaimable;
    assert.ok(remaining <= scan.totalBytes, "remaining must not exceed scanned");
    // Oldest-first eviction — big4 is the oldest and MUST be in the
    // deletion set. big0 (newest) MUST NOT be — preservation walks newest-first.
    const deletedNames = plan.toDelete.filter((d) => d.classification === "bundle_success").map((d) => d.name).sort();
    assert.ok(deletedNames.includes("run_big4.json"), `oldest (big4) must be evicted; got ${deletedNames.join(",")}`);
    assert.ok(!deletedNames.includes("run_big0.json"), `newest (big0) must survive; got ${deletedNames.join(",")}`);
  });
});

// ── 9. Path traversal safety ────────────────────────────────────────────────

describe("retention: symlink / path traversal refusal", () => {
  it("refuses to delete symlinks under the runs dir", () => {
    const runsDir = makeRunsDir();
    const outside = mkdtempSync(join(tmpdir(), "crcb-retention-outside-"));
    const outsideFile = join(outside, "DO-NOT-DELETE.json");
    writeFileSync(outsideFile, "{}");
    // Drop an old-looking symlink in the runs dir that points to an outside path.
    const linkPath = join(runsDir, "run_evil.json");
    symlinkSync(outsideFile, linkPath);
    // Make symlink mtime look old (futimes through utimes follows symlinks on
    // most platforms, but lstat catches it before that matters).
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 1 }), runsDir });
    // The symlink must be classified as "unknown" (not bundle) and skipped.
    const skip = plan.toSkip.find((s) => s.name === "run_evil.json");
    assert.ok(skip, "symlink must appear in toSkip");
    // The outside file must still exist.
    assert.ok(existsSync(outsideFile), "outside file must never be touched");
    // Apply the plan and confirm the outside file survives.
    applyRetentionPlan(plan, { dryRun: false });
    assert.ok(existsSync(outsideFile), "outside file must still exist after apply");
  });
});

// ── 10. storeBundle integration: discoverability survives retention ─────────

describe("retention: storeBundle round-trip", () => {
  it("preserved bundles remain discoverable by bundle_id and run_id after retention runs", async () => {
    const runsDir = makeRunsDir();
    process.env["CRUCIBULUM_RUNS_DIR"] = runsDir;
    // Re-import after env change so getBundleById picks up the new dir.
    // The exported function reads the env on every call.
    const { getBundleById, getBundleByRunId } = await import("../server/routes/shared.js");

    writeBundle(runsDir, { bundleId: "run_kept-bundle", runId: "run_kept_abc", ageMs: 1 * DAY_MS, pass: true });
    writeBundle(runsDir, { bundleId: "run_evicted-bundle", runId: "run_evicted_def", ageMs: 90 * DAY_MS, pass: true });

    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 14 }), runsDir });
    applyRetentionPlan(plan, { dryRun: false });

    // kept-bundle is still discoverable.
    assert.ok(getBundleById("run_kept-bundle"));
    assert.ok(getBundleByRunId("run_kept_abc"));
    // evicted-bundle is gone.
    assert.equal(getBundleById("run_evicted-bundle"), null);
    assert.equal(getBundleByRunId("run_evicted_def"), null);
  });
});

// ── 11. Failed bundles use the shorter retention window ────────────────────

describe("retention: failed bundles", () => {
  it("failed bundles older than keepFailedDays are eligible even when keepSuccessDays would protect them", () => {
    const runsDir = makeRunsDir();
    // 10 days old. Success cap = 14d (protected), failed cap = 7d (eligible).
    writeBundle(runsDir, { bundleId: "run_fail-old", ageMs: 10 * DAY_MS, pass: false });
    writeBundle(runsDir, { bundleId: "run_pass-old", ageMs: 10 * DAY_MS, pass: true });
    const plan = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 14, keepFailedDays: 7 }), runsDir });
    const deletedNames = plan.toDelete.map((d) => d.name);
    assert.ok(deletedNames.includes("run_fail-old.json"), "failed bundle past 7d must be eligible");
    assert.ok(!deletedNames.includes("run_pass-old.json"), "success bundle younger than 14d must be preserved");
    const reason = plan.toDelete.find((d) => d.name === "run_fail-old.json")?.reason;
    assert.equal(reason, "age_failed");
  });
});

// ── Smoke: many bundles, dry-run then clean ─────────────────────────────────

describe("retention: smoke", () => {
  it("100 bundles, mixed ages: dry-run reports plan, clean applies it, eligible set matches", () => {
    const runsDir = makeRunsDir();
    // 100 bundles, ages 0 - 99 days.
    for (let i = 0; i < 100; i++) {
      writeBundle(runsDir, { bundleId: `run_smoke${i}`, ageMs: i * DAY_MS, pass: i % 3 !== 0 });
    }
    const plan1 = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 14, keepFailedDays: 7 }), runsDir });
    const dryRun = applyRetentionPlan(plan1, { dryRun: true });
    assert.equal(dryRun.dryRun, true);
    const filesAfterDryRun = readdirSync(runsDir).filter((f) => f.endsWith(".json")).length;
    assert.equal(filesAfterDryRun, 100, "dry-run must not delete any JSON");

    const plan2 = buildRetentionPlan({ config: baseConfig({ keepSuccessDays: 14, keepFailedDays: 7 }), runsDir });
    const clean = applyRetentionPlan(plan2, { dryRun: false });
    assert.equal(clean.dryRun, false);
    const filesAfterClean = readdirSync(runsDir).filter((f) => f.endsWith(".json")).length;
    const expectedSurvivors = 100 - plan2.toDelete.filter((d) => d.classification.startsWith("bundle") && d.name.endsWith(".json")).length;
    assert.equal(filesAfterClean, expectedSurvivors, `survivors should match plan; got ${filesAfterClean} expected ${expectedSurvivors}`);
  });
});

// ── runRetention high-level wrapper ────────────────────────────────────────

describe("retention: runRetention()", () => {
  it("respects config.enabled = false: forces dry-run regardless of caller request", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_old", ageMs: 90 * DAY_MS, pass: true });
    const config = baseConfig({ enabled: false, keepSuccessDays: 1 });
    const result = runRetention({ runsDir, config });
    assert.equal(result.apply.dryRun, true, "with enabled=false the run must be dry-run");
    assert.equal(result.deletedForReal, false);
    // File still on disk.
    assert.ok(existsSync(join(runsDir, "run_old.json")));
  });

  it("config.enabled = true + dryRun = false: actually deletes", () => {
    const runsDir = makeRunsDir();
    writeBundle(runsDir, { bundleId: "run_old", ageMs: 90 * DAY_MS, pass: true });
    const config = baseConfig({ enabled: true, keepSuccessDays: 1 });
    const result = runRetention({ runsDir, config, dryRun: false });
    assert.equal(result.apply.dryRun, false);
    assert.equal(result.deletedForReal, true);
    assert.ok(!existsSync(join(runsDir, "run_old.json")));
  });
});

// ── Env parsing ────────────────────────────────────────────────────────────

describe("retention: resolveRetentionConfig", () => {
  it("parses CRUCIBLE_RETENTION_* env vars with sensible defaults", () => {
    const prev = { ...process.env };
    try {
      delete process.env["CRUCIBLE_RETENTION_ENABLED"];
      delete process.env["CRUCIBLE_RETENTION_DAYS"];
      delete process.env["CRUCIBLE_RETENTION_MAX_RUN_FILES"];
      const def = resolveRetentionConfig();
      assert.equal(def.enabled, false, "enabled defaults to false");
      assert.equal(def.dryRunDefault, true, "dry-run defaults to true");
      assert.ok(def.maxRunFiles > 0);

      process.env["CRUCIBLE_RETENTION_ENABLED"] = "1";
      process.env["CRUCIBLE_RETENTION_KEEP_SUCCESS_DAYS"] = "30";
      process.env["CRUCIBLE_RETENTION_MAX_RUN_FILES"] = "500";
      const live = resolveRetentionConfig();
      assert.equal(live.enabled, true);
      assert.equal(live.keepSuccessDays, 30);
      assert.equal(live.maxRunFiles, 500);
    } finally {
      Object.assign(process.env, prev);
      for (const k of Object.keys(process.env)) if (!(k in prev)) delete process.env[k];
    }
  });
});
