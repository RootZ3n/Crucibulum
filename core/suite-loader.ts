/**
 * Luak — Suite Loader
 * Loads suite manifests with scoring weight defaults.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SuiteManifest, SuiteScoringWeights, FlakeDetectionConfig } from "../types/scores.js";
import { log } from "../utils/logger.js";
import { parseJsonSafe } from "../utils/json-safe.js";
import { isSafeId } from "../utils/safe-id.js";

const SUITES_DIR = process.env["CRUCIBULUM_SUITES_DIR"] ?? join(process.cwd(), "suites");

const DEFAULT_WEIGHTS: SuiteScoringWeights = {
  correctness: 0.40,
  regression: 0.25,
  integrity: 0.20,
  efficiency: 0.15,
};

const DEFAULT_PASS_THRESHOLD = 0.60;

/**
 * Load a suite manifest by ID.
 */
export function loadSuite(suiteId: string): SuiteManifest | null {
  // suiteId indexes into suites/<suiteId>.json — reject traversal. (Audit C5/H5.)
  if (!isSafeId(suiteId)) {
    log("warn", "suite-loader", `Rejecting unsafe suite id: ${String(suiteId).slice(0, 64)}`);
    return null;
  }
  const manifestPath = join(SUITES_DIR, `${suiteId}.json`);
  if (!existsSync(manifestPath)) {
    return null;
  }
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = parseJsonSafe<SuiteManifest>(raw);
    log("info", "suite-loader", `Loaded suite: ${suiteId}`);
    return manifest;
  } catch (err) {
    log("error", "suite-loader", `Failed to load suite ${suiteId}: ${String(err)}`);
    return null;
  }
}

/**
 * List all available suites.
 */
export function listSuiteManifests(): SuiteManifest[] {
  try {
    return readdirSync(SUITES_DIR)
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          return parseJsonSafe<SuiteManifest>(readFileSync(join(SUITES_DIR, f), "utf-8"));
        } catch (err) {
          // Surface corrupt/forged suite files instead of silently dropping
          // them. (Audit M7.)
          log("warn", "suite-loader", `Skipping unparseable/unsafe suite file ${f}: ${String(err).slice(0, 120)}`);
          return null;
        }
      })
      .filter((s): s is SuiteManifest => s !== null);
  } catch (err) {
    log("warn", "suite-loader", `Failed to list suites: ${String(err).slice(0, 120)}`);
    return [];
  }
}

/**
 * Resolve effective scoring weights for a task.
 * Precedence: task-level > suite-level > defaults.
 */
export function resolveScoringWeights(
  taskWeights: SuiteScoringWeights | undefined,
  suiteId: string | undefined,
): SuiteScoringWeights {
  // Start with defaults
  let suiteWeights: SuiteScoringWeights = { ...DEFAULT_WEIGHTS };

  // Try to load suite-level weights
  if (suiteId) {
    const suite = loadSuite(suiteId);
    if (suite?.scoring?.weights) {
      suiteWeights = { ...suite.scoring.weights };
    }
  }

  // Task-level weights override suite-level
  if (taskWeights) {
    return { ...suiteWeights, ...taskWeights };
  }

  return suiteWeights;
}

/**
 * Resolve effective pass threshold.
 * Precedence: task-level > suite-level > defaults.
 */
export function resolvePassThreshold(
  taskThreshold: number | undefined,
  suiteId: string | undefined,
): number {
  if (taskThreshold != null) return taskThreshold;

  if (suiteId) {
    const suite = loadSuite(suiteId);
    if (suite?.scoring?.pass_threshold != null) {
      return suite.scoring.pass_threshold;
    }
  }

  return DEFAULT_PASS_THRESHOLD;
}

const DEFAULT_FLAKE_CONFIG: FlakeDetectionConfig = {
  enabled: true,
  retries: 3,
};

/**
 * Resolve effective flake detection config for a suite.
 * Precedence: request override > suite-level > defaults.
 */
export function resolveFlakeConfig(
  suiteId: string | undefined,
  override?: Partial<FlakeDetectionConfig>,
): FlakeDetectionConfig {
  let config: FlakeDetectionConfig = { ...DEFAULT_FLAKE_CONFIG };

  if (suiteId) {
    const suite = loadSuite(suiteId);
    if (suite?.flake_detection) {
      config = { ...config, ...suite.flake_detection };
    }
  }

  if (override) {
    config = { ...config, ...override };
  }

  return config;
}

/**
 * Compute confidence level from pass rate and flakiness.
 * - high: pass_rate == 1 and not flaky
 * - medium: pass_rate >= 0.7 or flaky_pass
 * - low: pass_rate < 0.7
 */
export function computeConfidence(
  passRate: number,
  isFlaky: boolean,
): "high" | "medium" | "low" {
  if (passRate === 1 && !isFlaky) return "high";
  if (passRate >= 0.7 || (passRate >= 0.5 && isFlaky)) return "medium";
  return "low";
}

export { DEFAULT_WEIGHTS, DEFAULT_PASS_THRESHOLD, DEFAULT_FLAKE_CONFIG };
