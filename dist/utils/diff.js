/**
 * Crucibulum — Diff Utilities
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
const BASELINE_FILE = ".crucibulum-baseline.json";
export function getGitDiff(workspacePath) {
    const files_changed = [];
    const files_created = [];
    const files_deleted = [];
    try {
        // Get list of changed files
        const statusRaw = execSync("git diff --name-status HEAD", { cwd: workspacePath, encoding: "utf-8", stdio: "pipe" }).trim();
        if (!statusRaw)
            return { files_changed, files_created, files_deleted };
        for (const line of statusRaw.split("\n")) {
            const [status, ...pathParts] = line.split("\t");
            const filePath = pathParts.join("\t");
            if (!status || !filePath)
                continue;
            if (status === "A") {
                files_created.push(filePath);
            }
            else if (status === "D") {
                files_deleted.push(filePath);
            }
            // Get patch for this file
            try {
                const patch = execSync(`git diff HEAD -- "${filePath}"`, { cwd: workspacePath, encoding: "utf-8", stdio: "pipe" }).trim();
                const added = (patch.match(/^\+[^+]/gm) ?? []).length;
                const removed = (patch.match(/^-[^-]/gm) ?? []).length;
                files_changed.push({ path: filePath, lines_added: added, lines_removed: removed, patch });
            }
            catch {
                files_changed.push({ path: filePath, lines_added: 0, lines_removed: 0, patch: "" });
            }
        }
    }
    catch {
        return getSnapshotDiff(workspacePath);
    }
    return { files_changed, files_created, files_deleted };
}
export function getForbiddenPathsTouched(diff, forbiddenPaths) {
    const allPaths = [
        ...diff.files_changed.map(f => f.path),
        ...diff.files_created,
        ...diff.files_deleted,
    ];
    return allPaths.filter(p => forbiddenPaths.some(fp => p.startsWith(fp)));
}
function getSnapshotDiff(workspacePath) {
    const baselinePath = join(workspacePath, BASELINE_FILE);
    if (!existsSync(baselinePath)) {
        return { files_changed: [], files_created: [], files_deleted: [] };
    }
    const baseline = JSON.parse(readFileSync(baselinePath, "utf-8"));
    const current = snapshotFiles(workspacePath);
    const files_changed = [];
    const files_created = [];
    const files_deleted = [];
    const allPaths = new Set([...Object.keys(baseline), ...Object.keys(current)]);
    for (const filePath of allPaths) {
        const before = baseline[filePath];
        const after = current[filePath];
        if (before === after)
            continue;
        if (before === undefined)
            files_created.push(filePath);
        if (after === undefined)
            files_deleted.push(filePath);
        const beforeLines = before ? before.split("\n").length : 0;
        const afterLines = after ? after.split("\n").length : 0;
        files_changed.push({
            path: filePath,
            lines_added: Math.max(afterLines - beforeLines, 0),
            lines_removed: Math.max(beforeLines - afterLines, 0),
            patch: after ?? "",
        });
    }
    return { files_changed, files_created, files_deleted };
}
function snapshotFiles(dir, prefix = "") {
    const out = {};
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === BASELINE_FILE) {
            continue;
        }
        const abs = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            Object.assign(out, snapshotFiles(abs, rel));
        }
        else if (entry.isFile()) {
            out[rel] = readFileSync(abs, "utf-8");
        }
    }
    return out;
}
//# sourceMappingURL=diff.js.map