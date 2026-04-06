/**
 * Crucibulum — Evidence Bundle Builder
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
  adapter: CrucibulumAdapter;
  model: string;
}

export function buildBundle(input: BundleBuildInput): EvidenceBundle {
  const { manifest, executionResult, diff, judgeResult, security, startTime, endTime, workspace, adapter, model } = input;

  const weights = manifest.scoring.weights;
  const v = judgeResult.verification;

  const totalScore =
    v.correctness.score * weights.correctness +
    v.regression.score * weights.regression +
    v.integrity.score * weights.integrity +
    v.efficiency.score * weights.efficiency;

  const passed = totalScore >= manifest.scoring.pass_threshold && v.integrity.violations.length === 0;

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
      total: Math.round(totalScore * 100) / 100,
      breakdown: {
        correctness: v.correctness.score,
        regression: v.regression.score,
        integrity: v.integrity.score,
        efficiency: v.efficiency.score,
      },
      pass: passed,
      pass_threshold: manifest.scoring.pass_threshold,
      integrity_violations: v.integrity.violations.length,
    },
    usage: {
      tokens_in: executionResult.tokens_in ?? 0,
      tokens_out: executionResult.tokens_out ?? 0,
      estimated_cost_usd: costUsd,
      provider_cost_note: provider === "local" ? "local inference — no API cost" : `via ${provider}`,
    },
    diagnosis: judgeResult.diagnosis,
  };

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
 */
export function verifyBundle(bundle: EvidenceBundle): { valid: boolean; expected: string; computed: string } {
  const stored = bundle.bundle_hash;
  const hashInput = { ...bundle, bundle_hash: "" };
  const computed = sha256Object(hashInput);
  return { valid: stored === computed, expected: stored, computed };
}
