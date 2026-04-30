/**
 * Crucible — Manifest Loader
 * Loads full manifest for judge, filters for agent-visible version.
 * Supports both repo-based (task.title) and conversational (description) manifest schemas.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import type { TaskManifest, AgentVisibleManifest } from "../adapters/base.js";
import { sha256Hex } from "../utils/hashing.js";
import { log } from "../utils/logger.js";

const TASKS_DIR = join(process.cwd(), "tasks");
const PUBLIC_STATUSES = new Set(["public", "private", "mixed"]);
const ORACLE_VISIBILITIES = new Set(["hidden", "public", "partially_public"]);
const GOLD_VISIBILITIES = new Set(["hidden", "public", "not_applicable"]);
const CONTAMINATION_RISKS = new Set(["low", "medium", "high"]);

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Discover all family directories under tasks/.
 */
function discoverFamilies(): string[] {
  try {
    return readdirSync(TASKS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Load a raw manifest by task ID (any schema).
 * Searches all family directories under tasks/.
 */
export function loadManifestRaw(taskId: string): any {
  const families = discoverFamilies();
  for (const family of families) {
    const manifestPath = join(TASKS_DIR, family, taskId, "manifest.json");
    try {
      const raw = readFileSync(manifestPath, "utf-8");
      const manifest = JSON.parse(raw);
      if (manifest.id !== taskId) {
        throw new Error(`Manifest ID mismatch: expected ${taskId}, got ${manifest.id}`);
      }
      assertBenchmarkProvenance(manifest);
      log("info", "manifest", `Loaded manifest: ${taskId} (${manifest.family})`);
      return manifest;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
  }
  throw new Error(`Task manifest not found: ${taskId}`);
}

export function assertBenchmarkProvenance(manifest: any): void {
  const prefix = `Task ${manifest?.id ?? "unknown"} release gate failed`;
  const provenance = manifest?.metadata?.benchmark_provenance;
  if (!provenance || typeof provenance !== "object") {
    throw new Error(`${prefix}: metadata.benchmark_provenance is required`);
  }
  if (typeof provenance.source !== "string" || provenance.source.trim().length === 0) {
    throw new Error(`${prefix}: metadata.benchmark_provenance.source is required`);
  }
  if (!PUBLIC_STATUSES.has(provenance.public_status)) {
    throw new Error(`${prefix}: metadata.benchmark_provenance.public_status must be public, private, or mixed`);
  }
  if (!ORACLE_VISIBILITIES.has(provenance.oracle_visibility)) {
    throw new Error(`${prefix}: metadata.benchmark_provenance.oracle_visibility must be hidden, public, or partially_public`);
  }
  if (!GOLD_VISIBILITIES.has(provenance.gold_solution_visibility)) {
    throw new Error(`${prefix}: metadata.benchmark_provenance.gold_solution_visibility must be hidden, public, or not_applicable`);
  }
  if (!CONTAMINATION_RISKS.has(provenance.contamination_risk)) {
    throw new Error(`${prefix}: metadata.benchmark_provenance.contamination_risk must be low, medium, or high`);
  }
  if (!Array.isArray(provenance.known_scoring_limitations) || provenance.known_scoring_limitations.length === 0) {
    throw new Error(`${prefix}: metadata.benchmark_provenance.known_scoring_limitations must list at least one limitation`);
  }
  for (const [index, limitation] of provenance.known_scoring_limitations.entries()) {
    if (typeof limitation !== "string" || limitation.trim().length === 0) {
      throw new Error(`${prefix}: metadata.benchmark_provenance.known_scoring_limitations[${index}] must be a non-empty string`);
    }
  }
}

/**
 * Load a task manifest by task ID (typed as TaskManifest for repo-based tasks).
 */
export function loadManifest(taskId: string): TaskManifest {
  return loadManifestRaw(taskId) as TaskManifest;
}

/**
 * Extract a display title from any manifest schema.
 */
function manifestTitle(manifest: any): string {
  return manifest.task?.title ?? manifest.description ?? manifest.id;
}

/**
 * Resolve the repo path for a manifest.
 */
export function resolveRepoPath(manifest: TaskManifest): string {
  const families = discoverFamilies();
  for (const family of families) {
    const taskDir = join(TASKS_DIR, family, manifest.id);
    const repoPath = join(taskDir, "repo");
    try {
      readFileSync(join(taskDir, "manifest.json"));
      return resolve(repoPath);
    } catch {
      continue;
    }
  }
  return resolve(manifest.repo.path);
}

/**
 * Filter manifest to agent-visible version.
 * Strips: oracle_ref, scoring, metadata, forbidden_paths, max_file_edits, max_files_read
 */
export function filterForAgent(manifest: TaskManifest): AgentVisibleManifest {
  return {
    task: {
      title: manifest.task.title,
      description: manifest.task.description,
      entrypoints: manifest.task.entrypoints,
    },
    constraints: {
      time_limit_sec: manifest.constraints.time_limit_sec,
      max_steps: manifest.constraints.max_steps,
      allowed_tools: manifest.constraints.allowed_tools,
      network_allowed: manifest.constraints.network_allowed,
    },
    verification: {
      public_tests_command: manifest.verification.public_tests_command,
      build_command: manifest.verification.build_command,
    },
  };
}

/**
 * List all available task IDs.
 * Scans all family directories dynamically.
 * Handles both repo-based and conversational manifest schemas.
 */
export function listTasks(
  family?: string,
): Array<{ id: string; family: string; title: string; difficulty: string }> {
  const results: Array<{ id: string; family: string; title: string; difficulty: string }> = [];
  const families = family ? [family] : discoverFamilies();

  for (const f of families) {
    const familyDir = join(TASKS_DIR, f);
    try {
      for (const entry of readdirSync(familyDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          const manifest = loadManifestRaw(entry.name);
          results.push({
            id: manifest.id,
            family: manifest.family,
            title: manifestTitle(manifest),
            difficulty: manifest.difficulty,
          });
        } catch {
          /* skip invalid */
        }
      }
    } catch {
      /* family dir doesn't exist */
    }
  }

  return results;
}

/**
 * Compute manifest hash for evidence bundle.
 */
export function hashManifest(manifest: TaskManifest): string {
  return sha256Hex(JSON.stringify(manifest));
}
