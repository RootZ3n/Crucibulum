# Crucible

Crucible turns model and agent trial outputs into auditable scoreboards, receipts, and comparison views.

It helps operators inspect observed behavior by task family, provider, model, adapter, and run evidence. Crucible is not a safety certification, not a universal model ranking, and not a replacement for Colosseum-style trial generation.

In the current release sequence, Crucible is the benchmark, scoreboard, and evidence-viewer layer. It can still run local harness flows for smoke testing and development, but its public role is to make existing run evidence understandable without overstating what the evidence can support.

## How Crucible Fits With The Other Tools

- **Colosseum** generates trial runs and receipts. Use it as the proving ground when you need to create fresh trial evidence.
- **Crucible** views, compares, scores, and explains run evidence. Use it to inspect receipts, compare models/providers/adapters, and understand why a run is or is not ranked.
- **Verum** is adversarial and probing-oriented. Its outputs can be normalized into Crucible score/evidence views when the integration path is used.
- **Aedis** is governed build orchestration. It can drive controlled workflows that later produce evidence for inspection.
- **Squidley Public** is the broader user-facing AI control surface. Crucible is one evidence and scoreboard layer inside that wider release path.
- **Crucibulum** appears in environment variables, schemas, and API names as the older/internal protocol name for Crucible-compatible run and score exchange. Public docs should treat it as compatibility naming, not a separate public product unless the project is split later.

## What Crucible Is / Is Not

Crucible is:

- a local scoreboard and evidence viewer
- a lane-scoped comparison UI
- a provenance and receipt inspection layer
- an observed-behavior comparison tool
- a way to preserve adapter/provider/model identity while reviewing results

Crucible is not:

- a universal model benchmark
- a safety certification
- proof that a model is safe
- a replacement for external audits
- a guarantee of local or cloud isolation
- the primary trial-generation harness when Colosseum owns that role

## Public Leaderboard Trust

Default public leaderboard views rank only verified eligible evidence bundles.

Tampered, forged, legacy, unsigned, unauthenticated, mock/demo, malformed, or otherwise unverified bundles are quarantined and are not ranked. Quarantined evidence may be inspected through safe metadata views such as `/api/leaderboard/quarantine`, but it is labeled `NOT RANKED` and does not influence default scores.

Local historical runs may exist in `runs/`. They are local state, ignored by git, and not treated as public leaderboard evidence unless they pass the current eligibility gate.

## First-Run Mental Model

A fresh checkout does not ship with public ranking data. The offline harness path uses the mock adapter for pipeline validation only; those results are deliberately quarantined from public rankings as mock/demo evidence. Live or imported evidence must be verified before it can appear in the default public leaderboard.

Current desktop and mobile screenshots are in `docs/screenshots/`. Additional GIFs are planned before the final public announcement.

## Evidence Model

Crucible is built around a narrow question: what did this model or agent do under a defined task, adapter, provider, and scoring policy, and what evidence supports that observation?

Crucible does not grade based on style, self-report, chain-of-thought, or polished explanations. It grades based on observable state:

- what files changed
- what tests passed or failed
- what integrity rules were violated
- how much time and step budget were used
- what the deterministic judge can verify from the workspace

The core trust model is simple:

- the agent never sees the oracle
- the deterministic judge is authoritative
- hidden checks and integrity checks drive scoring
- review models are advisory only
- bundles are signed and auditable

## What Crucible Does

Crucible ingests or creates model/agent run evidence, applies deterministic scoring where configured, and turns that evidence into local scoreboards, receipts, and comparison views.

In practice, that means it can:

- inspect run bundles and receipts
- compare models across task families and lanes
- show why evidence is eligible or quarantined
- run local smoke tasks against a model when needed
- run a local suite for development and regression checks
- compare multiple models across repeated runs
- score outcomes using hidden and public checks
- enforce integrity constraints like forbidden-path edits and anti-cheat patterns
- produce replayable, hash-verified evidence bundles
- expose results through a local API and UI
- add optional advisory review layers without weakening deterministic authority

