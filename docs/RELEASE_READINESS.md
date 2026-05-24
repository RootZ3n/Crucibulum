# Crucible release readiness

This document defines what "release-ready" means for Crucible and how to
verify it. The bar is **evidence-driven**: every release-readiness claim
must point at a gauntlet report.

## Current release verdict

`FULL_RELEASE_READY = NO`.

The current evidence supports only `RELEASE_SCOPED_TO_CERTIFIED_TARGETS`.
That scope is limited to the platform/mock gate, representative repo-mode
smoke, and broad real-provider smoke for these release-target models:

| Provider | Adapter | Model | Certification scope |
| --- | --- | --- | --- |
| OpenRouter | `openrouter` | `deepseek/deepseek-v4-pro` | Broad real-provider smoke only |
| OpenRouter | `openrouter` | `xiaomi/mimo-v2.5-pro` | Broad real-provider smoke only |
| Ollama | `ollama` | `qwen3.5:9b` | Broad real-provider smoke only |

Visible UI providers or picker models outside that table are not
release-certified. Repo-mode evidence is representative, not exhaustive.
Automated UI shape checks pass, but manual/browser UI certification remains
open. Do not describe this candidate as unqualified `FULL_RELEASE_READY`.

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

### Real-provider profiles
Real-provider profiles are implemented in `scripts/release-gauntlet.mjs` and
must be run explicitly with `--real-provider`, `--provider`, `--model`, and a
cost cap for paid providers. They are intentionally separate from the mock
matrix to avoid spending API credit on every gauntlet run.

`reports/release-gauntlet/latest-real-provider.{json,md}` is only the most
recent single provider/model profile. It is **not** an aggregate certification
for all archived real-provider profiles.

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

## Release gates, all required

Release certification has distinct gates. All must pass before an unqualified
release tag.

| Gate | What it proves | How to run |
| --- | --- | --- |
| **Mock / platform layer** | Crucible's runner, bundle identity, SSE lifecycle, retention, classification all behave correctly under every failure shape we can simulate deterministically. | `npm run gauntlet:mock` |
| **Real-provider layer** | The same code paths still behave correctly against the actual providers Crucible ships against. Surfaces real-world provider quirks the mock can't reproduce (region routing, model availability, rate-limit shape). | `node scripts/release-gauntlet.mjs --real-provider …` |
| **Repo-mode layer** | Representative repo-mode tasks create isolated workspaces, produce diffs, pass through the deterministic judge, store bundles, hydrate by `run_id`, and leave source fixtures unchanged. | `node scripts/release-gauntlet.mjs --mock-only --repo-smoke --write-report` |
| **UI layer** | Browser/operator flow can select lanes/models, run batches, display cooldowns, open completed and failure evidence, survive refresh, and avoid catch-all leaks. | `node scripts/release-gauntlet.mjs --mock-only --ui-shape --write-report` plus `docs/UI_RELEASE_CERTIFICATION.md` |

**Mock pass alone is necessary but NOT sufficient.** Real-provider
profiles must also be archived before the release tag.

## Real-provider profiles (release targets)

The release set covers one cloud-routed mid-tier (DeepSeek), one cloud
direct-from-publisher mid-tier (Mimo), and one local provider (Ollama):

This is not a certification of every adapter registered in the repo, and it is
not a certification of every provider/model visible in the browser picker.
Provider/model visibility means "operator-selectable or discoverable"; it does
not mean "release-certified."

```bash
# 1. OpenRouter → DeepSeek V4 Pro
node scripts/release-gauntlet.mjs --real-provider \
    --provider openrouter --model deepseek/deepseek-v4-pro \
    --broad-smoke --max-cost-usd 1.00 --write-report

# 2. OpenRouter → Xiaomi Mimo v2.5 Pro
node scripts/release-gauntlet.mjs --real-provider \
    --provider openrouter --model xiaomi/mimo-v2.5-pro \
    --broad-smoke --max-cost-usd 1.00 --write-report

# 3. Local Ollama (currently armed)
node scripts/release-gauntlet.mjs --real-provider \
    --provider ollama --model qwen3.5:9b \
    --broad-smoke --write-report
```

Compact profiles drive:
1. Easy conversational test (`personality-001`, 3 questions).
2. Longer personality test (`personality-002`, 4 questions).
3. Multi-question stress (`role-stress-001`, 10 questions).
4. Repeat of test #1 — proves `run_id` / `bundle_id` uniqueness and that
   `/api/runs/<run_id>` hydration matches.

Broad profiles drive one representative smoke from each certified release
class where supported:
1. Personality (`personality-001`).
2. Role stress / prompt sensitivity (`role-stress-001`).
3. Safety / adversarial (`safety-001`).
4. Operational trust (`op-001`).
5. Repo/tool-calling (`tool-003`).

Reports archive under `reports/release-gauntlet/real-provider/<timestamp>-<provider>-<model>.{json,md}`
and the most recent run overwrites `reports/release-gauntlet/latest-real-provider.{json,md}`.

## Release states

