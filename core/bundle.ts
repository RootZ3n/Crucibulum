/**
 * Crucible — Evidence Bundle Builder
 * Builds, signs (SHA256), and stores immutable evidence bundles.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { platform, arch } from "node:os";
import type { TaskManifest, Oracle, ExecutionResult, EvidenceBundle, DiffEntry } from "../adapters/base.js";
import type { JudgeResult } from "./judge.js";
import type { CrucibulumAdapter } from "../adapters/base.js";
import type { WorkspaceInfo } from "./workspace.js";
import { sha256Object } from "../utils/hashing.js";
import { hashManifest } from "./manifest.js";
import { estimateCost } from "../utils/cost.js";
import { log } from "../utils/logger.js";
import { DETERMINISTIC_JUDGE_METADATA } from "./judge.js";
import { canonicalPercent, type SuiteScoringWeights } from "../types/scores.js";
import { resolveScoringWeights, resolvePassThreshold } from "./suite-loader.js";
import { normalizeVerdict } from "./verdict.js";

export interface BundleBuildInput {
  manifest: TaskManifest;
  oracle: Oracle;
  executionResult: ExecutionResult;
  diff: {
    files_changed: DiffEntry[];
    files_created: string[];
    files_deleted: string[];
    forbidden_paths_touched: string[];
  };
  judgeResult: JudgeResult;
  security: {
    injection_scan: "clean" | "detected";
    forbidden_paths_violations: number;
    anti_cheat_violations: number;
    workspace_escape_attempts: number;
  };
  startTime: string;
  endTime: string;
  workspace: WorkspaceInfo;
  suiteId?: string | undefined;
  adapter: CrucibulumAdapter;
  model: string;
}

export function buildBundle(input: BundleBuildInput): EvidenceBundle {
  const { manifest, executionResult, diff, judgeResult, security, startTime, endTime, workspace, adapter, model } = input;

  // Resolve effective scoring weights: task-level > suite-level > defaults
  const weights = resolveScoringWeights(manifest.scoring.weights, input.suiteId);
  const passThreshold = resolvePassThreshold(manifest.scoring.pass_threshold, input.suiteId);
  const v = judgeResult.verification;

  const totalScore =
    v.correctness.score * weights.correctness +
    v.regression.score * weights.regression +
    v.integrity.score * weights.integrity +
    v.efficiency.score * weights.efficiency;

  const passed = totalScore >= passThreshold && v.integrity.violations.length === 0;

  const provider = executionResult.adapter_metadata.provider;
  const costUsd = estimateCost(provider, executionResult.tokens_in ?? 0, executionResult.tokens_out ?? 0);

  const modelSlug = model.replace(/[/:]/g, "-");
  const bundleId = `run_${new Date(startTime).toISOString().slice(0, 10)}_${manifest.id}_${modelSlug}`;

  const bundle: EvidenceBundle = {
    bundle_id: bundleId,
    bundle_hash: "sha256:pending",
    bundle_version: "1.0.0",
    task: {
      id: manifest.id,
      manifest_hash: hashManifest(manifest),
      family: manifest.family,
      difficulty: manifest.difficulty,
    },
    agent: {
      adapter: adapter.id,
      adapter_version: adapter.version,
      system: executionResult.adapter_metadata.system_version,
      system_version: executionResult.adapter_metadata.system_version,
      model,
      model_version: "latest",
      provider,
    },
    environment: {
      os: `${platform()}-${arch()}`,
      arch: arch(),
      repo_commit: workspace.commit,
      crucibulum_version: "1.0.0",
      timestamp_start: startTime,
      timestamp_end: endTime,
    },
    timeline: executionResult.timeline,
    diff,
    security,
    verification_results: v,
    score: {
      scale: "fraction_0_1",
      total: Math.round(totalScore * 100) / 100,
      total_percent: canonicalPercent(totalScore),
      breakdown: {
        correctness: v.correctness.score,
        regression: v.regression.score,
        integrity: v.integrity.score,
        efficiency: v.efficiency.score,
      },
      breakdown_percent: {
        correctness: canonicalPercent(v.correctness.score),
        regression: canonicalPercent(v.regression.score),
        integrity: canonicalPercent(v.integrity.score),
        efficiency: canonicalPercent(v.efficiency.score),
      },
      pass: passed,
      pass_threshold: manifest.scoring.pass_threshold,
      pass_threshold_percent: canonicalPercent(passThreshold),
      integrity_violations: v.integrity.violations.length,
    },
    usage: {
      tokens_in: executionResult.tokens_in ?? 0,
      tokens_out: executionResult.tokens_out ?? 0,
      estimated_cost_usd: costUsd,
      provider_cost_note: provider === "local" ? "local inference — no API cost" : `via ${provider}`,
    },
    // Deterministic judge: zero cost. Bundle still records this so the UI/CLI
    // can print "Judge cost: $0 (deterministic)" alongside model cost without
    // having to special-case the absence of the field.
    judge_usage: {
      provider: "",
      model: "",
      tokens_in: 0,
      tokens_out: 0,
      estimated_cost_usd: 0,
      kind: "deterministic",
      note: "deterministic judge — no model cost",
    },
    judge: DETERMINISTIC_JUDGE_METADATA,
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      // Bundle is freshly signed at build time; loadVerifiedBundle re-checks on read.
      bundle_verified: true,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: judgeResult.diagnosis,
    integrations: {
      veritor: {
        contract_version: "1.0.0",
        consumable: true,
      },
      paedagogus: {
        contract_version: "1.0.0",
        consumable: true,
        routing_signals: {
          task_family: manifest.family,
          difficulty: manifest.difficulty,
          provider,
          adapter: adapter.id,
          score: Math.round(totalScore * 100) / 100,
          pass: passed,
          failure_mode: judgeResult.diagnosis.failure_mode,
        },
      },
      crucible: {
        profile_id: null,
        benchmark_score: null,
        benchmark_label: null,
        execution_score: Math.round(totalScore * 100),
        divergence_note: null,
      },
    },
  };

  bundle.verdict = normalizeVerdict({
    bundle,
    executionMode: "repo",
    exitReason: executionResult.exit_reason,
    providerError: executionResult.provider_error ?? null,
  });

  // Compute and set bundle hash
  const hashInput = { ...bundle, bundle_hash: "" };
  bundle.bundle_hash = sha256Object(hashInput);

  return bundle;
}

/**
 * Store evidence bundle to disk.
 */
