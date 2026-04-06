/**
 * Crucibulum — Runner
 * Orchestrates the full evaluation lifecycle.
 * Load → Workspace → Security → Execute → Judge → Bundle
 */

import type { CrucibulumAdapter, TaskManifest, EvidenceBundle } from "../adapters/base.js";
import { loadManifest, filterForAgent, resolveRepoPath, hashManifest } from "./manifest.js";
import { loadOracle } from "./oracle.js";
import { createWorkspace, resetWorkspace, destroyWorkspace } from "./workspace.js";
import { enforceTaskSecurity, enforceWorkspaceSecurity, enforceDiffSecurity } from "./security.js";
import { judge } from "./judge.js";
import { buildBundle } from "./bundle.js";
import { getGitDiff, getForbiddenPathsTouched } from "../utils/diff.js";
import { log } from "../utils/logger.js";
import { formatDuration } from "../utils/timing.js";
import { platform, arch } from "node:os";

export interface RunOptions {
  taskId: string;
  adapter: CrucibulumAdapter;
  model: string;
  runs?: number | undefined;
  keepWorkspace?: boolean | undefined;
}

export interface RunResult {
  bundle: EvidenceBundle;
  passed: boolean;
  score: number;
  exitCode: number;
}

export async function runTask(options: RunOptions): Promise<RunResult> {
  const { taskId, adapter, model } = options;
  const startTime = new Date().toISOString();

  log("info", "runner", `Starting run: ${taskId} with ${adapter.name}/${model}`);

  // 1. Load manifest (full — for judge)
  const manifest = loadManifest(taskId);
  const agentManifest = filterForAgent(manifest);

  // 2. Security scan on task prompt
  const taskSecurity = enforceTaskSecurity(manifest.task.description, manifest.task.title);
  if (taskSecurity.injection_scan === "detected") {
    log("error", "runner", "Injection detected in task prompt — aborting");
    // Build a failed bundle and return exit code 4
    const failBundle = buildFailedBundle(manifest, adapter, model, startTime, "injection_detected", {
      injection_scan: taskSecurity.injection_scan,
      forbidden_paths_violations: taskSecurity.forbidden_paths_violations,
      anti_cheat_violations: taskSecurity.anti_cheat_violations,
      workspace_escape_attempts: taskSecurity.workspace_escape_attempts,
    });
    return { bundle: failBundle, passed: false, score: 0, exitCode: 4 };
  }

  // 3. Load oracle (for judge — never passed to adapter)
  const oracle = loadOracle(manifest);

  // 4. Create isolated workspace
  const repoPath = resolveRepoPath(manifest);
  const workspace = createWorkspace(repoPath, taskId);

  try {
    // 5. Execute via adapter
    log("info", "runner", `Executing in workspace: ${workspace.path}`);
    const executionResult = await adapter.execute({
      task: agentManifest,
      workspace_path: workspace.path,
      budget: {
        time_limit_sec: manifest.constraints.time_limit_sec,
        max_steps: manifest.constraints.max_steps,
        max_file_edits: manifest.constraints.max_file_edits,
        network_allowed: manifest.constraints.network_allowed,
      },
    });

    log("info", "runner", `Execution complete: ${executionResult.exit_reason} in ${formatDuration(executionResult.duration_ms)}`);

    // 6. Collect diff evidence
    const diff = getGitDiff(workspace.path);
    const forbiddenTouched = getForbiddenPathsTouched(diff, manifest.constraints.forbidden_paths);

    // 7. Security checks on workspace + diff
    const wsSecurity = enforceWorkspaceSecurity(executionResult.files_written, manifest.constraints.forbidden_paths);
    const allPatches = diff.files_changed.map(f => f.patch).join("\n");
    const diffSecurity = enforceDiffSecurity(allPatches);

    // 8. Judge — score based on evidence, not narration
    const judgeDiff = {
      files_changed: diff.files_changed,
      files_created: diff.files_created,
      files_deleted: diff.files_deleted,
      forbidden_paths_touched: forbiddenTouched,
    };
    const judgeResult = judge(manifest, oracle, judgeDiff, executionResult, workspace.path);

    // 9. Build evidence bundle
    const endTime = new Date().toISOString();
    const bundle = buildBundle({
      manifest,
      oracle,
      executionResult,
      diff: {
        files_changed: diff.files_changed.map(f => ({
          path: f.path,
          lines_added: f.lines_added,
          lines_removed: f.lines_removed,
          patch: f.patch,
        })),
        files_created: diff.files_created,
        files_deleted: diff.files_deleted,
        forbidden_paths_touched: forbiddenTouched,
      },
      judgeResult,
      security: {
        injection_scan: taskSecurity.injection_scan,
        forbidden_paths_violations: wsSecurity.violations.length + forbiddenTouched.length,
        anti_cheat_violations: diffSecurity.violations.length,
        workspace_escape_attempts: wsSecurity.escapeAttempts,
      },
      startTime,
      endTime,
      workspace,
      adapter,
      model,
    });

    const passed = bundle.score.pass;
    const exitCode = passed ? 0 : bundle.score.integrity_violations > 0 ? 2 : 1;

    log("info", "runner", `Score: ${(bundle.score.total * 100).toFixed(0)}% — ${passed ? "PASS" : "FAIL"}`);

    return { bundle, passed, score: bundle.score.total, exitCode };
  } finally {
    if (!options.keepWorkspace) {
      destroyWorkspace(workspace.path);
    }
  }
}

function buildFailedBundle(
  manifest: TaskManifest,
  adapter: CrucibulumAdapter,
  model: string,
  startTime: string,
  reason: string,
  security: { injection_scan: "clean" | "detected"; forbidden_paths_violations: number; anti_cheat_violations: number; workspace_escape_attempts: number },
): EvidenceBundle {
  return {
    bundle_id: `run_${new Date().toISOString().slice(0, 10)}_${manifest.id}_${model.replace(/[/:]/g, "-")}`,
    bundle_hash: "sha256:pending",
    bundle_version: "1.0.0",
    task: { id: manifest.id, manifest_hash: hashManifest(manifest), family: manifest.family, difficulty: manifest.difficulty },
    agent: { adapter: adapter.id, adapter_version: adapter.version, system: adapter.name, system_version: "unknown", model, model_version: "latest", provider: "unknown" },
    environment: { os: `${platform()}-${arch()}`, arch: arch(), repo_commit: "none", crucibulum_version: "1.0.0", timestamp_start: startTime, timestamp_end: new Date().toISOString() },
    timeline: [{ t: 0, type: "error", detail: reason }],
    diff: { files_changed: [], files_created: [], files_deleted: [], forbidden_paths_touched: [] },
    security,
    verification_results: {
      correctness: { score: 0, details: {} },
      regression: { score: 0, details: {} },
      integrity: { score: 0, details: {}, violations: [reason] },
      efficiency: { time_sec: 0, time_limit_sec: manifest.constraints.time_limit_sec, steps_used: 0, steps_limit: manifest.constraints.max_steps, score: 0 },
    },
    score: { total: 0, breakdown: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 }, pass: false, pass_threshold: manifest.scoring.pass_threshold, integrity_violations: 1 },
    usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: reason },
    diagnosis: { localized_correctly: false, avoided_decoys: false, first_fix_correct: false, self_verified: false, failure_mode: reason },
  };
}
