/**
 * Luak — Storage / retention status routes
 *
 * Tiny surface so the UI (and operators) can see how big the runs dir has
 * grown and what retention would do without actually deleting anything.
 *
 * GET  /api/storage/status   → scan + planned-deletion summary (always
 *                              dry-run; never mutates the disk)
 * POST /api/storage/cleanup  → run retention. Refuses unless
 *                              CRUCIBLE_RETENTION_ENABLED is set OR the
 *                              caller passes `{"force": true}` in the body.
 *                              Defaults to dry-run; pass `{"confirm": true}`
 *                              to actually delete.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJSON, readBody, parseJsonBody } from "./shared.js";
import { resolveRetentionConfig, runRetention } from "../../core/retention.js";
import { activeRuns } from "./run.js";

function activeRunIdsSnapshot(): Set<string> {
  const set = new Set<string>();
  for (const [id, entry] of activeRuns) {
    if (entry.status === "running") set.add(id);
  }
  return set;
}

export async function handleStorageStatus(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  const config = resolveRetentionConfig();
  const run = runRetention({ dryRun: true, activeRunIds: activeRunIdsSnapshot(), config });
  sendJSON(res, 200, {
    config: {
      enabled: config.enabled,
      keep_success_days: config.keepSuccessDays,
      keep_failed_days: config.keepFailedDays,
      max_run_files: config.maxRunFiles,
      max_bytes: config.maxBytes,
      keep_pinned: config.keepPinned,
      dry_run_default: config.dryRunDefault,
    },
    scan: {
      root: run.plan.rootAbs,
      total_files: run.plan.scan.totalFiles,
      total_bytes: run.plan.scan.totalBytes,
      oldest_iso: run.plan.scan.oldestMtimeMs ? new Date(run.plan.scan.oldestMtimeMs).toISOString() : null,
      newest_iso: run.plan.scan.newestMtimeMs ? new Date(run.plan.scan.newestMtimeMs).toISOString() : null,
    },
    plan: {
      eligible_files: run.plan.toDelete.length,
      bytes_reclaimable: run.plan.bytesReclaimable,
      by_reason: countBy(run.plan.toDelete, (d) => d.reason),
      skip_by_reason: countBy(run.plan.toSkip, (s) => s.reason),
    },
  });
}

export async function handleStorageCleanup(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = await parseJsonBody<{ confirm?: boolean; force?: boolean }>(req);
  if (!parsed.ok) { sendJSON(res, 400, { error: parsed.error }); return; }
  const { confirm = false, force = false } = parsed.value ?? {};
  const config = resolveRetentionConfig();
  if (!confirm) {
    // Dry-run path — always safe.
    const run = runRetention({ dryRun: true, activeRunIds: activeRunIdsSnapshot(), config });
    sendJSON(res, 200, { dry_run: true, deleted: 0, bytes_reclaimed: 0, planned: run.plan.toDelete.length, planned_bytes: run.plan.bytesReclaimable });
    return;
  }
  if (!config.enabled && !force) {
    sendJSON(res, 403, {
      error: "retention not enabled",
      reason: "CRUCIBLE_RETENTION_ENABLED is not set; pass { force: true } to override.",
    });
    return;
  }
  const overrideCfg = force ? { ...config, enabled: true } : config;
  const run = runRetention({ dryRun: false, activeRunIds: activeRunIdsSnapshot(), config: overrideCfg });
  sendJSON(res, 200, {
    dry_run: false,
    deleted: run.apply.deleted.length,
    bytes_reclaimed: run.apply.bytesReclaimed,
    errors: run.apply.errors.length,
    planned: run.plan.toDelete.length,
  });
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
