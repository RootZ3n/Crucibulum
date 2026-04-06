export interface FileDiff {
    path: string;
    lines_added: number;
    lines_removed: number;
    patch: string;
}
export declare function getGitDiff(workspacePath: string): {
    files_changed: FileDiff[];
    files_created: string[];
    files_deleted: string[];
};
export declare function getForbiddenPathsTouched(diff: {
    files_changed: FileDiff[];
    files_created: string[];
    files_deleted: string[];
}, forbiddenPaths: string[]): string[];
//# sourceMappingURL=diff.d.ts.map