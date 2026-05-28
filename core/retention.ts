/**
 * Luak — Evidence-artifact retention
 *
 * The runId+bundleId fixes mean every test now mints distinct files instead
 * of overwriting. That's correct for evidence integrity, but it also means
 * `runs/` grows without bound — failed runs, smoke tests, UI repeats and
 * harness reports all accumulate.
 *
 * This module is the opt-in cleanup pass that keeps `runs/` bounded. The
 * defaults are conservative: deletion is OFF unless the operator enables
 * it, dry-run is the default for the CLI script, and active runs +
 * explicitly-pinned bundles + unknown files are NEVER touched.
 *
 * Storage map (audit, 2026-05-23):
 *   runs/run_*.json                 evidence bundles (success/fail/interrupt)
 *   runs/run_*.hash                 content-hash sidecar for each bundle
 *   runs/run_*.crucible.json        validation-link sidecar (rare)
 *   runs/ws_<...>                   workspace dirs (handled by core/cleanup.ts)
 *   runs/_harness_report_*.json     harness CLI reports — kept by default
 *   runs/_*_full_api_report_*.json  operator custom reports — kept by default
 *   state/server.log, state/auth-*  runtime state — NEVER touched
 *   state/memory-sessions/*.json    cross-turn memory — NEVER touched
 *
 * Knobs (env, all optional — LUAK_* primary, CRUCIBLE_* still honored):
 *   LUAK_RETENTION_ENABLED        default: false
 *   LUAK_RETENTION_DAYS           default: 14
 *   LUAK_RETENTION_KEEP_SUCCESS_DAYS  default: 14
 *   LUAK_RETENTION_KEEP_FAILED_DAYS   default: 7
 *   LUAK_RETENTION_MAX_RUN_FILES  default: 2000
 *   LUAK_RETENTION_MAX_BYTES      default: 1073741824 (1 GiB)
 *   LUAK_RETENTION_KEEP_PINNED    default: true
 *   LUAK_RETENTION_DRY_RUN        default: true (CLI override only)
 */