export function storeBundle(bundle: EvidenceBundle): string {
  const runsDir = process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
  mkdirSync(runsDir, { recursive: true });

  const filePath = join(runsDir, `${bundle.bundle_id}.json`);
  writeFileSync(filePath, JSON.stringify(bundle, null, 2) + "\n", "utf-8");

  // Store hash separately for verification
  const hashPath = join(runsDir, `${bundle.bundle_id}.hash`);
  writeFileSync(hashPath, bundle.bundle_hash + "\n", "utf-8");

  log("info", "bundle", `Stored: ${filePath}`);
  return filePath;
}

/**
 * Verify a stored bundle's integrity by recomputing its hash.
 *
 * The stored bundle contains a `trust.bundle_verified` field that is set to
 * `true` at build time — that flag alone is worthless, because anyone who
 * edits the JSON on disk can flip it. Use this function (or
 * `loadVerifiedBundle`) on every read from disk and trust the result, not
 * the flag already inside the file.
 */
export function verifyBundle(bundle: EvidenceBundle): { valid: boolean; expected: string; computed: string } {
  const stored = bundle.bundle_hash;
  const hashInput = { ...bundle, bundle_hash: "" };
  const computed = sha256Object(hashInput);
  return { valid: stored === computed, expected: stored, computed };
}

/**
 * Parse a bundle JSON string, re-verify its hash, and normalize its trust state
 * to reflect reality. Returns `null` if the payload is not a valid bundle
 * object. A bundle that fails verification is still returned so operators can
 * inspect it — but `trust.bundle_verified` is forced to `false` so downstream
 * consumers cannot be misled.
 */
export function loadVerifiedBundle(raw: string, sourceLabel?: string): EvidenceBundle | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const bundle = parsed as EvidenceBundle;
  if (typeof bundle.bundle_id !== "string" || typeof bundle.bundle_hash !== "string" || !bundle.score || !bundle.trust) {
    return null;
  }
  const result = verifyBundle(bundle);
  if (!result.valid) {
    log("warn", "bundle", `Hash mismatch on ${sourceLabel ?? bundle.bundle_id} — expected ${result.expected.slice(0, 20)}…, got ${result.computed.slice(0, 20)}…`);
    // Never let a tampered bundle claim bundle_verified=true downstream.
    bundle.trust = { ...bundle.trust, bundle_verified: false };
  } else {
    bundle.trust = { ...bundle.trust, bundle_verified: true };
  }
  bundle.verdict = bundle.verdict ?? normalizeVerdict({ bundle });
  return bundle;
}
