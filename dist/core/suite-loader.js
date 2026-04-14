/**
 * Crucibulum — Suite Loader
 * Loads suite manifests with scoring weight defaults.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../utils/logger.js";
const SUITES_DIR = process.env["CRUCIBULUM_SUITES_DIR"] ?? join(process.cwd(), "suites");
const DEFAULT_WEIGHTS = {
    correctness: 0.40,
    regression: 0.25,
    integrity: 0.20,
    efficiency: 0.15,
};
const DEFAULT_PASS_THRESHOLD = 0.60;
/**
 * Load a suite manifest by ID.
 */
export function loadSuite(suiteId) {
    const manifestPath = join(SUITES_DIR, `${suiteId}.json`);
    if (!existsSync(manifestPath)) {
        return null;
    }
    try {
        const raw = readFileSync(manifestPath, "utf-8");
        const manifest = JSON.parse(raw);
        log("info", "suite-loader", `Loaded suite: ${suiteId}`);
        return manifest;
    }
    catch (err) {
        log("error", "suite-loader", `Failed to load suite ${suiteId}: ${String(err)}`);
        return null;
    }
}
/**
 * List all available suites.
 */
export function listSuiteManifests() {
    try {
        return readdirSync(SUITES_DIR)
            .filter(f => f.endsWith(".json"))
            .map(f => {
            try {
                return JSON.parse(readFileSync(join(SUITES_DIR, f), "utf-8"));
            }
            catch {
                return null;
            }
        })
            .filter((s) => s !== null);
    }
    catch {
        return [];
    }
}
/**
 * Resolve effective scoring weights for a task.
 * Precedence: task-level > suite-level > defaults.
 */
export function resolveScoringWeights(taskWeights, suiteId) {
    // Start with defaults
    let suiteWeights = { ...DEFAULT_WEIGHTS };
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
export function resolvePassThreshold(taskThreshold, suiteId) {
    if (taskThreshold != null)
        return taskThreshold;
    if (suiteId) {
        const suite = loadSuite(suiteId);
        if (suite?.scoring?.pass_threshold != null) {
            return suite.scoring.pass_threshold;
        }
    }
    return DEFAULT_PASS_THRESHOLD;
}
const DEFAULT_FLAKE_CONFIG = {
    enabled: true,
    retries: 3,
};
/**
 * Resolve effective flake detection config for a suite.
 * Precedence: request override > suite-level > defaults.
 */
export function resolveFlakeConfig(suiteId, override) {
    let config = { ...DEFAULT_FLAKE_CONFIG };
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
export function computeConfidence(passRate, isFlaky) {
    if (passRate === 1 && !isFlaky)
        return "high";
    if (passRate >= 0.7 || (passRate >= 0.5 && isFlaky))
        return "medium";
    return "low";
}
export { DEFAULT_WEIGHTS, DEFAULT_PASS_THRESHOLD, DEFAULT_FLAKE_CONFIG };
//# sourceMappingURL=suite-loader.js.map