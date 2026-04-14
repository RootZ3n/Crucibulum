/**
 * Crucibulum — Judge
 * Scores based on observable state transitions. Never trusts narration.
 * Scoring order: Integrity → Correctness → Regression → Efficiency
 */

import { execSync } from "node:child_process";
import type { Oracle, TaskManifest, ExecutionResult, VerificationResults, DiffEntry } from "../adapters/base.js";
import { log } from "../utils/logger.js";

export const DETERMINISTIC_JUDGE_METADATA = {
  kind: "deterministic" as const,
  label: "Judge: deterministic",
  description: "oracle + hidden/public tests + integrity checks",
  verifier_model: null,
  components: ["oracle", "hidden tests", "public tests", "diff rules", "integrity checks"],
};

interface DiffData {
  files_changed: Array<{ path: string; lines_added: number; lines_removed: number; patch: string }>;
  files_created: string[];
  files_deleted: string[];
  forbidden_paths_touched: string[];
}

export interface JudgeResult {
  verification: VerificationResults;
  diagnosis: {
    localized_correctly: boolean;
    avoided_decoys: boolean;
    first_fix_correct: boolean;
    self_verified: boolean;
    failure_mode: string | null;
  };
}

export function judge(
  manifest: TaskManifest,
  oracle: Oracle,
  diff: DiffData,
  execution: ExecutionResult,
  workspacePath: string,
): JudgeResult {
  log("info", "judge", `Judging ${manifest.id}: ${diff.files_changed.length} files changed, ${execution.steps_used} steps`);

  // -- 1. INTEGRITY (check first — hard fails) -------------------------------
  const integrity = judgeIntegrity(oracle, diff, execution);
  const hasHardFail = integrity.violations.some(v => v.startsWith("HARD_FAIL"));

  // -- 2. CORRECTNESS (hidden tests + checks) --------------------------------
  const correctness = hasHardFail
    ? { score: 0, details: { "skipped-hard-fail": "fail" as const } }
    : judgeCorrectness(oracle, workspacePath);

  // -- 3. REGRESSION (public tests + build) -----------------------------------
  const regression = hasHardFail
    ? { score: 0, details: { "skipped-hard-fail": "fail" as const } }
    : judgeRegression(oracle, workspacePath);

  // -- 4. EFFICIENCY ----------------------------------------------------------
  const efficiency = judgeEfficiency(execution, manifest);

  // -- 5. DIAGNOSIS (agent trace — for audit, NOT scoring) --------------------
  const diagnosis = buildDiagnosis(oracle, diff, execution);

  return {
    verification: { correctness, regression, integrity, efficiency },
    diagnosis,
  };
}

// -- Integrity Judge ----------------------------------------------------------

function judgeIntegrity(
  oracle: Oracle,
  diff: DiffData,
  _execution: ExecutionResult,
): { score: number; details: Record<string, "pass" | "fail">; violations: string[] } {
  const details: Record<string, "pass" | "fail"> = {};
  const violations: string[] = [];

  // Check forbidden paths
  if (diff.forbidden_paths_touched.length > 0) {
    details["forbidden_paths"] = "fail";
    violations.push(`HARD_FAIL: forbidden paths touched: ${diff.forbidden_paths_touched.join(", ")}`);
  } else {
    details["forbidden_paths"] = "pass";
  }

  // Check integrity rules from oracle
  for (const check of oracle.checks.integrity) {
    if (check.type === "forbidden_edit" && check.paths) {
      const touched = diff.files_changed
        .filter(f => check.paths!.some(p => f.path.startsWith(p)))
        .map(f => f.path);
      if (touched.length > 0) {
        details[check.id] = "fail";
        if (check.severity === "hard_fail") {
          violations.push(`HARD_FAIL: ${check.id}: ${touched.join(", ")}`);
        } else {
          violations.push(`PENALTY: ${check.id}: ${touched.join(", ")}`);
        }
      } else {
        details[check.id] = "pass";
      }
    }

    if (check.type === "diff_rule") {
      if (check.rule === "no_file_deletion" && check.target_pattern) {
        const pattern = new RegExp(check.target_pattern.replace(/\*/g, ".*"));
        const deleted = diff.files_deleted.filter(f => pattern.test(f));
        if (deleted.length > 0) {
          details[check.id] = "fail";
          violations.push(`${check.severity === "hard_fail" ? "HARD_FAIL" : "PENALTY"}: ${check.id}: deleted ${deleted.join(", ")}`);
        } else {
          details[check.id] = "pass";
        }
      }

      if (check.rule === "max_lines_changed" && check.value != null) {
        const totalChanged = diff.files_changed.reduce((sum, f) => sum + f.lines_added + f.lines_removed, 0);
        if (totalChanged > check.value) {
          details[check.id] = "fail";
          violations.push(`${check.severity === "hard_fail" ? "HARD_FAIL" : "PENALTY"}: ${check.id}: ${totalChanged} lines changed (max ${check.value})`);
        } else {
          details[check.id] = "pass";
        }
      }
    }
  }

  // Check anti-cheat patterns in diff
  const allPatches = diff.files_changed.map(f => f.patch).join("\n");
  for (const pattern of oracle.checks.anti_cheat.forbidden_code_patterns) {
    if (allPatches.includes(pattern)) {
      details[`anti_cheat_code_${pattern.slice(0, 20)}`] = "fail";
      violations.push(`HARD_FAIL: anti-cheat code pattern detected: ${pattern}`);
    }
  }

  const totalChecks = Object.keys(details).length;
  const passed = Object.values(details).filter(v => v === "pass").length;
  const score = totalChecks > 0 ? passed / totalChecks : 1;

  return { score: violations.some(v => v.startsWith("HARD_FAIL")) ? 0 : score, details, violations };
}