| State | Requirement |
| --- | --- |
| `MOCK_READY` | Mock/platform gauntlet passes with 0 `FAIL_PRODUCT`, 0 unexplained `BLOCKED`, 0 catch-all leaks, clean source metadata. |
| `REAL_PROVIDER_COMPACT_READY` | Compact profiles are archived for every release-target provider/model; provider outages are classified honestly. |
| `REAL_PROVIDER_BROAD_READY` | Broad-smoke profiles are archived for every release-target provider/model with no `FAIL_PRODUCT`. |
| `REPO_MODE_CERTIFIED` | Repo-smoke report passes or repo-mode is explicitly excluded from the release scope. |
| `UI_CERTIFIED` | Automated UI-shape smoke passes and the manual browser checklist in `docs/UI_RELEASE_CERTIFICATION.md` is completed for the candidate. |
| `FULL_RELEASE_READY` | All states above are true, no stale/dirty-source reports, no overclaimed providers/models, and no unexplained `FAIL_CONFIG`/`BLOCKED`. |

## Current known gaps

- Repo-mode smoke is representative, not exhaustive: it covers three repo
  fixtures (`coord-001`, `spec-001`, `tool-003`) while 25 repo-mode tasks
  exist.
- Browser certification is not satisfied by source/static tests alone. The
  manual checklist must be completed for the release candidate.
- Only release-target providers/models are certified. Other exposed adapters
  and picker models remain `UNCERTIFIED_NOT_RELEASE_TARGET` unless a report
  says otherwise.
- Rate-limit and provider-error handling is bounded and covered by mock/source
  checks, and provider outages must remain `FAIL_PROVIDER` when classified
  honestly. That does not certify rate-limit behavior across every exposed
  provider/model; broad real-provider certification currently covers only the
  three release targets listed above.

## Current release status

| Gate | Status | Evidence |
| --- | --- | --- |
| `MOCK_READY` | **YES** | `reports/release-gauntlet/2026-05-24T00-28-43-441Z.{json,md}` — 49/49 PASS, 0 `FAIL_PRODUCT`, clean source metadata |
| `REAL_PROVIDER_BROAD_READY` | **YES FOR RELEASE TARGETS** | `reports/release-gauntlet/real-provider/2026-05-24T00-31-06-889Z-openrouter-deepseek-deepseek-v4-pro.{json,md}`, `2026-05-24T00-32-14-849Z-openrouter-xiaomi-mimo-v2.5-pro.{json,md}`, `2026-05-24T00-33-18-590Z-ollama-qwen3.5-9b.{json,md}` — each 5/5 PASS |
| `REPO_MODE_CERTIFIED` | **REPRESENTATIVE ONLY** | `reports/release-gauntlet/2026-05-24T00-28-57-869Z.{json,md}` — `coord-001`, `spec-001`, and `tool-003` repo-smoke PASS; 22 repo-mode tasks remain outside direct smoke coverage |
| `UI_CERTIFIED` | **NO — MANUAL BROWSER CHECKLIST FAILED** | `reports/release-gauntlet/2026-05-24T00-30-17-934Z.{json,md}` automated UI-shape checks PASS, but `reports/release-gauntlet/ui-manual/2026-05-24T00-53-44Z.md` found the browser UI does not make certified release scope visible/honest |
| `FULL_RELEASE_READY` | **NO — scoped certification only; UI blocker open** | Full release still requires completed browser/manual UI certification and either exhaustive repo-mode coverage or explicit release notes limiting repo-mode claims. |

Current audit verdict: **RELEASE_SCOPED_TO_CERTIFIED_TARGETS**, with
`UI_CERTIFIED = NO`. The evidence supports the deterministic platform gate,
representative repo-mode smoke, and broad real-provider smoke for the named
release targets:
OpenRouter/DeepSeek V4 Pro, OpenRouter/Xiaomi Mimo v2.5 Pro, and local
Ollama/qwen3.5:9b. It does not certify every exposed adapter, every picker
model, every repo-mode task, or the browser/operator workflow.

Manual UI certification was attempted in
`reports/release-gauntlet/ui-manual/2026-05-24T00-53-44Z.md` and stopped as
`FAIL_PRODUCT`: the browser UI did not visibly distinguish certified release
targets from other operator-selectable providers/models. Do not claim
`UI_CERTIFIED` or unqualified full release until that blocker is fixed and the
manual browser checklist is rerun.

The older archived compact DeepSeek run that included a
`FAIL_PROVIDER`/`NETWORK` health-check failure remains valid historical
evidence that provider outages are classified honestly and hydrate durable
failure evidence. It is not the current broad release-target result.

Re-run all gates and re-archive before every release tag. Do not claim
`FULL_RELEASE_READY` unless the UI manual checklist is completed and the release
notes explicitly scope any providers, models, or repo-mode tasks that remain
uncertified.

### How to verify the status above

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
report is committed and link it from CHANGELOG.md, but only for the specific
gate that report covers. A mock-only `YES` is not full release evidence.

If `NO`, the blockers list every reason. Fix them, re-run the gauntlet,
commit the new report. Do not edit the report to make it green.
