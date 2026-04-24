/**
 * Crucible — Oracle Loader
 * Loads oracle files for the Judge. NEVER exposed to agent runtime.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Oracle, TaskManifest } from "../adapters/base.js";
import { sha256Hex } from "../utils/hashing.js";
import { log } from "../utils/logger.js";

const ORACLES_DIR = join(process.cwd(), "oracles");

/**
 * Load oracle for a task. Only the Judge should call this.
 */
export function loadOracle(manifest: TaskManifest): Oracle {
  // Try oracle_ref path first (relative to manifest)
  const oraclePath = join(ORACLES_DIR, `${manifest.id}.oracle.json`);

  try {
    const raw = readFileSync(oraclePath, "utf-8");
    const oracle = JSON.parse(raw) as Oracle;

    if (oracle.task_id !== manifest.id) {
      throw new Error(`Oracle task_id mismatch: expected ${manifest.id}, got ${oracle.task_id}`);
    }

    // Verify hash if specified in manifest
    if (manifest.oracle_ref.hash && manifest.oracle_ref.hash !== "sha256:placeholder") {
      const computedHash = sha256Hex(raw);
      if (computedHash !== manifest.oracle_ref.hash) {
        log(
          "warn",
          "oracle",
          `Oracle hash mismatch for ${manifest.id} — manifest says ${manifest.oracle_ref.hash}, computed ${computedHash}`,
        );
      }
    }

    log("info", "oracle", `Loaded oracle: ${manifest.id}`);
    return oracle;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Oracle not found for task ${manifest.id}: ${oraclePath}`);
    }
    throw err;
  }
}

/**
 * Compute oracle hash for integrity verification.
 */
export function hashOracle(oracle: Oracle): string {
  return sha256Hex(JSON.stringify(oracle));
}
