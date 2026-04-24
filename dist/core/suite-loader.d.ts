/**
 * Crucible — Suite Loader
 * Loads suite manifests with scoring weight defaults.
 */
import type { SuiteManifest, SuiteScoringWeights, FlakeDetectionConfig } from "../types/scores.js";
declare const DEFAULT_WEIGHTS: SuiteScoringWeights;
declare const DEFAULT_PASS_THRESHOLD = 0.6;
/**
 * Load a suite manifest by ID.
 */
export declare function loadSuite(suiteId: string): SuiteManifest | null;
/**
 * List all available suites.
 */
export declare function listSuiteManifests(): SuiteManifest[];
/**
 * Resolve effective scoring weights for a task.
 * Precedence: task-level > suite-level > defaults.
 */
export declare function resolveScoringWeights(taskWeights: SuiteScoringWeights | undefined, suiteId: string | undefined): SuiteScoringWeights;
/**
 * Resolve effective pass threshold.
 * Precedence: task-level > suite-level > defaults.
 */
export declare function resolvePassThreshold(taskThreshold: number | undefined, suiteId: string | undefined): number;
declare const DEFAULT_FLAKE_CONFIG: FlakeDetectionConfig;
/**
 * Resolve effective flake detection config for a suite.
 * Precedence: request override > suite-level > defaults.
 */
export declare function resolveFlakeConfig(suiteId: string | undefined, override?: Partial<FlakeDetectionConfig>): FlakeDetectionConfig;
/**
 * Compute confidence level from pass rate and flakiness.
 * - high: pass_rate == 1 and not flaky
 * - medium: pass_rate >= 0.7 or flaky_pass
 * - low: pass_rate < 0.7
 */
export declare function computeConfidence(passRate: number, isFlaky: boolean): "high" | "medium" | "low";
export { DEFAULT_WEIGHTS, DEFAULT_PASS_THRESHOLD, DEFAULT_FLAKE_CONFIG };
//# sourceMappingURL=suite-loader.d.ts.map