/**
 * Crucible — Runner
 * Orchestrates the full evaluation lifecycle.
 * Load → Workspace → Security → Execute → Judge → Bundle
 */

import type { CrucibulumAdapter, TaskManifest, EvidenceBundle } from "../adapters/base.js";
import { loadManifest, filterForAgent, resolveRepoPath, hashManifest } from "./manifest.js";
import { loadOracleWithIntegrity } from "./oracle.js";
import { createWorkspace, resetWorkspace, destroyWorkspace } from "./workspace.js";
import { enforceTaskSecurity, enforceWorkspaceSecurity, enforceDiffSecurity } from "./security.js";
import { judge } from "./judge.js";
import { buildBundle, computeBundleHash } from "./bundle.js";
import { getGitDiff, getForbiddenPathsTouched } from "../utils/diff.js";
import { log } from "../utils/logger.js";
import { formatDuration } from "../utils/timing.js";
import { platform, arch } from "node:os";
import { DETERMINISTIC_JUDGE_METADATA } from "./judge.js";
import { runReviewLayer, DEFAULT_REVIEW_CONFIG, DISABLED_REVIEW, type RunReviewConfig, type ReviewLayerResult } from "./review.js";
import { applyReviewJudgeUsage } from "./judge-usage.js";
import { isConversationalTask, runConversationalTask, type ConversationalRunResult } from "./conversational-runner.js";
import { canonicalPercent } from "../types/scores.js";
import { runWithProtection } from "./circuit-breaker.js";
import { normalizeVerdict } from "./verdict.js";

export interface RunOptions {
  taskId: string;
  adapter: CrucibulumAdapter;
  model: string;
  runs?: number | undefined;
  keepWorkspace?: boolean | undefined;
  reviewConfig?: RunReviewConfig | undefined;
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

  // Check if this is a conversational task — route to conversational runner
  if (isConversationalTask(taskId)) {
    log("info", "runner", `Routing to conversational runner for: ${taskId}`);
    const convResult = await runConversationalTask({
      taskId,
      adapter,
      model,
      reviewConfig: options.reviewConfig,
    });
    return {
      bundle: convResult.bundle,
      passed: convResult.passed,
      score: convResult.score,
      exitCode: convResult.exitCode,
    };
  }

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
  const { oracle, integrity: oracleIntegrity } = loadOracleWithIntegrity(manifest);

  // 4. Create isolated workspace
  const repoPath = resolveRepoPath(manifest);
  const workspace = createWorkspace(repoPath, taskId);

  try {
    // 5. Execute via adapter (protected by circuit breaker + rate limiter)
    log("info", "runner", `Executing in workspace: ${workspace.path}`);
    const executionResult = await runWithProtection(adapter.id, () =>
      adapter.execute({
        task: agentManifest,
        workspace_path: workspace.path,
        budget: {
          time_limit_sec: manifest.constraints.time_limit_sec,
          max_steps: manifest.constraints.max_steps,
          max_file_edits: manifest.constraints.max_file_edits,
          network_allowed: manifest.constraints.network_allowed,
        },
      }),
    );

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
      oracleIntegrity,
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

    // 10. Review layer (optional, after deterministic judge)
    const reviewCfg = options.reviewConfig ?? DEFAULT_REVIEW_CONFIG;
    if (reviewCfg.secondOpinion.enabled || reviewCfg.qcReview.enabled) {
      log("info", "runner", "Running review layer...");
      bundle.review = await runReviewLayer(reviewCfg, bundle, {
        taskTitle: manifest.task.title,
        taskDescription: manifest.task.description,
      });
      // Roll the model-judge tokens/cost into bundle.judge_usage so the UI can
      // print "Judge cost" alongside model cost. This is the only place the
      // bundle learns what the *judge* spent — keep it in one helper.
      applyReviewJudgeUsage(bundle);
      // Recompute hash with review data included
      bundle.bundle_hash = computeBundleHash(bundle);
    } else {
      bundle.review = {
        authority: "advisory",
        deterministic_result_authoritative: true,
        security: {
          review_input_scanned: false,
          review_input_sanitized: false,
          injection_flags_count: 0,
          flagged_sources: [],
          flagged_artifacts: [],
          review_blocked_reason: null,
          review_output_invalid: false,
          trust_boundary_violations: [],
        },
        secondOpinion: { ...DISABLED_REVIEW },
        qcReview: { ...DISABLED_REVIEW },
      };
      bundle.bundle_hash = computeBundleHash(bundle);
    }

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
  const bundle: EvidenceBundle = {
    bundle_id: `run_${new Date().toISOString().slice(0, 10)}_${manifest.id}_${model.replace(/[/:]/g, "-")}`,
    bundle_hash: "sha256:pending",
    bundle_version: "1.0.0",
    task: { id: manifest.id, manifest_hash: hashManifest(manifest), family: manifest.family, difficulty: manifest.difficulty, benchmark_provenance: manifest.metadata.benchmark_provenance },
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
    score: {
      scale: "fraction_0_1",
      total: 0,
      total_percent: 0,
      breakdown: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 },
      breakdown_percent: { correctness: 0, regression: 0, integrity: 0, efficiency: 0 },
      pass: false,
      pass_threshold: manifest.scoring.pass_threshold,
      pass_threshold_percent: canonicalPercent(manifest.scoring.pass_threshold),
      integrity_violations: 1,
    },
    usage: { tokens_in: 0, tokens_out: 0, estimated_cost_usd: 0, provider_cost_note: reason },
    judge_usage: {
      provider: "",
      model: "",
      tokens_in: 0,
      tokens_out: 0,
      estimated_cost_usd: 0,
      kind: "deterministic",
      note: `failed bundle (${reason}) — no judge cost`,
    },
    judge: DETERMINISTIC_JUDGE_METADATA,
    trust: {
      rubric_hidden: true,
      narration_ignored: true,
      state_based_scoring: true,
      bundle_verified: false,
      deterministic_judge_authoritative: true,
      review_layer_advisory: true,
    },
    diagnosis: { localized_correctly: false, avoided_decoys: false, first_fix_correct: false, self_verified: false, failure_mode: reason },
    integrations: {
      veritor: { contract_version: "1.0.0", consumable: true },
      paedagogus: {
        contract_version: "1.0.0",
        consumable: true,
        routing_signals: {
          task_family: manifest.family,
          difficulty: manifest.difficulty,
          provider: "unknown",
          adapter: adapter.id,
          score: 0,
          pass: false,
          failure_mode: reason,
        },
      },
      crucible: {
        profile_id: null,
        benchmark_score: null,
        benchmark_label: null,
        execution_score: 0,
        divergence_note: null,
      },
    },
  };
  bundle.verdict = normalizeVerdict({
    bundle,
    executionMode: "repo",
    exitReason: "injection_detected",
    rawError: reason,
  });
  bundle.bundle_hash = computeBundleHash(bundle);
  return bundle;
}
