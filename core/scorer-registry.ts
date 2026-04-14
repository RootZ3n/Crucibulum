/**
 * Crucibulum — Scorer Registry
 * Loads, validates, and manages custom scorer plugins from the /scorers/ directory.
 * Invalid plugins fail loudly at load time — no silent swallowing.
 */

import { readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { log } from "../utils/logger.js";

// ─── Plugin interfaces ─────────────────────────────────────────────

export interface ScorerInput {
  taskId: string;
  taskFamily: string;
  modelResponse: string;
  oracleData: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ScorerOutput {
  score: number; // 0.0–1.0
  passed: boolean;
  breakdown: Record<string, number>;
  explanation: string;
  metadata?: Record<string, unknown>;
}

export interface ScorerPlugin {
  id: string;
  name: string;
  version: string;
  taskFamilies: string[];
  score(input: ScorerInput): ScorerOutput;
}

// ─── Internal state ────────────────────────────────────────────────

interface LoadedScorer {
  plugin: ScorerPlugin;
  sourcePath: string;
  loadedAt: string;
}

const scorers = new Map<string, LoadedScorer>();
let scorersDir = resolve(process.cwd(), "scorers");

export function setScorersDir(dir: string): void {
  scorersDir = resolve(dir);
}

// ─── Validation ────────────────────────────────────────────────────

function validateScorer(plugin: unknown, sourcePath: string): asserts plugin is ScorerPlugin {
  if (typeof plugin !== "object" || plugin === null) {
    throw new Error(`Scorer at ${sourcePath}: default export is not an object`);
  }
  const p = plugin as Record<string, unknown>;

  if (typeof p.id !== "string" || !p.id.trim()) {
    throw new Error(`Scorer at ${sourcePath}: missing required field 'id' (non-empty string)`);
  }
  if (typeof p.name !== "string" || !p.name.trim()) {
    throw new Error(`Scorer '${p.id}': missing required field 'name'`);
  }
  if (typeof p.version !== "string") {
    throw new Error(`Scorer '${p.id}': missing required field 'version'`);
  }
  if (!Array.isArray(p.taskFamilies)) {
    throw new Error(`Scorer '${p.id}': 'taskFamilies' must be an array`);
  }
  if (typeof p.score !== "function") {
    throw new Error(`Scorer '${p.id}': missing required function 'score()'`);
  }
}

// ─── Loading ───────────────────────────────────────────────────────

export async function loadAllScorers(): Promise<{
  loaded: number;
  failed: Array<{ path: string; error: string }>;
}> {
  const results: { loaded: number; failed: Array<{ path: string; error: string }> } = {
    loaded: 0,
    failed: [],
  };

  if (!existsSync(scorersDir)) {
    log("warn", "scorer-registry", `Scorers directory does not exist: ${scorersDir}. Creating.`);
    mkdirSync(scorersDir, { recursive: true });
    return results;
  }

  const entries = readdirSync(scorersDir).filter(
    f => (f.endsWith(".js") || f.endsWith(".ts")) && !f.endsWith(".d.ts"),
  );

  for (const entry of entries) {
    const fullPath = join(scorersDir, entry);
    try {
      const mod = await import(fullPath);
      const plugin = mod.default;

      validateScorer(plugin, fullPath);

      if (scorers.has(plugin.id)) {
        throw new Error(
          `Duplicate scorer ID '${plugin.id}' — already loaded from ${scorers.get(plugin.id)!.sourcePath}`,
        );
      }

      scorers.set(plugin.id, {
        plugin,
        sourcePath: fullPath,
        loadedAt: new Date().toISOString(),
      });

      log("info", "scorer-registry", `Loaded scorer: ${plugin.id} v${plugin.version}`, {
        name: plugin.name,
        taskFamilies: plugin.taskFamilies,
      });
      results.loaded++;
    } catch (err) {
      const error = String((err as Error).message ?? err);
      log("error", "scorer-registry", `FAILED to load scorer: ${fullPath}`, { error });
      results.failed.push({ path: fullPath, error });
    }
  }

  return results;
}

// ─── Queries ───────────────────────────────────────────────────────

export function getScorer(id: string): ScorerPlugin | undefined {
  return scorers.get(id)?.plugin;
}

export function listScorers(): Array<{
  id: string;
  name: string;
  version: string;
  taskFamilies: string[];
  sourcePath: string;
}> {
  return [...scorers.values()].map(s => ({
    id: s.plugin.id,
    name: s.plugin.name,
    version: s.plugin.version,
    taskFamilies: s.plugin.taskFamilies,
    sourcePath: s.sourcePath,
  }));
}

export function findScorersForFamily(taskFamily: string): ScorerPlugin[] {
  return [...scorers.values()]
    .map(s => s.plugin)
    .filter(s => s.taskFamilies.includes(taskFamily) || s.taskFamilies.includes("*"));
}

/** Clear all loaded scorers (for testing) */
export function clearScorers(): void {
  scorers.clear();
}