## What Problem It Solves

A lot of model evaluation still collapses into one of these failure modes:

- benchmarks that reward explanation instead of execution
- public-only tasks that are easy to overfit
- systems that trust the agent's own story about what happened
- leaderboards that show scores without evidence
- review layers that quietly blur interpretation with authority

Crucible is designed against that.

It treats evaluation as an evidence problem. The key question is not "did the model say the right thing?" It is "what behavior was observed, under what conditions, and can the evidence be inspected independently?"

## How It Works

At a high level, Crucible follows this pipeline:

1. Load a task manifest.
2. Filter the manifest for the agent so the rubric and oracle stay hidden.
3. Create an isolated workspace from the task repo.
4. Execute the selected adapter/model in that workspace.
5. Record timeline and filesystem evidence.
6. Collect the diff.
7. Run integrity and security checks.
8. Judge the outcome deterministically with oracle-backed checks.
9. Build a signed evidence bundle.
10. Optionally run advisory review layers on sanitized evidence only.

The implementation is centered on a three-box model:

- `Runner`: orchestration, workspace setup, adapter execution, bundle assembly
- `Observer`: timeline and file activity capture
- `Judge`: deterministic scoring from evidence, oracle checks, and integrity rules

The principle behind the system is explicit in the code:

- score is based on observable state transitions
- narration is not trusted
- the deterministic judge is the authoritative scoring source for configured checks

## Benchmark Coverage

The current repo contains both repo-execution tasks and conversational tasks.

Repo task families:

- `poison_localization`
- `spec_discipline`
- `orchestration`

Conversational task families currently present in the corpus:

- `identity`
- `truthfulness`
- `classification`
- `code`
- `workflow`
- `instruction-obedience`
- `personality`
- `prompt-sensitivity`
- `role-stress`
- `context-degradation`
- `reasoning`
- `summarization`
- `thinking-mode`
- `token-efficiency`

This means Crucible can inspect both execution behavior and chat behavior. The current taxonomy is release-candidate level and versioned, but it should still be cited with the repository commit, task IDs, and scoring policy used for a given comparison. The test corpus is lightweight by design (intentional minimum for bootstrap); use `npm run oracle:hash -- --write` after adding oracles to register them in the corpus.

## Scoring Model

Crucible judges runs in a fixed order:

1. Integrity
2. Correctness
3. Regression
4. Efficiency

This ordering matters.

Integrity runs first because some failures should hard-fail the run regardless of downstream test outcomes. Examples include:

- forbidden path edits
- anti-cheat patterns
- integrity-rule violations from the oracle

Correctness and regression are then judged using hidden and public checks. Efficiency measures how expensive the run was relative to the task budget.

The result is a structured score with:

- total score
- score breakdown
- pass/fail
- pass threshold
- integrity violation count
- failure taxonomy

Public API and leaderboard scores are expressed as `0-100` percentages.

Internal bundles currently retain `0-1` fractional totals for backward compatibility, but they now also include explicit percent mirrors and a score-scale marker. That distinction is temporary and documented in [docs/scoring.md](docs/scoring.md).

## Evidence and Bundles

Every run produces an evidence bundle. The bundle is the core artifact of the system.

A bundle contains:

- task identity and manifest hash
- target model, provider, and adapter
- environment metadata
- timeline of observed actions
- diff evidence
- security metadata
- verification results
- deterministic score
- usage and cost estimates
- trust metadata
- diagnosis metadata
- optional advisory review results

Bundles are hash-signed so the result can be verified later. The API also produces structured summaries for downstream consumers.

This is important because Crucible is not just trying to emit a score. It is trying to emit a score with an audit trail.

## Security and Trust Model

Crucible assumes prompt injection is a system problem, not just a model problem.

That means:

- task text can be malicious
- repo files can be malicious
- diffs and logs can be malicious
- model outputs can be malicious
- review-layer outputs can be malicious

The system therefore maintains explicit trust boundaries:

Trusted:

