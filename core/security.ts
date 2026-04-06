/**
 * Crucibulum — Core Security Enforcer
 * Coordinates all security checks.
 */

import { scanForInjection, scanDiffForAntiCheat, isPathForbidden, type ScanResult } from "../security/velum.js";
import { log } from "../utils/logger.js";

export interface SecurityReport {
  injection_scan: "clean" | "detected";
  forbidden_paths_violations: number;
  anti_cheat_violations: number;
  workspace_escape_attempts: number;
  details: ScanResult["violations"];
}

export function enforceTaskSecurity(taskDescription: string, taskTitle: string): SecurityReport {
  const combinedText = `${taskTitle}\n${taskDescription}`;
  const result = scanForInjection(combinedText);

  if (!result.clean) {
    log("error", "security", "Injection detected in task prompt", { violations: result.violations });
  }

  return {
    injection_scan: result.clean ? "clean" : "detected",
    forbidden_paths_violations: 0,
    anti_cheat_violations: 0,
    workspace_escape_attempts: 0,
    details: result.violations,
  };
}

export function enforceWorkspaceSecurity(
  filesWritten: string[],
  forbiddenPaths: string[],
): { violations: string[]; escapeAttempts: number } {
  const violations: string[] = [];
  let escapeAttempts = 0;

  for (const file of filesWritten) {
    if (isPathForbidden(file, forbiddenPaths)) {
      violations.push(file);
    }
    // Check for workspace escape
    if (file.includes("../") || file.startsWith("/")) {
      escapeAttempts++;
    }
  }

  return { violations, escapeAttempts };
}

export function enforceDiffSecurity(patchText: string): ScanResult {
  return scanDiffForAntiCheat(patchText);
}
