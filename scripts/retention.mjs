#!/usr/bin/env node
/**
 * Crucible retention CLI.
 *
 * Usage:
 *   npm run retention:dry-run                     — scan, report, delete nothing
 *   npm run retention:clean -- --confirm          — actually delete (still
 *                                                    requires CRUCIBLE_RETENTION_ENABLED=1 or --force)
 *   node scripts/retention.mjs --runs-dir <path>  — scan a custom dir
 *
 * Always prints a dry-run report first; deletion only proceeds when both
 * (a) retention is enabled and (b) the operator passes --confirm. Pass --force
 * to bypass the env check (useful for explicit operator intent in CI).
 */
import { runRetention, resolveRetentionConfig } from "/mnt/ai/crucible/dist/core/retention.js";

const args = new Set(process.argv.slice(2));
const dryRunFlag = args.has("--dry-run") || !args.has("--confirm");
const force = args.has("--force");
let runsDir = undefined;
const runsArgIdx = process.argv.findIndex((a) => a === "--runs-dir");
if (runsArgIdx !== -1) runsDir = process.argv[runsArgIdx + 1];

const cfg = resolveRetentionConfig();
const config = force ? { ...cfg, enabled: true } : cfg;

console.log(`Crucible retention — config:`);
console.log(`  enabled:                ${config.enabled}${force ? " (forced via --force)" : ""}`);
console.log(`  keep success days:      ${config.keepSuccessDays}`);
console.log(`  keep failed days:       ${config.keepFailedDays}`);
console.log(`  max run files:          ${config.maxRunFiles}`);
console.log(`  max bytes:              ${config.maxBytes.toLocaleString()} (${(config.maxBytes / (1024 ** 3)).toFixed(2)} GiB)`);
console.log(`  keep pinned:            ${config.keepPinned}`);
console.log(`  dry-run default:        ${config.dryRunDefault}`);
console.log(`  mode:                   ${dryRunFlag ? "DRY RUN (no files will be deleted)" : "CLEAN (will delete)"}`);
console.log("");

if (!dryRunFlag && !config.enabled && !force) {
  console.error("retention: refusing to delete — CRUCIBLE_RETENTION_ENABLED is not set and --force was not passed.");
  console.error("           pass --force to override, or set CRUCIBLE_RETENTION_ENABLED=1 in the environment.");
  process.exit(2);
}

const opts = { dryRun: dryRunFlag, config };
if (runsDir) opts.runsDir = runsDir;
const result = runRetention(opts);
const plan = result.plan;
const apply = result.apply;

console.log(`── Scan ──`);
console.log(`  root:                   ${plan.rootAbs}`);
console.log(`  files scanned:          ${plan.scan.totalFiles}`);
console.log(`  bytes scanned:          ${plan.scan.totalBytes.toLocaleString()} (${(plan.scan.totalBytes / (1024 ** 2)).toFixed(2)} MiB)`);
if (plan.scan.oldestMtimeMs) console.log(`  oldest:                 ${new Date(plan.scan.oldestMtimeMs).toISOString()}`);
if (plan.scan.newestMtimeMs) console.log(`  newest:                 ${new Date(plan.scan.newestMtimeMs).toISOString()}`);

// Group skip reasons
const skipByReason = new Map();
for (const s of plan.toSkip) skipByReason.set(s.reason, (skipByReason.get(s.reason) ?? 0) + 1);
console.log(`\n── Skipped (preserved) ──`);
for (const [reason, count] of skipByReason) console.log(`  ${reason.padEnd(22)} ${count}`);

console.log(`\n── Eligible for deletion ──`);
console.log(`  files:                  ${plan.toDelete.length}`);
console.log(`  bytes reclaimable:      ${plan.bytesReclaimable.toLocaleString()} (${(plan.bytesReclaimable / (1024 ** 2)).toFixed(2)} MiB)`);
if (plan.toDelete.length > 0) {
  const byReason = new Map();
  for (const d of plan.toDelete) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
  console.log(`  by reason:`);
  for (const [reason, count] of byReason) console.log(`    ${reason.padEnd(18)} ${count}`);
  console.log(`  first 20 paths:`);
  for (const d of plan.toDelete.slice(0, 20)) console.log(`    [${d.reason.padEnd(12)}] ${d.path}`);
  if (plan.toDelete.length > 20) console.log(`    … and ${plan.toDelete.length - 20} more`);
}

console.log(`\n── Apply ──`);
console.log(`  dry-run:                ${apply.dryRun}`);
console.log(`  deleted:                ${apply.deleted.length}`);
console.log(`  bytes reclaimed:        ${apply.bytesReclaimed.toLocaleString()} (${(apply.bytesReclaimed / (1024 ** 2)).toFixed(2)} MiB)`);
console.log(`  errors:                 ${apply.errors.length}`);
if (apply.errors.length > 0) for (const e of apply.errors) console.log(`    ERROR ${e.path}: ${e.error}`);

if (dryRunFlag) {
  console.log(`\n(dry-run) No files were deleted. Re-run with --confirm to actually delete.`);
}
process.exit(0);
