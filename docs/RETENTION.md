# Crucible artifact retention

Crucible writes every evidence bundle to disk, and the recent run-id /
bundle-id uniqueness fixes mean those bundles no longer overwrite each
other. That's correct for evidence integrity but it also means `runs/`
grows without bound over time — failed runs, smoke tests, UI repeats and
harness reports all accumulate. This document describes the opt-in cleanup
pass that keeps `runs/` bounded.

## Where artifacts live

| Path | What | Touched by retention? |
| --- | --- | --- |
| `runs/run_*.json` | Evidence bundles (success / fail / interrupted) | **yes**, eligible by age / count / bytes |
| `runs/run_*.hash` | Content-hash sidecar for each bundle | **yes**, deleted with parent bundle |
| `runs/run_*.crucible.json` | Validation-link sidecar (rare) | **yes**, deleted with parent bundle |
| `runs/_harness_report_*.json` | Harness CLI reports | **no**, always preserved |
| `runs/_*_full_api_report_*.json` | Operator custom reports | **no**, always preserved |
| `runs/ws_*/` | Workspace dirs (repo runs) | **no** (handled by `core/cleanup.ts`) |
| `state/server.log`, `state/auth-*` | Runtime state | **no** |
| `state/memory-sessions/*.json` | Cross-turn memory | **no** |

Retention only ever scans the runs directory (`CRUCIBULUM_RUNS_DIR`, default
`./runs`). It never reads or writes any other path, never follows symlinks,
and never traverses into subdirectories.

## What gets deleted

| Class | Deleted? |
| --- | --- |
| `bundle_success` | When older than `CRUCIBLE_RETENTION_KEEP_SUCCESS_DAYS` (default 14) |
| `bundle_failed` | When older than `CRUCIBLE_RETENTION_KEEP_FAILED_DAYS` (default 7) |
| `bundle_interrupted` | Same window as failed |
| `bundle_unknown` (unparseable JSON) | **Never** — may carry evidence we don't yet understand |
| Bundle marked `pinned: true` | **Never** (when `CRUCIBLE_RETENTION_KEEP_PINNED=true`, default) |
| Bundle whose `run_id` is in `activeRuns` | **Never** |
| Anything outside `runs/` | **Never** |
| Symlinks | **Never** (refused at scan time) |

Sidecars (`.hash`, `.crucible.json`) are deleted **with** their parent
bundle. An orphan sidecar (no matching bundle JSON) is preserved.

## Configuration

All knobs are env vars. Deletion is OFF by default; the CLI script always
starts in dry-run mode.

| Env var | Default | Effect |
| --- | --- | --- |
| `CRUCIBLE_RETENTION_ENABLED` | `false` | Master switch. The server's POST `/api/storage/cleanup` refuses to delete unless this is `1` (or the request body sets `force: true`). |
| `CRUCIBLE_RETENTION_DAYS` | `14` | Fallback retention window when the success/failed knobs are unset. |
| `CRUCIBLE_RETENTION_KEEP_SUCCESS_DAYS` | `14` | Days to keep passing bundles. |
| `CRUCIBLE_RETENTION_KEEP_FAILED_DAYS` | `7` | Days to keep failed / interrupted bundles. |
| `CRUCIBLE_RETENTION_MAX_RUN_FILES` | `2000` | Hard cap on bundle count. Oldest exceeds-cap bundles get evicted, regardless of age. |
| `CRUCIBLE_RETENTION_MAX_BYTES` | `1073741824` (1 GiB) | Hard cap on total bundle bytes. Oldest evictions walked until under cap. |
| `CRUCIBLE_RETENTION_KEEP_PINNED` | `true` | When true, bundles with `bundle.pinned === true` are never deleted. |
| `CRUCIBLE_RETENTION_DRY_RUN` | `true` | CLI default. The CLI script always honors this unless `--confirm` is passed. |

## How to run

### Dry run (always safe)

```bash
npm run retention:dry-run
```

This scans `runs/`, classifies every file, and prints the deletion plan and
skip list. **No files are deleted.** Output format:

