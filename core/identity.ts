/**
 * Luak — ID generation utilities
 *
 * Every server-visible identifier (run id, suite id, batch id, evidence
 * bundle id) used to be `${prefix}_${Date.now().toString(36)}` or worse,
 * `${prefix}_${ISO-date}_${task}_${model}`. Both shapes collide:
 *   - millisecond-precision timestamps collide for fast batches that share
 *     a tick (deterministic mocks, cached preflight, anything that returns
 *     202 in <1ms),
 *   - date/second-precision composite ids overwrite each other on disk when
 *     the same task+model runs more than once in the window.
 *
 * The collision footprint was real: a verification run of 17 conversational
 * tests on the same day produced one file on disk. This module gates every
 * id-mint behind a single helper that adds 4 bytes of crypto-random entropy
 * (8 hex chars), retries on a same-tick map collision, and exposes a small
 * `pickUniquePath` helper for callers that need on-disk uniqueness in
 * addition to in-memory uniqueness.
 */

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";

/**
 * Build a generic prefixed id of the form `${prefix}_${t36}_${rand}` where
 * `t36` is Date.now() in base 36 (cheap human-sortable readability for logs)
 * and `rand` is 8 hex chars from crypto-random bytes. The combined id is
 * unique with overwhelming probability even when Date.now() is frozen — 2^32
 * search space per tick.
 *
 * An optional `isTaken` callback retries up to a few times if the freshly
 * minted id already exists in some caller-owned map/path. Final fallback
 * widens the suffix to 16 hex chars (effectively unguessable collision).
 */
export function generatePrefixedId(prefix: string, isTaken?: (id: string) => boolean): string {
  for (let i = 0; i < 4; i++) {
    const id = `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
    if (!isTaken || !isTaken(id)) return id;
  }
  // Final fallback: 16-hex suffix. Statistically unreachable; logged by
  // callers if they want a record of the pressure.
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(8).toString("hex")}`;
}

/** Run id used by the HTTP /api/run endpoint to identify a single dispatch. */
export function generateRunId(isTaken?: (id: string) => boolean): string {
  return generatePrefixedId("run", isTaken);
}

/** Suite-run id (multi-task batch driven by /api/run-suite). */
export function generateSuiteRunId(isTaken?: (id: string) => boolean): string {
  return generatePrefixedId("suite", isTaken);
}

/** Batch id (multi-model batch driven by /api/run-batch). */
export function generateBatchId(isTaken?: (id: string) => boolean): string {
  return generatePrefixedId("batch", isTaken);
}

/**
 * Bundle id — what storeBundle writes on disk as `${bundle_id}.json`.
 *
 * Shape: `run_${YYYY-MM-DD}_${task_id}_${modelSlug}_${rand8}`. The
 * date/task/model prefix is preserved so a human scanning the runs dir can
 * still find a target task at a glance; the random suffix guarantees that
 * two runs of the same task+model on the same day never overwrite each
 * other on disk.
 *
 * If the runner already knows the HTTP `run_id`, callers SHOULD pass it
 * so the bundle records it (the bundle's `run_id` field is what
 * `getBundleByRunId` uses for /api/runs/<runId> hydration).
 */
export function generateBundleId(taskId: string, model: string, opts: { isTaken?: (id: string) => boolean; isoDate?: string } = {}): string {
  const date = (opts.isoDate ?? new Date().toISOString()).slice(0, 10);
  const modelSlug = model.replace(/[/:]/g, "-");
  for (let i = 0; i < 4; i++) {
    const id = `run_${date}_${taskId}_${modelSlug}_${randomBytes(4).toString("hex")}`;
    if (!opts.isTaken || !opts.isTaken(id)) return id;
  }
  return `run_${date}_${taskId}_${modelSlug}_${randomBytes(8).toString("hex")}`;
}

/**
 * Pick an on-disk path that does not yet exist. Use when a caller must
 * guarantee storeBundle never silently overwrites an existing artifact —
 * the random suffix means collisions are vanishingly rare, but the retry
 * loop is the durable guarantee.
 *
 * `build(suffix)` is called with an empty string on the first attempt and
 * with a short random hex on retries. Callers control the base shape.
 */
export function pickUniquePath(build: (suffix: string) => string): string {
  const first = build("");
  if (!existsSync(first)) return first;
  for (let i = 0; i < 6; i++) {
    const suffix = `_${randomBytes(3).toString("hex")}`;
    const candidate = build(suffix);
    if (!existsSync(candidate)) return candidate;
  }
  // Final fallback — wider entropy.
  return build(`_${randomBytes(8).toString("hex")}`);
}
