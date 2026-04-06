/**
 * Crucibulum — Diff Utilities
 */
import { execSync } from "node:child_process";
import { join } from "node:path";

export interface FileDiff {
  path: string;
  lines_added: number;
  lines_removed: number;
  patch: string;
}

export function getGitDiff(workspacePath: string): { files_changed: FileDiff[]; files_created: string[]; files_deleted: string[] } {
  const files_changed: FileDiff[] = [];
  const files_created: string[] = [];
  const files_deleted: string[] = [];

  try {
    // Get list of changed files
    const statusRaw = execSync("git diff --name-status HEAD", { cwd: workspacePath, encoding: "utf-8" }).trim();
    if (!statusRaw) return { files_changed, files_created, files_deleted };

    for (const line of statusRaw.split("\n")) {
      const [status, ...pathParts] = line.split("\t");
      const filePath = pathParts.join("\t");
      if (!status || !filePath) continue;

      if (status === "A") {
        files_created.push(filePath);
      } else if (status === "D") {
        files_deleted.push(filePath);
      }

      // Get patch for this file
      try {
        const patch = execSync(`git diff HEAD -- "${filePath}"`, { cwd: workspacePath, encoding: "utf-8" }).trim();
        const added = (patch.match(/^\+[^+]/gm) ?? []).length;
        const removed = (patch.match(/^-[^-]/gm) ?? []).length;
        files_changed.push({ path: filePath, lines_added: added, lines_removed: removed, patch });
      } catch {
        files_changed.push({ path: filePath, lines_added: 0, lines_removed: 0, patch: "" });
      }
    }
  } catch {
    // Not a git repo or no changes
  }

  return { files_changed, files_created, files_deleted };
}

export function getForbiddenPathsTouched(diff: { files_changed: FileDiff[]; files_created: string[]; files_deleted: string[] }, forbiddenPaths: string[]): string[] {
  const allPaths = [
    ...diff.files_changed.map(f => f.path),
    ...diff.files_created,
    ...diff.files_deleted,
  ];
  return allPaths.filter(p => forbiddenPaths.some(fp => p.startsWith(fp)));
}
