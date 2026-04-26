import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TaskManifest } from "../adapters/base.js";
import { hashOracleBytes, resolveOraclePath, verifyOracleIntegrity } from "./oracle.js";

export interface OracleHashIssue {
  task_id: string;
  manifest_path: string;
  oracle_path: string;
  status: string;
  expected: string | null;
  actual: string | null;
}

export interface OracleHashScanResult {
  scanned: number;
  updated: number;
  valid: number;
  issues: OracleHashIssue[];
}

function listManifestPaths(root = join(process.cwd(), "tasks")): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && entry.name === "manifest.json") out.push(path);
    }
  }
  walk(root);
  return out.sort();
}

function isRepoManifest(value: unknown): value is TaskManifest {
  return !!value && typeof value === "object" && "oracle_ref" in value && !("execution_mode" in value);
}

export function scanOracleHashes(options: { write?: boolean; root?: string } = {}): OracleHashScanResult {
  const result: OracleHashScanResult = { scanned: 0, updated: 0, valid: 0, issues: [] };
  for (const manifestPath of listManifestPaths(options.root)) {
    const manifestRaw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(manifestRaw) as unknown;
    if (!isRepoManifest(manifest)) continue;

    result.scanned += 1;
    const oraclePath = resolveOraclePath(manifest);
    let oracleRaw: string | null = null;
    try {
      oracleRaw = readFileSync(oraclePath, "utf-8");
    } catch {
      const integrity = verifyOracleIntegrity(manifest);
      result.issues.push({
        task_id: manifest.id,
        manifest_path: manifestPath,
        oracle_path: oraclePath,
        status: "missing",
        expected: integrity.oracle_hash_expected,
        actual: null,
      });
      continue;
    }

    const actual = hashOracleBytes(oracleRaw);
    if (manifest.oracle_ref.hash === "sha256:placeholder" && options.write) {
      manifest.oracle_ref.hash = actual;
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf-8");
      result.updated += 1;
    }

    const integrity = verifyOracleIntegrity(manifest, oracleRaw);
    if (integrity.oracle_hash_status === "valid") {
      result.valid += 1;
      continue;
    }

    result.issues.push({
      task_id: manifest.id,
      manifest_path: manifestPath,
      oracle_path: oraclePath,
      status: integrity.oracle_hash_status,
      expected: integrity.oracle_hash_expected,
      actual,
    });
  }
  return result;
}

