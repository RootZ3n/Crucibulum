# Crucible release readiness

This document defines what "release-ready" means for Crucible and how to
verify it. The bar is **evidence-driven**: every release-readiness claim
must point at a gauntlet report.

## What must pass before release

The release-gauntlet must produce a report with:

| Counter | Required value |
|---|---|
| `PASS` | every probe |
| `FAIL_PRODUCT` | **0** |
| `BLOCKED` | 0 |
| `FAIL_CONFIG` | 0 unless explained in the report's notes column |
| `FAIL_PROVIDER` | 0 (mock matrix); explained per occurrence (real-provider runs) |
| `catch-all "Run stream interrupted"` leaks | 0 in any structured-cause scenario |
| `"Run state unreachable"` leaks | 0 in any scenario with retainable evidence |
| Dispatch-sweep regressions | 0 — every conversational task must dispatch and complete cleanly under the always-pass adapter |
| activeRuns GC fallback | PASS — `/status` and `/api/runs/<runId>` must work after eviction for every pre-execution-failure run |
| run-id identity sweep | PASS — 20 concurrent POSTs at frozen `Date.now()` produce 20 distinct ids |

## How to run

### Inventory only (no server boot, no cost)
```
node scripts/release-gauntlet.mjs --dry-run-inventory
```

Prints every family / task / adapter / model the gauntlet can drive.

### Mock-only (default; safe)
```
node scripts/release-gauntlet.mjs --mock-only --all-families --write-report
```

- Boots an HTTP server bound to localhost.
- Injects a controllable test adapter.
- Drives the scenario matrix + dispatch sweep + GC probe + identity probe + retention probe.
- Writes `reports/release-gauntlet/<timestamp>.{json,md}` and overwrites
  `latest.{json,md}`.

This is the canonical pre-release gate. **Run it before every release tag.**

### Targeted single family
```
node scripts/release-gauntlet.mjs --mock-only --family personality --write-report
```

### Real-provider profile (not implemented in this revision)
Real-provider exhaustive matrix is **not** part of this gauntlet. Capture
real-provider receipts with the existing harness CLI:

```
npm run harness -- --tab personality --adapter openrouter --model deepseek/deepseek-v4-pro
npm run harness -- --tab personality --adapter openrouter --model xiaomi/mimo-v2-pro
npm run harness -- --tab personality --adapter ollama --model <local-id>
```

Each command writes `runs/_harness_report_<timestamp>.json`. Copy or
symlink that file under `reports/release-gauntlet/real-provider/<adapter>-<model>-<timestamp>.json`
to keep the release archive complete.

Real-provider runs are intentionally separate from the mock matrix to avoid
spending API credit on every gauntlet run.

## Result taxonomy

The gauntlet classifies every probe into one of:

| Class | Meaning | Treatment |
|---|---|---|
| `PASS` | Contract satisfied. | Counts toward release readiness. |
| `FAIL_PRODUCT` | Crucible's product code broke an invariant. | **Release blocker.** |
| `FAIL_PROVIDER` | An external provider misbehaved (rate-limit, 5xx, timeout, etc.) in a way Crucible classified honestly. | Not a product blocker — but track in the report's notes. |
| `FAIL_CONFIG` | A manifest, env var, or local config is broken. | Block release; fix the manifest/config. |
| `SKIPPED_EXPLAINED` | Probe skipped on purpose (e.g., real-provider profile with no API key). | Allowed; must include the reason. |
| `BLOCKED` | Probe couldn't run because of a dependency failure earlier in the matrix. | Investigate the dependency. |

### What counts as `FAIL_PRODUCT`
- POST `/api/run` returning anything other than the expected status code for the scenario.
- SSE delivering no terminal frame inside the timeout window.
- Bundle expected on disk but missing.
- Bundle present but not hydratable by `run_id` via `/api/runs/<runId>`.
- SSE error frame with empty `classification`, `stage`, or `reason` when the scenario expected a structured cause.
- "Run stream interrupted — no evidence bundle produced" or "Run state unreachable" surfacing in any scenario that should produce a structured failure.
- run_ids colliding under same-millisecond load.
- `/status` returning 404 after `activeRuns` GC when a persisted bundle exists for the run.

### What is **not** a product failure
- Real provider returning 429 / 503 / timeout — Crucible's job is to *classify it honestly*, not to make the provider succeed.
- A model giving wrong answers — that's a model-quality finding, not a Crucible bug.
- Manifest defects — those classify as `FAIL_CONFIG`.

## Current known gaps

- Real-provider matrix is captured manually via the harness CLI and copied
  into `reports/release-gauntlet/real-provider/`. This isn't yet driven by
  the gauntlet script itself.
- Repo-mode tasks (orchestration, poison, spec, tool-calling) are not in
  the mock dispatch sweep — they need real workspaces that the mock adapter
  can't reproduce. They're covered by the existing scorer/runner tests in
  `npm test`.
- Browser-driven UI tests are not in the gauntlet. The UI-shape smokes
  (`tests/run-lifecycle.test.ts`, `tests/bundle-identity.test.ts`,
  `tests/role-stress-lifecycle.test.ts`, `tests/run-classification.test.ts`,
  `tests/rate-limit-flow.test.ts`, `tests/pre-execution-failure-bundle.test.ts`)
  cover the UI flow by driving the same HTTP path the browser uses.

## Current release status

Run the gauntlet and check `reports/release-gauntlet/latest.md`:

```
node scripts/release-gauntlet.mjs --mock-only --all-families --write-report
head -5 reports/release-gauntlet/latest.md
```

The first line of the body should read either:

> **Release-ready:** **YES** ✅

or

> **Release-ready:** **NO** ❌
>
> **Blockers:**
> - <count> FAIL_PRODUCT
> - …

If `YES`, the report is the durable evidence. Tag the release after the
report is committed and link it from CHANGELOG.md.

If `NO`, the blockers list every reason. Fix them, re-run the gauntlet,
commit the new report. Do not edit the report to make it green.
