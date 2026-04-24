/**
 * Crucible — Oracle Loader
 * Loads oracle files for the Judge. NEVER exposed to agent runtime.
 */
import type { Oracle, TaskManifest } from "../adapters/base.js";
/**
 * Load oracle for a task. Only the Judge should call this.
 */
export declare function loadOracle(manifest: TaskManifest): Oracle;
/**
 * Compute oracle hash for integrity verification.
 */
export declare function hashOracle(oracle: Oracle): string;
//# sourceMappingURL=oracle.d.ts.map