- deterministic judge results
- hidden oracle data
- benchmark provenance: source, public/private status, oracle visibility, gold-solution visibility, contamination risk, and known scoring limitations
- integrity checks
- system metadata

Untrusted:

- task repo files
- diffs
- logs
- test output
- agent output
- review model output

Recent hardening added a Velum-style review defense layer:

- review input sanitization before any model-assisted review call
- prompt hardening that tells review models they are not authoritative
- strict JSON-only output validation
- advisory-only review status and disagreement signals
- review security telemetry in bundles, summaries, and receipts

Review models may summarize, flag concerns, or recommend reruns. They may not override scoring, mutate pass/fail, or rewrite authoritative evidence.

## Review Layer

Crucible supports optional review layers such as:

- Second Opinion
- QC Review

These are intentionally non-authoritative.

Their role is to help surface:

- suspicious patterns
- possible false passes or false fails
- flaky-looking outcomes
- reasons a human may want to inspect a run

They do not change:

- deterministic pass/fail
- score breakdown
- hidden/public test outcomes
- integrity verdicts
- bundle evidence

Review inputs are sanitized and structured before model calls. Review outputs are schema-validated and fail closed on malformed output.

### Default Judge Model

The advisory model judge defaults to **OpenRouter `xiaomi/mimo-v2-pro`** (closest registered identifier for the Xiaomi MiMo V2.5 Pro line). Configure via `OPENROUTER_API_KEY`. Override with:

- `CRUCIBLE_JUDGE_PROVIDER` — provider id (default `openrouter`)
- `CRUCIBLE_JUDGE_MODEL` — model id (default `xiaomi/mimo-v2-pro`)

Fallback: when the configured judge provider is unreachable, only the deterministic scorer runs and the model judge is recorded as `judge_usage.kind = "skipped"`. The run is never silently re-routed to a different model.

Each bundle records both costs separately:

- `usage` — tested-model token / cost spend
- `judge_usage` — judge-model token / cost spend, with `kind: "deterministic" | "model" | "skipped"`

## QA Harness

The QA harness walks every tab/lane, runs every test through the full pipeline, and emits a machine-readable report agents like Ricky and Ptah can consume.

```bash
npm run harness                                # offline mock adapter, every lane
npm run harness -- --tab personality           # only the Personality lane
npm run harness -- --task personality-002      # one test by id
npm run harness -- --live                      # use the configured judge model
                                               # (OpenRouter MiMo by default;
                                               #  needs OPENROUTER_API_KEY)
npm run harness -- --enable-judge              # also run the model judge layer
```

Per-test it records: `manifest_loaded`, `request_sent`, `response_received`, `judge_ran`, `bundle_stored`, `ui_summary_well_formed`, `drilldown_evidence_present`, plus tested-model and judge-model token + cost split. The report is written to `runs/_harness_report_<timestamp>.json`.

Exit codes: `0` clean, `1` test failures only, `2` pipeline breakage, `3` conversational task incomplete (verdict neither PASS nor FAIL).

## Adapters and Providers

Crucible is meant to evaluate models through adapters rather than binding itself to a single provider.

The repo already supports a provider-first flow through adapters and exposes provider/model metadata in the bundle and API. Supported adapters/providers currently include:

- `ollama`
- `anthropic`
- `openai`
- `openrouter`
- `openclaw`
- `claudecode`
- `squidley`
- `grimoire-cc`
- `grimoire-codex`
- `minimax`
- `zai`
- `google`

That means you can compare:

- local setups
- hosted APIs
- agent wrappers
- different execution systems

without losing track of who actually ran the task and under what identity.

## Methodology and Trust Docs

Crucible is being documented as a public audit and evidence-inspection system rather than only a codebase. Start here:

- [docs/methodology.md](docs/methodology.md)
- [docs/scoring.md](docs/scoring.md)
- [docs/versioning.md](docs/versioning.md)
- [docs/reproducibility.md](docs/reproducibility.md)

## UI and API

Crucible includes a local API and browser UI for inspecting runs, receipts, bundles, quarantined evidence, and comparisons.