```
Crucible retention — config:
  enabled:                false
  keep success days:      14
  keep failed days:       7
  max run files:          2000
  max bytes:              1,073,741,824 (1.00 GiB)
  keep pinned:            true
  dry-run default:        true
  mode:                   DRY RUN (no files will be deleted)

── Scan ──
  root:                   /…/crucible/runs
  files scanned:          488
  bytes scanned:          11,234,567 (10.71 MiB)
  oldest:                 2026-04-13T13:18:21.000Z
  newest:                 2026-05-23T11:54:06.000Z

── Skipped (preserved) ──
  recent                 470
  pinned                 0
  harness_report         5
  unknown_type           3

── Eligible for deletion ──
  files:                  20
  bytes reclaimable:      82,154 (0.08 MiB)
  by reason:
    age_success         12
    age_failed          8
  first 20 paths:
    [age_failed   ] /…/run_2026-05-02_code-001_x-ai-grok-4.3.json
    …
```

### Apply (requires explicit confirmation)

```bash
# Both flags required: enable retention, and pass --confirm.
CRUCIBLE_RETENTION_ENABLED=1 npm run retention:clean -- --confirm

# Or override the enabled-check explicitly (CI):
npm run retention:clean -- --confirm --force
```

### Custom directory

```bash
node scripts/retention.mjs --dry-run --runs-dir /path/to/runs
```

### Server API

The HTTP server exposes the same controls:

```bash
# Always-safe dry-run scan + plan summary.
curl -s http://localhost:18791/api/storage/status | jq

# Server-side cleanup (always dry-run unless body asks for confirm).
curl -s -X POST http://localhost:18791/api/storage/cleanup \
     -H 'content-type: application/json' \
     -d '{"confirm": true}'   # requires CRUCIBLE_RETENTION_ENABLED=1

# Bypass the env check for CI:
curl -s -X POST http://localhost:18791/api/storage/cleanup \
     -H 'content-type: application/json' \
     -d '{"confirm": true, "force": true}'
```

## When evidence has been retained away

`GET /api/runs/<run_id>` returns a structured 404 when the run id is one
the server has handed out but the bundle is no longer on disk:

```json
{
  "error": "Evidence removed by retention",
  "reason": "The bundle for this run is no longer on disk. Check retention settings or re-run.",
  "run_id": "run_mpil9wiw_19bcd1d8"
}
```

This distinguishes retention-driven misses from "the run never existed" and
prevents the UI from mistakenly reporting "Run stream interrupted" for a
run whose evidence was simply deleted.

## Recommended settings

### Local lab

```
# .env (local-lab defaults — retention disabled)
# Leave CRUCIBLE_RETENTION_ENABLED unset.
# Use `npm run retention:dry-run` periodically to see size.
```

### Local lab with active cleanup

```
CRUCIBLE_RETENTION_ENABLED=1
CRUCIBLE_RETENTION_KEEP_SUCCESS_DAYS=14
CRUCIBLE_RETENTION_KEEP_FAILED_DAYS=7
CRUCIBLE_RETENTION_MAX_RUN_FILES=2000
CRUCIBLE_RETENTION_MAX_BYTES=1073741824
CRUCIBLE_RETENTION_KEEP_PINNED=true
```

### Release / public-facing instances

Same as the local-lab-with-cleanup defaults. Retention is opt-in; the
release default is to keep everything until an operator turns it on.

## Recovery limitations

A deleted bundle is **gone**. The hash sidecar and validation link
sidecar are deleted with it. There is no trash directory and no undo.
`getBundleById` and `getBundleByRunId` will return `null`; the UI will
display "Evidence removed by retention" if the run id is recent enough to
still be in `activeRuns`, or a generic "Run not found" otherwise.

If you need to preserve a specific bundle, set `bundle.pinned = true` on
disk before running cleanup (and leave `CRUCIBLE_RETENTION_KEEP_PINNED=true`).
The retention plan classifies pinned bundles under the `pinned` skip reason
and never selects them for deletion.

## Implementation pointers

| File | Role |
| --- | --- |
| `core/retention.ts` | Scan, classify, plan, apply. Pure functions modulo fs reads/unlinks; no shared state. |
| `scripts/retention.mjs` | CLI driver. Always dry-run unless `--confirm` is passed. Requires `--force` or `CRUCIBLE_RETENTION_ENABLED=1` for actual deletes. |
| `server/routes/storage.ts` | HTTP endpoints (`GET /api/storage/status`, `POST /api/storage/cleanup`). |
| `server/routes/run.ts` (handleRunGet) | Retention-aware 404 for `/api/runs/<run_id>`. |
| `tests/retention.test.ts` | 16 regressions covering every invariant. |
