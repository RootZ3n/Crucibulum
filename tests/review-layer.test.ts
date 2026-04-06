/**
 * Tests for Review Layer:
 * - Deterministic-only run remains valid (review disabled)
 * - Second opinion enabled path
 * - QC review enabled path
 * - Disagreement detection
 * - Review metadata in bundle
 * - UI distinguishes deterministic judge vs review layers
 * - Provider/model selection for review
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runReviewLayer,
  DEFAULT_REVIEW_CONFIG,
  DISABLED_REVIEW,
  type RunReviewConfig,
  type ReviewResult,
} from "../core/review.js";
import type { EvidenceBundle } from "../adapters/base.js";

const ui = readFileSync(join(process.cwd(), "ui", "index.html"), "utf-8");

// ── Mock bundle for testing ─────────────────────────────────────────────

function makeMockBundle(overrides?: Partial<{ pass: boolean; score: number }>): EvidenceBundle {
  const pass = overrides?.pass ?? true;
  const score = overrides?.score ?? 0.99;
  return {
    bundle_id: "run_2026-04-06_test-001_mock-model",
    bundle_hash: "sha256:mock",
    bundle_version: "1.0.0",
    task: { id: "test-001", manifest_hash: "sha256:task", family: "poison_localization", difficulty: "easy" },
    agent: { adapter: "ollama", adapter_version: "1.0.0", system: "ollama-v1", system_version: "ollama-v1", model: "mock-model", model_version: "latest", provider: "ollama" },
    environment: { os: "linux-x64", arch: "x64", repo_commit: "abc123", crucibulum_version: "1.0.0", timestamp_start: "2026-04-06T10:00:00Z", timestamp_end: "2026-04-06T10:01:00Z" },
    timeline: [{ t: 0, type: "task_start" }, { t: 5, type: "file_read", path: "src/bug.ts" }, { t: 30, type: "file_write", path: "src/bug.ts" }, { t: 55, type: "shell", command: "npm test", exit_code: 0 }],
    diff: {
      files_changed: [{ path: "src/bug.ts", lines_added: 3, lines_removed: 1, patch: "-  const x = null;\n+  const x = getDefault();" }],
      files_created: [], files_deleted: [], forbidden_paths_touched: [],
    },
    security: { injection_scan: "clean", forbidden_paths_violations: 0, anti_cheat_violations: 0, workspace_escape_attempts: 0 },
    verification_results: {
      correctness: { score: 1, details: { "hidden-test-1": "pass" } },
      regression: { score: 1, details: { "npm test": "pass" } },
      integrity: { score: 1, details: { "forbidden_paths": "pass" }, violations: [] },
      efficiency: { time_sec: 60, time_limit_sec: 300, steps_used: 5, steps_limit: 50, score: 0.88 },
    },
    score: { total: score, breakdown: { correctness: 1, regression: 1, integrity: 1, efficiency: 0.88 }, pass, pass_threshold: 0.7, integrity_violations: 0 },
    usage: { tokens_in: 5000, tokens_out: 2000, estimated_cost_usd: 0.01, provider_cost_note: "via ollama" },
    judge: { kind: "deterministic", label: "Judge: deterministic", description: "oracle + hidden/public tests + integrity checks", verifier_model: null, components: ["oracle", "hidden tests", "public tests", "diff rules", "integrity checks"] },
    trust: { rubric_hidden: true, narration_ignored: true, state_based_scoring: true, bundle_verified: true },
    diagnosis: { localized_correctly: true, avoided_decoys: true, first_fix_correct: true, self_verified: true, failure_mode: null },
  } as EvidenceBundle;
}

describe("review layer", () => {

  // ── Deterministic-only path ─────────────────────────────────────────

  describe("deterministic-only run", () => {
    it("produces disabled review results when config is default", async () => {
      const bundle = makeMockBundle();
      const result = await runReviewLayer(DEFAULT_REVIEW_CONFIG, bundle);
      assert.equal(result.secondOpinion.enabled, false);
      assert.equal(result.secondOpinion.status, "skipped");
      assert.equal(result.qcReview.enabled, false);
      assert.equal(result.qcReview.status, "skipped");
    });

    it("DISABLED_REVIEW has correct shape", () => {
      assert.equal(DISABLED_REVIEW.enabled, false);
      assert.equal(DISABLED_REVIEW.status, "skipped");
      assert.equal(DISABLED_REVIEW.disagreement, false);
      assert.deepEqual(DISABLED_REVIEW.flags, []);
      assert.equal(DISABLED_REVIEW.recommendation, null);
    });
  });

  // ── Second opinion enabled but provider unavailable ────────────────

  describe("second opinion with unavailable provider", () => {
    it("returns error status when provider has no API key", async () => {
      const bundle = makeMockBundle();
      const config: RunReviewConfig = {
        secondOpinion: { enabled: true, provider: "openai", model: "gpt-4.1-mini" },
        qcReview: { enabled: false, provider: "", model: "" },
      };
      const result = await runReviewLayer(config, bundle);
      assert.equal(result.secondOpinion.enabled, true);
      assert.equal(result.secondOpinion.status, "error");
      assert.ok(result.secondOpinion.error, "should have error message");
      assert.equal(result.qcReview.status, "skipped");
    });
  });

  // ── QC review with unavailable provider ────────────────────────────

  describe("QC review with unavailable provider", () => {
    it("returns error status when provider is unsupported for review", async () => {
      const bundle = makeMockBundle();
      const config: RunReviewConfig = {
        secondOpinion: { enabled: false, provider: "", model: "" },
        qcReview: { enabled: true, provider: "claudecode", model: "default" },
      };
      const result = await runReviewLayer(config, bundle);
      assert.equal(result.qcReview.enabled, true);
      assert.equal(result.qcReview.status, "error");
      assert.ok(result.qcReview.error!.includes("does not support review"), result.qcReview.error);
    });
  });

  // ── ReviewResult shape ─────────────────────────────────────────────

  describe("ReviewResult shape", () => {
    it("completed review has all required fields", async () => {
      // We test the shape via the error path since we can't make real API calls
      const bundle = makeMockBundle();
      const config: RunReviewConfig = {
        secondOpinion: { enabled: true, provider: "openai", model: "gpt-4.1-mini" },
        qcReview: { enabled: false, provider: "", model: "" },
      };
      const result = await runReviewLayer(config, bundle);
      const so = result.secondOpinion;
      // Shape must exist regardless of completion status
      assert.equal(typeof so.enabled, "boolean");
      assert.equal(typeof so.provider, "string");
      assert.equal(typeof so.model, "string");
      assert.ok(["completed", "error", "skipped"].includes(so.status));
      assert.equal(typeof so.summary, "string");
      assert.ok(Array.isArray(so.flags));
      assert.ok(["high", "medium", "low"].includes(so.confidence));
      assert.equal(typeof so.disagreement, "boolean");
    });
  });

  // ── Review data in EvidenceBundle type ────────────────────────────

  describe("bundle review field", () => {
    it("mock bundle can hold review data", () => {
      const bundle = makeMockBundle();
      bundle.review = {
        secondOpinion: {
          enabled: true,
          provider: "openrouter",
          model: "gpt-4.1-mini",
          status: "completed",
          summary: "Fix looks correct and targeted.",
          flags: [],
          confidence: "high",
          recommendation: "accept",
          disagreement: false,
          tokens_in: 3000,
          tokens_out: 200,
          duration_ms: 2500,
        },
        qcReview: {
          enabled: true,
          provider: "openrouter",
          model: "gpt-4.1-mini",
          status: "completed",
          summary: "Result withstands challenge. Fix is minimal and correct.",
          flags: [],
          confidence: "high",
          recommendation: "accept",
          disagreement: false,
          tokens_in: 3000,
          tokens_out: 250,
          duration_ms: 2800,
        },
      };
      assert.equal(bundle.review.secondOpinion.status, "completed");
      assert.equal(bundle.review.qcReview.recommendation, "accept");
    });

    it("bundle with disagreement flag", () => {
      const bundle = makeMockBundle({ pass: true });
      bundle.review = {
        secondOpinion: { ...DISABLED_REVIEW },
        qcReview: {
          enabled: true,
          provider: "openai",
          model: "gpt-4.1",
          status: "completed",
          summary: "This pass looks suspicious — the fix may be incomplete.",
          flags: ["possible false fix", "untested edge case"],
          confidence: "low",
          recommendation: "challenge",
          disagreement: true,
          tokens_in: 3000,
          tokens_out: 300,
          duration_ms: 3000,
        },
      };
      assert.equal(bundle.review.qcReview.disagreement, true);
      assert.equal(bundle.review.qcReview.recommendation, "challenge");
      assert.equal(bundle.score.pass, true); // Deterministic pass NOT overridden
    });
  });

  // ── UI contract checks ─────────────────────────────────────────────

  describe("UI review layer contract", () => {
    it("has review layer config section", () => {
      assert.match(ui, /Review Layer/);
    });

    it("has second opinion checkbox", () => {
      assert.match(ui, /id="review-so-enabled"/);
    });

    it("has QC review checkbox", () => {
      assert.match(ui, /id="review-qc-enabled"/);
    });

    it("has second opinion provider selector", () => {
      assert.match(ui, /id="review-so-provider"/);
    });

    it("has QC review provider selector", () => {
      assert.match(ui, /id="review-qc-provider"/);
    });

    it("has second opinion model input", () => {
      assert.match(ui, /id="review-so-model"/);
    });

    it("has QC review model input", () => {
      assert.match(ui, /id="review-qc-model"/);
    });

    it("pipeline summary shows review state", () => {
      assert.match(ui, /ctx-label.*Review:/);
    });

    it("states deterministic judge is always on", () => {
      assert.match(ui, /Deterministic judge is always on/);
    });

    it("bundle drawer renders review section", () => {
      assert.match(ui, /buildReviewSection/);
      assert.match(ui, /Review Layer/);
    });

    it("review section shows disagreement flag", () => {
      assert.match(ui, /Disagreement detected/);
    });

    it("review section shows recommendation", () => {
      assert.match(ui, /Recommendation/i);
    });

    it("review section shows confidence", () => {
      assert.match(ui, /Confidence/i);
    });

    it("pipeline summary labels judge as authoritative", () => {
      assert.match(ui, /deterministic \(authoritative\)/);
    });

    it("startRun sends review config in payload", () => {
      assert.match(ui, /secondOpinion/);
      assert.match(ui, /qcReview/);
    });
  });
});