The API exposes:

- tasks
- suites
- adapters
- providers
- runs
- summaries
- receipts
- stats
- compare views
- leaderboard quarantine metadata

The UI is there to make evidence inspection practical, but the trust model does not depend on the UI. The source of record remains the bundle and the deterministic judge output.

## Install

Requirements:

- Node.js 20 or newer
- npm 10 or newer
- Git, if you are cloning from source

This release has been verified on Linux with Node `v22.22.2` and npm `10.8.2`. Linux, macOS, and WSL2 are the intended first-run environments. Native Windows PowerShell commands are documented, but native Windows has not been fully verified for this release.

### Distribution Status

`v0.1.0` is **source-install only**. Clone the repo and run `npm ci && npm run build` from a checkout. Packaged installers are planned but not shipped yet:

- **npm package**: not published — install from the repo
- **Standalone binary**: not available
- **Docker image**: not published
- **OS installers (deb/rpm/msi/pkg)**: not available

The `crucible.service` file is a systemd example for advanced Linux operators only; it is not required for the local quickstart.

Install dependencies and build:

```bash
npm ci
npm run build
```

If anything fails, run `npm run doctor` for a read-only diagnostic of Node/npm versions, build artifacts, and required directories.

## First 5 Minutes

If you have never run Crucible before and just want to see it work, do this in order. It uses no API keys, no provider accounts, and no network calls beyond `npm ci`.

```bash
git clone <this-repo>
cd crucible
npm ci
npm run build
npm run smoke
npm run serve
```

Expected outcome:

1. `npm run smoke` finishes with `Smoke passed.` This proves the deterministic offline pipeline works on your machine.
2. `npm run serve` prints a banner that ends with `Crucible server running on http://127.0.0.1:18795` and `UI: http://127.0.0.1:18795/`.
3. Open `http://127.0.0.1:18795/` in your browser. You will see the Crucible UI shell.
4. The default public leaderboard view will be **empty**. That is expected on a fresh checkout — Crucible only ranks **verified eligible bundles**, and the smoke test produces deliberately quarantined mock/demo evidence. Empty here means "nothing has earned a public rank yet," not "broken."
5. Quarantined / mock-or-demo evidence (including the smoke output) is visible from `/api/leaderboard/quarantine` and is labeled `NOT RANKED`. That is the correct first-run state.
6. Stop the server with `Ctrl+C`. Run `npm run clean:state -- --confirm` if you want to wipe local runs and the auto-generated auth token before continuing.

You are now ready to import real evidence (see "Adding Tasks and Adapters") or run a live adapter (see "Live Adapter Setup").

## Public Quick Start

Linux, macOS, or WSL2:

```bash
# Install and compile
npm ci
npm run build

# Run the deterministic offline smoke test
npm run smoke

# Start the local API / UI
npm run serve
```

Windows PowerShell:

```powershell
# Install and compile
npm ci
npm run build

# Run the deterministic offline smoke test
npm run smoke

# Start the local API / UI
npm run serve
```

Expected smoke output includes:

```text
Crucible smoke test: deterministic offline mock run.
Crucible Harness - MOCK adapter
Tests:    1 passed / 0 failed (1 total)
Smoke passed.
```

The smoke path uses a deterministic mock adapter and writes temporary smoke state under the operating system temp directory. It does not require provider API keys, Colosseum, Squidley, private services, or pre-existing `runs/` data. Smoke output is mock/demo evidence and is excluded from public ranking.

By default, a fresh checkout has no verified public ranking data. The leaderboard may be empty until you import or generate verified eligible evidence. Old local runs do not silently become public rankings; tampered, unsigned, legacy, mock/demo, malformed, or unverified bundles are quarantined and labeled `NOT RANKED`.

`npm run serve` binds to `127.0.0.1` by default and prints the UI URL:

```text
Crucible server running on http://127.0.0.1:18795
UI: http://127.0.0.1:18795/
API: http://127.0.0.1:18795/api/
```