import { readdirSync, statSync, readFileSync, unlinkSync, lstatSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { log } from "../utils/logger.js";
import type { EvidenceBundle } from "../adapters/base.js";

// ── Config ──────────────────────────────────────────────────────────────────

export interface RetentionConfig {
  enabled: boolean;
  /** Cap for any bundle if specific success/failed knobs aren't set. */
  defaultRetentionDays: number;
  keepSuccessDays: number;
  keepFailedDays: number;
  maxRunFiles: number;
  maxBytes: number;
  keepPinned: boolean;
  /** Tracked so explicit operator state shows up in logs and the status endpoint. */
  dryRunDefault: boolean;
}

function envRaw(name: string): string | undefined {
  // LUAK_* preferred; fall through to legacy CRUCIBLE_* if present.
  const luakName = name.replace(/^CRUCIBLE_/, "LUAK_");
  const luak = process.env[luakName];
  if (luak != null && luak !== "") return luak;
  return process.env[name];
}

function envInt(name: string, fallback: number): number {
  const raw = envRaw(name);
  if (raw == null || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = envRaw(name);
  if (raw == null) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

export function resolveRetentionConfig(): RetentionConfig {
  return {
    enabled: envBool("CRUCIBLE_RETENTION_ENABLED", false),
    defaultRetentionDays: envInt("CRUCIBLE_RETENTION_DAYS", 14),
    keepSuccessDays: envInt("CRUCIBLE_RETENTION_KEEP_SUCCESS_DAYS", 14),
    keepFailedDays: envInt("CRUCIBLE_RETENTION_KEEP_FAILED_DAYS", 7),
    maxRunFiles: envInt("CRUCIBLE_RETENTION_MAX_RUN_FILES", 2000),
    maxBytes: envInt("CRUCIBLE_RETENTION_MAX_BYTES", 1024 * 1024 * 1024),
    keepPinned: envBool("CRUCIBLE_RETENTION_KEEP_PINNED", true),
    dryRunDefault: envBool("CRUCIBLE_RETENTION_DRY_RUN", true),
  };
}

// ── Classification ──────────────────────────────────────────────────────────

export type ArtifactClass =
  | "bundle_success"        // evidence bundle, score.pass === true
  | "bundle_failed"         // evidence bundle, score.pass === false
  | "bundle_interrupted"    // minimal failure bundle (e.g. injection_detected)
  | "bundle_unknown"        // bundle JSON we couldn't read
  | "bundle_hash"           // .hash sidecar
  | "bundle_link"           // .crucible.json sidecar
  | "workspace_dir"         // ws_* directory (excluded — handled elsewhere)
  | "harness_report"        // _harness_report_*.json
  | "operator_report"       // other _*.json under runs/
  | "unknown";              // anything else — never eligible for deletion

export interface ArtifactEntry {
  path: string;
  name: string;
  classification: ArtifactClass;
  sizeBytes: number;
  mtimeMs: number;
  /** Parsed bundle metadata when classification is bundle_*. */
  metadata: {
    bundle_id?: string | undefined;
    run_id?: string | undefined;
    task_id?: string | undefined;
    model?: string | undefined;
    pass?: boolean | undefined;
    pinned?: boolean | undefined;
  } | null;
}

function classifyAndMeasure(rootAbs: string, name: string): ArtifactEntry | null {
  const fullPath = join(rootAbs, name);
  // lstat — never follow symlinks. Any symlink under runs/ is a configuration
  // mistake and we refuse to act on it.
  let st;
  try { st = lstatSync(fullPath); } catch { return null; }
  if (st.isSymbolicLink()) {
    return { path: fullPath, name, classification: "unknown", sizeBytes: 0, mtimeMs: st.mtimeMs, metadata: null };
  }

  if (st.isDirectory()) {
    if (name.startsWith("ws_")) {
      return { path: fullPath, name, classification: "workspace_dir", sizeBytes: 0, mtimeMs: st.mtimeMs, metadata: null };
    }
    return { path: fullPath, name, classification: "unknown", sizeBytes: 0, mtimeMs: st.mtimeMs, metadata: null };
  }

  if (!st.isFile()) return null;

  // Harness + operator reports — protected from age/count/bytes sweeps.
  if (name.startsWith("_harness_report_") && name.endsWith(".json")) {
    return { path: fullPath, name, classification: "harness_report", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }
  if (name.startsWith("_") && name.endsWith(".json")) {
    return { path: fullPath, name, classification: "operator_report", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }

  if (!name.startsWith("run_")) {
    return { path: fullPath, name, classification: "unknown", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }

  if (name.endsWith(".hash")) {
    return { path: fullPath, name, classification: "bundle_hash", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }
  if (name.endsWith(".crucible.json")) {
    return { path: fullPath, name, classification: "bundle_link", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }
  if (!name.endsWith(".json")) {
    return { path: fullPath, name, classification: "unknown", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }

  // Bundle JSON — peek at the score to choose success vs failed lane.
  let bundle: Partial<EvidenceBundle> | null = null;
  try {
    bundle = JSON.parse(readFileSync(fullPath, "utf-8")) as Partial<EvidenceBundle>;
  } catch {
    return { path: fullPath, name, classification: "bundle_unknown", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }
  if (!bundle || typeof bundle !== "object" || !bundle.bundle_id) {
    return { path: fullPath, name, classification: "bundle_unknown", sizeBytes: st.size, mtimeMs: st.mtimeMs, metadata: null };
  }
  const score = bundle.score as { pass?: boolean; integrity_violations?: number } | undefined;
  const failureMode = (bundle.diagnosis as { failure_mode?: string } | undefined)?.failure_mode ?? null;
  const interrupted = failureMode === "injection_detected" || failureMode === "interrupted";
  const passed = score?.pass === true;
  const classification: ArtifactClass = interrupted
    ? "bundle_interrupted"
    : passed
      ? "bundle_success"
      : "bundle_failed";
  const pinned = (bundle as { pinned?: boolean }).pinned === true;
  return {
    path: fullPath,
    name,
    classification,
    sizeBytes: st.size,
    mtimeMs: st.mtimeMs,
    metadata: {
      bundle_id: bundle.bundle_id,
      run_id: bundle.run_id ?? undefined,
      task_id: bundle.task?.id ?? undefined,
      model: bundle.agent?.model ?? undefined,
      pass: passed,
      pinned,
    },
  };
}

// ── Scan ────────────────────────────────────────────────────────────────────

export interface ScanResult {
  rootAbs: string;
  entries: ArtifactEntry[];
  totalFiles: number;
  totalBytes: number;
  oldestMtimeMs: number | null;
  newestMtimeMs: number | null;
}

function resolveRunsDir(override?: string): string {
  const raw = override ?? process.env["CRUCIBULUM_RUNS_DIR"] ?? join(process.cwd(), "runs");
  return resolve(raw);
}

export function scanRunsDir(opts: { runsDir?: string | undefined } = {}): ScanResult {
  const rootAbs = resolveRunsDir(opts.runsDir);
  let names: string[];
  try { names = readdirSync(rootAbs); }
  catch { return { rootAbs, entries: [], totalFiles: 0, totalBytes: 0, oldestMtimeMs: null, newestMtimeMs: null }; }

  const entries: ArtifactEntry[] = [];
  let totalBytes = 0;
  let oldest: number | null = null;
  let newest: number | null = null;
  for (const name of names) {
    const entry = classifyAndMeasure(rootAbs, name);
    if (!entry) continue;
    entries.push(entry);
    totalBytes += entry.sizeBytes;
    if (oldest == null || entry.mtimeMs < oldest) oldest = entry.mtimeMs;
    if (newest == null || entry.mtimeMs > newest) newest = entry.mtimeMs;
  }
  return { rootAbs, entries, totalFiles: entries.length, totalBytes, oldestMtimeMs: oldest, newestMtimeMs: newest };
}

// ── Plan (decide what to delete; no fs mutations) ───────────────────────────

export interface RetentionPlanOptions {
  config: RetentionConfig;
  /** Run ids currently in `activeRuns` — their bundle files are never eligible. */
  activeRunIds?: Set<string>;
  /** Override timestamp for deterministic tests. */
  nowMs?: number;
  /** Override runs dir for tests. */
  runsDir?: string;
}

export interface PlannedDeletion {
  path: string;
  name: string;
  classification: ArtifactClass;
  sizeBytes: number;
  ageDays: number;
  reason: "age_success" | "age_failed" | "max_files" | "max_bytes";
}

export interface PlannedSkip {
  path: string;
  name: string;
  classification: ArtifactClass;
  reason: "active_run" | "pinned" | "recent" | "unknown_type" | "harness_report" | "operator_report" | "workspace_dir" | "symlink_refused";
}

export interface RetentionPlan {
  rootAbs: string;
  scan: ScanResult;
  toDelete: PlannedDeletion[];
  toSkip: PlannedSkip[];
  bytesReclaimable: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildRetentionPlan(opts: RetentionPlanOptions): RetentionPlan {
  const scan = scanRunsDir({ runsDir: opts.runsDir });
  const nowMs = opts.nowMs ?? Date.now();
  const cfg = opts.config;
  const activeRunIds = opts.activeRunIds ?? new Set<string>();

  const toSkip: PlannedSkip[] = [];
  // Bundles + their sidecars are decided together: if a bundle is preserved
  // (or unknown), its hash/link sidecars are preserved too. If a bundle is
  // selected for deletion, sidecars are deleted with it.
  const bundleByBaseName = new Map<string, ArtifactEntry>();
  const sidecars = new Map<string, ArtifactEntry[]>(); // base bundle id → list of sidecars
  const orphans: ArtifactEntry[] = [];
  for (const entry of scan.entries) {
    if (entry.classification === "bundle_success" || entry.classification === "bundle_failed" || entry.classification === "bundle_interrupted" || entry.classification === "bundle_unknown") {
      const base = entry.name.replace(/\.json$/, "");
      bundleByBaseName.set(base, entry);
    }
  }
  for (const entry of scan.entries) {
    if (entry.classification === "bundle_hash") {
      const base = entry.name.replace(/\.hash$/, "");
      const list = sidecars.get(base) ?? [];
      list.push(entry);
      sidecars.set(base, list);
    } else if (entry.classification === "bundle_link") {
      const base = entry.name.replace(/\.crucible\.json$/, "");
      const list = sidecars.get(base) ?? [];
      list.push(entry);
      sidecars.set(base, list);
    } else if (
      entry.classification !== "bundle_success" &&
      entry.classification !== "bundle_failed" &&
      entry.classification !== "bundle_interrupted" &&
      entry.classification !== "bundle_unknown"
    ) {
      orphans.push(entry);
    }
  }

  // Step 1 — classify each bundle as eligible-for-age-deletion, preserved, or skipped-with-reason.
  interface BundleVerdict { entry: ArtifactEntry; eligible: boolean; ageDays: number; skipReason?: PlannedSkip["reason"]; deletionReason?: PlannedDeletion["reason"]; }
  const verdicts: BundleVerdict[] = [];
  for (const [, entry] of bundleByBaseName) {
    const ageDays = Math.floor((nowMs - entry.mtimeMs) / DAY_MS);
    // Active run guard — never touch the bundle for an in-flight run.
    if (entry.metadata?.run_id && activeRunIds.has(entry.metadata.run_id)) {
      verdicts.push({ entry, eligible: false, ageDays, skipReason: "active_run" });
      continue;
    }
    // Pinned guard.
    if (cfg.keepPinned && entry.metadata?.pinned === true) {
      verdicts.push({ entry, eligible: false, ageDays, skipReason: "pinned" });
      continue;
    }
    // Unknown bundles (couldn't be parsed) are NEVER deleted by default —
    // they may carry evidence we don't yet understand.
    if (entry.classification === "bundle_unknown") {
      verdicts.push({ entry, eligible: false, ageDays, skipReason: "unknown_type" });
      continue;
    }
    // Age policy.
    const successLimit = cfg.keepSuccessDays > 0 ? cfg.keepSuccessDays : cfg.defaultRetentionDays;
    const failedLimit = cfg.keepFailedDays > 0 ? cfg.keepFailedDays : cfg.defaultRetentionDays;
    const limitDays = entry.classification === "bundle_success" ? successLimit : failedLimit;
    if (ageDays >= limitDays) {
      const reason: PlannedDeletion["reason"] = entry.classification === "bundle_success" ? "age_success" : "age_failed";
      verdicts.push({ entry, eligible: true, ageDays, deletionReason: reason });
    } else {
      verdicts.push({ entry, eligible: false, ageDays, skipReason: "recent" });
    }
  }

  // Step 2 — apply max-file-count cap. Preserve newest first.
  verdicts.sort((a, b) => b.entry.mtimeMs - a.entry.mtimeMs);
  if (cfg.maxRunFiles > 0 && verdicts.length > cfg.maxRunFiles) {
    for (let i = cfg.maxRunFiles; i < verdicts.length; i++) {
      const v = verdicts[i]!;
      if (!v.eligible && !v.skipReason) {
        v.eligible = true;
        v.deletionReason = "max_files";
      } else if (!v.eligible && (v.skipReason === "recent")) {
        // Recent but over the cap — gets evicted by count.
        v.eligible = true;
        v.deletionReason = "max_files";
        delete v.skipReason;
      }
      // Pinned/active/unknown stay protected.
    }
  }

  // Step 3 — apply max-bytes cap. Walk oldest-first and evict eligible bundles
  // (plus their sidecars) until we're under the byte budget.
  if (cfg.maxBytes > 0) {
    const currentBundleBytes = verdicts.reduce((sum, v) => sum + v.entry.sizeBytes + (sidecars.get(v.entry.name.replace(/\.json$/, ""))?.reduce((s, e) => s + e.sizeBytes, 0) ?? 0), 0);
    if (currentBundleBytes > cfg.maxBytes) {
      // Oldest first.
      const oldestFirst = [...verdicts].sort((a, b) => a.entry.mtimeMs - b.entry.mtimeMs);
      let bytes = currentBundleBytes;
      for (const v of oldestFirst) {
        if (bytes <= cfg.maxBytes) break;
        if (v.skipReason === "active_run" || v.skipReason === "pinned" || v.skipReason === "unknown_type") continue;
        if (!v.eligible) {
          v.eligible = true;
          v.deletionReason = "max_bytes";
          delete v.skipReason;
        }
        bytes -= v.entry.sizeBytes;
        const sc = sidecars.get(v.entry.name.replace(/\.json$/, "")) ?? [];
        for (const s of sc) bytes -= s.sizeBytes;
      }
    }
  }

  // Step 4 — build the final lists.
  const toDelete: PlannedDeletion[] = [];
  for (const v of verdicts) {
    if (v.eligible && v.deletionReason) {
      toDelete.push({
        path: v.entry.path,
        name: v.entry.name,
        classification: v.entry.classification,
        sizeBytes: v.entry.sizeBytes,
        ageDays: v.ageDays,
        reason: v.deletionReason,
      });
      const sc = sidecars.get(v.entry.name.replace(/\.json$/, "")) ?? [];
      for (const s of sc) {
        toDelete.push({
          path: s.path,
          name: s.name,
          classification: s.classification,
          sizeBytes: s.sizeBytes,
          ageDays: Math.floor((nowMs - s.mtimeMs) / DAY_MS),
          reason: v.deletionReason,
        });
      }
    } else if (v.skipReason) {
      toSkip.push({ path: v.entry.path, name: v.entry.name, classification: v.entry.classification, reason: v.skipReason });
    }
  }
  for (const orphan of orphans) {
    let reason: PlannedSkip["reason"];
    switch (orphan.classification) {
      case "workspace_dir": reason = "workspace_dir"; break;
      case "harness_report": reason = "harness_report"; break;
      case "operator_report": reason = "operator_report"; break;
      case "bundle_hash":
      case "bundle_link":
        // Orphan sidecar (no matching bundle JSON). Keep — they're tiny and
        // may be the only proof a bundle existed.
        reason = "unknown_type";
        break;
      default: reason = "unknown_type";
    }
    if (orphan.classification === "unknown" && orphan.name.startsWith("ws_")) reason = "workspace_dir";
    toSkip.push({ path: orphan.path, name: orphan.name, classification: orphan.classification, reason });
  }

  // Safety: any path outside rootAbs gets refused. (lstat already refused
  // symlinks; this is the outer belt.)
  const filteredDelete: PlannedDeletion[] = [];
  for (const d of toDelete) {
    const norm = resolve(d.path);
    if (norm === scan.rootAbs || !norm.startsWith(scan.rootAbs + sep)) {
      toSkip.push({ path: d.path, name: d.name, classification: d.classification, reason: "symlink_refused" });
      continue;
    }
    filteredDelete.push(d);
  }

  const bytesReclaimable = filteredDelete.reduce((sum, d) => sum + d.sizeBytes, 0);
  return { rootAbs: scan.rootAbs, scan, toDelete: filteredDelete, toSkip, bytesReclaimable };
}

// ── Apply (perform deletions) ───────────────────────────────────────────────

export interface ApplyResult {
  deleted: string[];
  errors: Array<{ path: string; error: string }>;
  bytesReclaimed: number;
  /** True when this call ran in dry-run mode. No paths were unlinked. */
  dryRun: boolean;
}

export function applyRetentionPlan(plan: RetentionPlan, opts: { dryRun: boolean }): ApplyResult {
  const result: ApplyResult = { deleted: [], errors: [], bytesReclaimed: 0, dryRun: opts.dryRun };
  for (const d of plan.toDelete) {
    if (opts.dryRun) {
      result.deleted.push(d.path);
      result.bytesReclaimed += d.sizeBytes;
      continue;
    }
    // Final defensive check: must still be a regular file (not symlink, not
    // missing). lstat to refuse symlinks; size to record before unlink.
    let st;
    try { st = lstatSync(d.path); } catch (err) {
      result.errors.push({ path: d.path, error: String(err) });
      continue;
    }
    if (st.isSymbolicLink() || !st.isFile()) {
      result.errors.push({ path: d.path, error: "refused — not a regular file at delete time" });
      continue;
    }
    try {
      unlinkSync(d.path);
      result.deleted.push(d.path);
      result.bytesReclaimed += d.sizeBytes;
    } catch (err) {
      result.errors.push({ path: d.path, error: String(err) });
    }
  }
  log("info", "retention", `apply ${opts.dryRun ? "(dry-run) " : ""}deleted=${result.deleted.length} bytesReclaimed=${result.bytesReclaimed} errors=${result.errors.length}`);
  return result;
}

// ── High-level "run retention now" helper ───────────────────────────────────

export interface RetentionRun {
  config: RetentionConfig;
  plan: RetentionPlan;
  apply: ApplyResult;
  /** True iff a delete pass actually ran (config.enabled AND not dryRun). */
  deletedForReal: boolean;
}

export function runRetention(opts: { dryRun?: boolean; activeRunIds?: Set<string>; runsDir?: string; config?: RetentionConfig; nowMs?: number } = {}): RetentionRun {
  const config = opts.config ?? resolveRetentionConfig();
  const dryRun = opts.dryRun ?? !config.enabled;
  const plan = buildRetentionPlan({
    config,
    ...(opts.activeRunIds ? { activeRunIds: opts.activeRunIds } : {}),
    ...(opts.nowMs != null ? { nowMs: opts.nowMs } : {}),
    ...(opts.runsDir != null ? { runsDir: opts.runsDir } : {}),
  });
  const apply = applyRetentionPlan(plan, { dryRun });
  return { config, plan, apply, deletedForReal: !dryRun && config.enabled };
}