// -- Correctness Judge --------------------------------------------------------

function judgeCorrectness(
  oracle: Oracle,
  workspacePath: string,
): { score: number; details: Record<string, "pass" | "fail" | "unsupported">; not_evaluable?: boolean } {
  const details: Record<string, "pass" | "fail" | "unsupported"> = {};
  let totalWeight = 0;
  let passedWeight = 0;

  for (const check of oracle.checks.correctness) {
    const weight = check.weight ?? 1;

    if (check.type === "hidden_test" && check.command) {
      totalWeight += weight;
      const passed = runCommand(check.command, workspacePath);
      details[check.id] = passed ? "pass" : "fail";
      if (passed) passedWeight += weight;
    } else if (check.type === "api_check") {
      // API checks are not implemented — mark as unsupported, do NOT count toward score
      // This prevents fake passes from inflating correctness scores
      details[check.id] = "unsupported";
    } else if (check.type === "hidden_test" && !check.command) {
      // Hidden test with no command — also unsupported
      details[check.id] = "unsupported";
    }
  }

  // If every correctness check was unsupported (or the oracle had none at all),
  // we have no evaluable signal. Return score=0 but flag not_evaluable so
  // consumers can distinguish "nothing to grade" from "graded and got zero".
  if (totalWeight === 0) {
    const hasChecks = oracle.checks.correctness.length > 0;
    if (hasChecks) {
      log("warn", "judge", `Correctness: all ${oracle.checks.correctness.length} check(s) unsupported — score is not evaluable`);
    }
    return { score: 0, details, not_evaluable: true };
  }

  return { score: totalWeight > 0 ? passedWeight / totalWeight : 0, details };
}

// -- Regression Judge ---------------------------------------------------------

function judgeRegression(
  oracle: Oracle,
  workspacePath: string,
): { score: number; details: Record<string, "pass" | "fail"> } {
  const details: Record<string, "pass" | "fail"> = {};
  let total = 0;
  let passed = 0;

  for (const check of oracle.checks.regression) {
    total++;
    if (check.command) {
      const ok = runCommand(check.command, workspacePath);
      details[check.id] = ok ? "pass" : "fail";
      if (ok) passed++;
    } else {
      details[check.id] = "pass";
      passed++;
    }
  }

  return { score: total > 0 ? passed / total : 1, details };
}

// -- Efficiency Judge ---------------------------------------------------------

function judgeEfficiency(
  execution: ExecutionResult,
  manifest: TaskManifest,
): VerificationResults["efficiency"] {
  const timeSec = Math.round(execution.duration_ms / 1000);
  const timeRatio = timeSec / manifest.constraints.time_limit_sec;
  const stepRatio = execution.steps_used / manifest.constraints.max_steps;
  // Score inversely proportional to resource usage — lower = better
  const score = Math.max(0, 1 - (timeRatio * 0.6 + stepRatio * 0.4));

  return {
    time_sec: timeSec,
    time_limit_sec: manifest.constraints.time_limit_sec,
    steps_used: execution.steps_used,
    steps_limit: manifest.constraints.max_steps,
    score: Math.round(score * 100) / 100,
  };
}

// -- Diagnosis Builder (for audit, NOT scoring) -------------------------------

function buildDiagnosis(
  oracle: Oracle,
  diff: DiffData,
  execution: ExecutionResult,
): JudgeResult["diagnosis"] {
  const bugFile = oracle.ground_truth.bug_location;
  const changedPaths = diff.files_changed.map(f => f.path);
  const localizedCorrectly = changedPaths.includes(bugFile);

  const decoyPaths = oracle.checks.decoys.map(d => d.path);
  const touchedDecoys = changedPaths.filter(p => decoyPaths.includes(p));
  const avoidedDecoys = touchedDecoys.length === 0;

  // Check if fix matches expected pattern
  const bugFileDiff = diff.files_changed.find(f => f.path === bugFile);
  const firstFixCorrect = bugFileDiff
    ? bugFileDiff.patch.includes(oracle.ground_truth.correct_fix_pattern)
    : false;

  // Check if agent ran tests after fixing (self-verification)
  const timeline = execution.timeline;
  let lastWrite = -1;
  for (let i = timeline.length - 1; i >= 0; i--) {
    if (timeline[i]!.type === "file_write") { lastWrite = i; break; }
  }
  const testAfterWrite = timeline.slice(lastWrite + 1).some(e =>
    e.type === "shell" && (e.command?.includes("test") || e.command?.includes("jest") || e.command?.includes("npm test")),
  );

  let failureMode: string | null = null;
  if (!localizedCorrectly) failureMode = "localization_failure";
  else if (!avoidedDecoys) failureMode = "decoy_distraction";
  else if (!firstFixCorrect) failureMode = "wrong_fix";

  return {
    localized_correctly: localizedCorrectly,
    avoided_decoys: avoidedDecoys,
    first_fix_correct: firstFixCorrect,
    self_verified: testAfterWrite,
    failure_mode: failureMode,
  };
}

// -- Command runner -----------------------------------------------------------

function runCommand(command: string, cwd: string): boolean {
  try {
    execSync(command, { cwd, stdio: "pipe", timeout: 60_000, maxBuffer: 5 * 1024 * 1024 });
    // Default pass condition is exit_code == 0
    return true;
  } catch {
    return false;
  }
}
