/**
 * Crucible — Core Security Enforcer
 * Coordinates all security checks.
 */
import { type ScanResult } from "../security/velum.js";
export interface SecurityReport {
    injection_scan: "clean" | "detected";
    forbidden_paths_violations: number;
    anti_cheat_violations: number;
    workspace_escape_attempts: number;
    details: ScanResult["violations"];
}
export declare function enforceTaskSecurity(taskDescription: string, taskTitle: string): SecurityReport;
export declare function enforceWorkspaceSecurity(filesWritten: string[], forbiddenPaths: string[]): {
    violations: string[];
    escapeAttempts: number;
};
export declare function enforceDiffSecurity(patchText: string): ScanResult;
//# sourceMappingURL=security.d.ts.map