/**
 * Crucible — Security: Injection Scanner + Anti-Cheat
 * Velum-grade prompt injection detection.
 */
export interface ScanResult {
    clean: boolean;
    violations: Array<{
        type: "injection" | "anti_cheat_code" | "anti_cheat_comment" | "path_traversal";
        pattern: string;
        context: string;
    }>;
}
export declare function scanForInjection(text: string): ScanResult;
export declare function scanDiffForAntiCheat(patchText: string): ScanResult;
export declare function isPathForbidden(path: string, forbiddenPaths: string[]): boolean;
//# sourceMappingURL=velum.d.ts.map