Set `CRUCIBLE_PORT` to use a different port. Set `CRUCIBLE_HOST=0.0.0.0` only when you intentionally want the server reachable beyond the local machine and have reviewed `SECURITY.md`.

To stop the server, press `Ctrl+C` in the terminal where it is running. There is no separate stop command. State written to `runs/` and `state/` persists across restarts; use `npm run clean:state -- --confirm` to clear it.

## How Auth Works

Crucible authenticates every API call. It is built around a single token and a loopback exemption:

- **Loopback (default):** when the server binds to `127.0.0.1` (the default), connections from the same machine are auto-authenticated. You do not need to paste a token to use the local UI in your browser. This behavior is controlled by `CRUCIBLE_ALLOW_LOCAL` (default `true`).
- **Remote / mobile / proxy:** any client that is not on loopback must send `Authorization: Bearer <token>`. On first start, Crucible auto-generates a token and persists it to `state/auth-token` (mode 0600). The token is printed once in the startup banner so you can paste it into a remote/mobile client.
- **Override:** set `CRUCIBLE_API_TOKEN` to use your own token instead of the auto-generated one.
- **Rotate:** delete `state/auth-token` and restart. A new token will be generated.
- **Sessions:** the loopback `bootstrap-local` and pairing flows issue session tokens for paired clients. The master token still works as a fallback.

All leaderboard and score-query endpoints require auth even on loopback when `CRUCIBLE_ALLOW_LOCAL=false`. Unauthenticated requests get a `401 Unauthorized` JSON response.

## Setting CRUCIBLE_HMAC_KEY

Crucible signs every evidence bundle with HMAC-SHA-256. The signing key is `CRUCIBLE_HMAC_KEY`. Without it:

- bundles are still produced, but their `bundle_signature_status` is `unsigned_key_missing`;
- the public leaderboard quarantines those bundles and labels them `NOT RANKED`;
- the server prints a startup warning so you do not silently produce unrankable evidence.

To set a key for local development:

```bash
# Linux / macOS / WSL2
export CRUCIBLE_HMAC_KEY="$(openssl rand -hex 32)"
npm run serve
```

```powershell
# Windows PowerShell
$env:CRUCIBLE_HMAC_KEY = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
npm run serve
```

Or persist it in `.env` (copy from `.env.example`). Treat the key as a secret: anyone who has it can sign bundles that the server will accept as authentic. **Changing or losing the key invalidates existing bundles** — the leaderboard will move them to quarantine. For a single-operator local install, that is fine; for shared evidence, pick a key once and keep it.

## Common Commands

```bash
# Type-check without emitting build output
npm run typecheck

# Build
npm run build

# Run the full test suite
npm test

# Run deterministic offline smoke
npm run smoke

# Run the release verification bundle
npm run verify:release

# Check npm advisories at moderate severity and above
npm run audit:release

# Verify oracle hashes
npm run oracle:hash -- --check

# Read-only environment audit (Node version, build artifacts, env vars)
npm run doctor

# Preview which local directories will be deleted (no-op without --confirm)
npm run clean:state
```

Live adapter examples:

```bash
# Offline pipeline validation only. This is mock mode, not model evidence.
npm run harness -- --task safety-001

# OpenRouter live run. May incur provider cost.
export OPENROUTER_API_KEY=...
npm run harness -- --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001

# MiniMax direct live run. May incur provider cost.
export MINIMAX_API_KEY=...
npm run harness -- --adapter minimax --model MiniMax-M2.7 --task safety-001

# Tune conservative live-call resilience.
npm run harness -- --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001 --retries 2 --timeout-ms 120000

# Verify a stored evidence bundle
npm run cli -- verify run_2026-04-05_poison-001_gemma4
```

Crucible is an evidence viewer and local evaluation layer, not a guarantee of model safety. Passing a task means the model passed that task under this harness, with this adapter, at that time. It does not show that the model is universally safe or reliable.

Mock mode is for offline pipeline validation only. Mock results must not be cited as live model evidence.

