/**
 * Crucibulum — Core Security Enforcer
 * Coordinates all security checks.
 */
import { scanForInjection, scanDiffForAntiCheat, isPathForbidden } from "../security/velum.js";
import { log } from "../utils/logger.js";
export function enforceTaskSecurity(taskDescription, taskTitle) {
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
export function enforceWorkspaceSecurity(filesWritten, forbiddenPaths) {
    const violations = [];
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
export function enforceDiffSecurity(patchText) {
    return scanDiffForAntiCheat(patchText);
}
//# sourceMappingURL=security.js.map