/**
 * Crucible — Oracle Loader
 * Loads oracle files for the Judge. NEVER exposed to agent runtime.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { Oracle, TaskManifest } from "../adapters/base.js";
import { sha256Hex } from "../utils/hashing.js";
import { log } from "../utils/logger.js";

const ORACLES_DIR = join(process.cwd(), "oracles");
const HASH_RE = /^sha256:[0-9a-f]{64}$/;

export type OracleHashStatus = "valid" | "missing" | "mismatch" | "malformed" | "placeholder" | "not_required";

export interface OracleIntegrity {
  oracle_hash_verified: boolean;
  oracle_hash_status: OracleHashStatus;
  oracle_hash_expected: string | null;
  oracle_hash_actual: string | null;
}

export interface LoadedOracle {
  oracle: Oracle;
  integrity: OracleIntegrity;
}

function oracleIntegrity(status: OracleHashStatus, expected: string | null, actual: string | null): OracleIntegrity {
  return {
    oracle_hash_verified: status === "valid",
    oracle_hash_status: status,
    oracle_hash_expected: expected,
    oracle_hash_actual: actual,
  };
}

export function resolveOraclePath(manifest: TaskManifest): string {
  const refPath = manifest.oracle_ref?.path;
  const candidates = [
    refPath ? (isAbsolute(refPath) ? refPath : resolve(process.cwd(), refPath)) : "",
    refPath ? join(ORACLES_DIR, basename(refPath)) : "",
    join(ORACLES_DIR, `${manifest.id}.oracle.json`),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1] ?? join(ORACLES_DIR, `${manifest.id}.oracle.json`);
}

export function hashOracleBytes(raw: string | Buffer): string {
  return sha256Hex(raw);
}

export function verifyOracleIntegrity(manifest: TaskManifest, raw?: string | Buffer): OracleIntegrity {
  const expected = manifest.oracle_ref?.hash ?? null;
  const hashRequired = manifest.oracle_ref?.hash_required !== false;
  const actual = raw === undefined ? null : hashOracleBytes(raw);

  if (!hashRequired && !expected) {
    return oracleIntegrity("not_required", null, actual);
  }
  if (!expected) {
    return oracleIntegrity("missing", null, actual);
  }
  if (expected === "sha256:placeholder") {
    return oracleIntegrity("placeholder", expected, actual);
  }
  if (!HASH_RE.test(expected)) {
    return oracleIntegrity("malformed", expected, actual);
  }
  if (!actual) {
    return oracleIntegrity("missing", expected, null);
  }
  if (actual !== expected) {
    return oracleIntegrity("mismatch", expected, actual);
  }
  return oracleIntegrity("valid", expected, actual);
}

function assertOracleIntegrity(manifest: TaskManifest, integrity: OracleIntegrity): void {
  if (integrity.oracle_hash_status === "valid" || integrity.oracle_hash_status === "not_required") return;
  throw new Error(
    `Oracle hash verification failed for ${manifest.id}: ${integrity.oracle_hash_status}`
    + ` expected=${integrity.oracle_hash_expected ?? "null"} actual=${integrity.oracle_hash_actual ?? "null"}`,
  );
}

/**
 * Load oracle for a task. Only the Judge should call this.
 */
export function loadOracleWithIntegrity(manifest: TaskManifest): LoadedOracle {
  const oraclePath = resolveOraclePath(manifest);

  try {
    const raw = readFileSync(oraclePath, "utf-8");
    const integrity = verifyOracleIntegrity(manifest, raw);
    assertOracleIntegrity(manifest, integrity);

    const oracle = JSON.parse(raw) as Oracle;

    if (oracle.task_id !== manifest.id) {
      throw new Error(`Oracle task_id mismatch: expected ${manifest.id}, got ${oracle.task_id}`);
    }

    log("info", "oracle", `Loaded oracle: ${manifest.id}`);
    return { oracle, integrity };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      const integrity = verifyOracleIntegrity(manifest);
      throw new Error(`Oracle hash verification failed for ${manifest.id}: missing expected=${integrity.oracle_hash_expected ?? "null"} actual=null path=${oraclePath}`);
    }
    throw err;
  }
}

export function loadOracle(manifest: TaskManifest): Oracle {
  return loadOracleWithIntegrity(manifest).oracle;
}

/**
 * Compute oracle hash for integrity verification.
 */
export function hashOracle(oracle: Oracle): string {
  return sha256Hex(JSON.stringify(oracle));
}