## Clearing Local State

Crucible writes local runs and state to ignored directories by default:

- `runs/` for generated evidence bundles and harness reports
- `state/` for auth/session/provider registry data

To clear local/demo state, stop the server first, then run:

```bash
# Preview what would be deleted (safe; reports paths only)
npm run clean:state

# Actually delete runs/ and state/
npm run clean:state -- --confirm
```

`clean:state` only touches those two directories under the repo root. It does not delete imported evidence stored elsewhere, tasks, oracles, or your `.env`. You can still remove the directories manually with your file manager or shell — the script just gives you a portable, scriptable, opt-in option.

## Troubleshooting First Run

Run `npm run doctor` first — it is read-only and reports most common issues.

- **Port already in use:** run with a different port, for example `CRUCIBLE_PORT=18895 npm run serve` on Linux/macOS/WSL2 or `$env:CRUCIBLE_PORT=18895; npm run serve` in PowerShell. The default port is `18795`.
- **`node: command not found` or wrong Node version:** Crucible requires Node 20+. Check with `node --version`. Install from [nodejs.org](https://nodejs.org/) or your package manager. `nvm install 22 && nvm use 22` works on Linux/macOS/WSL2.
- **`npm: command not found`:** npm ships with Node. If `node` works but `npm` does not, your Node install is broken — reinstall from the official source.
- **Windows execution policy blocks `npm`:** PowerShell may refuse to run npm shims with `cannot be loaded because running scripts is disabled on this system`. Fix once per user: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Use Windows Terminal (PowerShell 7+) for the commands in this README; cmd.exe is not tested.
- **Empty leaderboard / "I see no data":** this is the correct fresh-checkout state. Default leaderboards rank only verified eligible evidence. Smoke output is mock/demo and is deliberately quarantined. Inspect `/api/leaderboard/quarantine` to confirm the data is there but `NOT RANKED`.
- **`CRUCIBLE_HMAC_KEY is not set` warning:** expected on a first local run. Bundles you generate without a key will be quarantined as `unsigned_key_missing`. Set the key (see "Setting CRUCIBLE_HMAC_KEY") before generating evidence you intend to publish.
- **`Unauthorized` / 401 on `/api/...`:** you are hitting the API from outside loopback (remote machine, container, mobile, reverse proxy). Send `Authorization: Bearer <token>` using the token printed in the server startup banner or the value at `state/auth-token`. The browser UI on the same machine never needs a token.
- **Lost the auth token:** delete `state/auth-token` and restart the server — a new one prints in the startup banner. Or set `CRUCIBLE_API_TOKEN` to a value you choose.
- **Malformed or tampered runs:** Crucible quarantines them. Inspect safe metadata at `/api/leaderboard/quarantine`; do not cite them as public leaderboard evidence.
- **Live adapter fails with "missing key":** offline `npm run smoke` needs no provider keys. Live adapters fail loudly and name the required key, such as `OPENROUTER_API_KEY` or `MINIMAX_API_KEY`.
- **PowerShell path issues:** use npm scripts (`npm run smoke`, `npm run serve`, `npm run harness -- --task safety-001`) instead of invoking files under `dist/` directly.
- **`npm ci` fails on registry / EAI_AGAIN / 403:** corporate proxies and outdated certificates are the usual cause. Try `npm config get registry` (should be `https://registry.npmjs.org/`), clear with `npm cache clean --force`, and rerun. `npm audit` warnings during install are advisory; `npm ci` will still complete.
- **Need to start fresh:** stop the server, then `npm run clean:state -- --confirm` removes `runs/` and `state/`. This wipes generated bundles, the auth token, and the local provider registry. It does not touch tasks, oracles, or imported evidence stored elsewhere.
- **Need remote access:** default binding is local-only. Set `CRUCIBLE_HOST=0.0.0.0` deliberately, configure auth, and read `SECURITY.md` first.

## Live Adapter Setup

OpenRouter:

```bash
export OPENROUTER_API_KEY=...
node dist/cli/main.js harness --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001
```

MiniMax direct:

```bash
export MINIMAX_API_KEY=...
export MINIMAX_BASE_URL=https://api.minimax.io/v1   # optional
node dist/cli/main.js harness --adapter minimax --model MiniMax-M2.7 --task safety-001
```

Unknown adapters, missing keys, and missing required model ids fail loudly. Crucible does not silently fall back to mock when live mode was requested.

## Interpreting Results

Every bundle and summary separates model failures from provider, runner, and judge failures.

- `PASS`: the task completed and met the pass threshold.
- `FAIL/MODEL`: the model completed the task but violated requirements or scored below threshold.
- `NC/PROVIDER` or `NC/NETWORK`: provider rate limit, timeout, empty response, auth, 5xx, network, or unavailable errors. Do not treat these as model quality.
- `NC/HARNESS`: runner or local environment failure. Inspect diagnostics before rerunning.
- `NC/JUDGE` or `NC/TEST`: evaluator or test harness could not produce a reliable verdict.

Bundles include `interpretation` with a one-sentence reason, evidence summary, whether the result reflects model capability, retry/provider confidence notes, cost, duration, and recommended interpretation.

Live runs may incur cost. Cost fields are transparent but provider-reported costs are only as accurate as the provider response; otherwise Crucible records an estimate.

## Adding Tasks and Adapters

To add a task, create a manifest under `tasks/<family>/<task-id>/manifest.json`. Repo-execution tasks include a fixture repo and oracle file under `oracles/`; conversational tasks define questions and deterministic scoring rules directly in the manifest.

Every release task must declare `metadata.benchmark_provenance` with `source`, `public_status`, `oracle_visibility`, `gold_solution_visibility`, `contamination_risk`, and at least one `known_scoring_limitations` entry. The manifest loader treats missing or empty provenance as a release-gate failure, and bundles, reports, and the UI surface these fields so benchmark claims remain auditable.

To add an adapter, implement `CrucibulumAdapter` from `adapters/base.ts`, register it in `adapters/registry.ts`, and ensure the bundle records adapter, provider, model, usage, provider attempts, and structured provider errors. The `CrucibulumAdapter` name is compatibility naming from the older/internal protocol layer.

## Release Limitations

Crucible currently emphasizes deterministic, auditable evidence over broad benchmark coverage. Safety tasks are caveated diagnostics, not a certification or proof of universal safety. Provider behavior, model versions, and pricing can change. Repeat runs are recommended before making claims.

See `SECURITY.md` for the public security policy and trust model, and `CHANGELOG.md` for release notes. The included `crucible.service` is an advanced Linux/systemd example only; it is not required for the local quickstart.

## Exit Codes

- `0`: task passed
- `1`: task failed
- `2`: integrity violation
- `3`: harness error
- `4`: injection detected
- `5`: adapter error

## Why This Is Different

Crucible is not trying to be a generic "AI benchmark platform."

Its differentiators are narrower and more technical:

- execution-first, not narration-first
- deterministic judging with hidden oracle support
- evidence bundles instead of opaque leaderboard rows
- explicit integrity and anti-cheat handling
- provider/adapter identity preserved through the pipeline
- advisory review layers that cannot silently become authoritative
- prompt-injection containment as part of the trust model

If you care about whether a coding agent actually performed the task under controlled conditions, these choices matter.

## Good Uses

Crucible is a good fit for:

- evaluating coding agents on realistic repo tasks
- regression testing model/provider changes
- repeated-run reliability measurement
- comparing local and hosted model setups
- building auditable internal model reports
- testing prompt-injection resilience in coding workflows

It is less useful if what you want is:

- pure code-generation samples without execution
- subjective style reviews
- broad chat benchmark scoring
- a benchmark that depends on trusting the model's own explanation

## Repository Summary

If you need a short description for GitHub, docs, or a project directory:

> Crucible turns model and agent trial outputs into auditable scoreboards, receipts, and comparison views, with verified evidence gates for public rankings.

## License

MIT
