# Luak

Luak turns model and agent trial outputs into auditable scoreboards, receipts, and comparison views.

It helps operators inspect observed behavior by task family, provider, model, adapter, and run evidence. Luak is not a safety certification, not a universal model ranking, and not a replacement for Colosseum-style trial generation.

In the current release sequence, Luak is the benchmark, scoreboard, and evidence-viewer layer. It can still run local harness flows for smoke testing and development, but its public role is to make existing run evidence understandable without overstating what the evidence can support.

## How Luak Fits With The Other Tools

- **Colosseum** generates trial runs and receipts. Use it as the proving ground when you need to create fresh trial evidence.
- **Luak** views, compares, scores, and explains run evidence. Use it to inspect receipts, compare models/providers/adapters, and understand why a run is or is not ranked.
- **Verum** is adversarial and probing-oriented. Its outputs can be normalized into Luak score/evidence views when the integration path is used.
- **Aedis** is governed build orchestration. It can drive controlled workflows that later produce evidence for inspection.
- **Peh Public** is the broader user-facing AI control surface. Luak is one evidence and scoreboard layer inside that wider release path.
- **Crucibulum** appears in environment variables, schemas, and API names as the older/internal protocol name for Luak-compatible run and score exchange. Public docs should treat it as compatibility naming, not a separate public product unless the project is split later.

## What Luak Is / Is Not

Luak is:

- a local scoreboard and evidence viewer
- a lane-scoped comparison UI
- a provenance and receipt inspection layer
- an observed-behavior comparison tool
- a way to preserve adapter/provider/model identity while reviewing results

Luak is not:

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

Luak is built around a narrow question: what did this model or agent do under a defined task, adapter, provider, and scoring policy, and what evidence supports that observation?

Luak does not grade based on style, self-report, chain-of-thought, or polished explanations. It grades based on observable state:

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

## What Luak Does

Luak ingests or creates model/agent run evidence, applies deterministic scoring where configured, and turns that evidence into local scoreboards, receipts, and comparison views.

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

Luak is designed against that.

It treats evaluation as an evidence problem. The key question is not "did the model say the right thing?" It is "what behavior was observed, under what conditions, and can the evidence be inspected independently?"

## How It Works

At a high level, Luak follows this pipeline:

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

This means Luak can inspect both execution behavior and chat behavior. The current taxonomy is release-candidate level and versioned, but it should still be cited with the repository commit, task IDs, and scoring policy used for a given comparison. The test corpus is lightweight by design (intentional minimum for bootstrap); use `pnpm run oracle:hash -- --write` after adding oracles to register them in the corpus.

### Experimental targets

Some models are wired up for **experimental benchmarking only** — never as a
default, the judge, or a normal routing target, and always excluded from the
leaderboard and capability certification. OpenRouter **MiniMax-M3** is the first
such target: run `pnpm run bench:minimax-m3 -- --model minimax-m3 --smoke-only`
to gate it, or see [`docs/MINIMAX_M3_EXPERIMENTAL.md`](docs/MINIMAX_M3_EXPERIMENTAL.md)
for the full cost-capped comparison against the MiMo v2.5 family.

## Scoring Model

Luak judges runs in a fixed order:

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

This is important because Luak is not just trying to emit a score. It is trying to emit a score with an audit trail.

## Bundle Immutability and Scoring Honesty

Luak separates "what happened on this run" from "what the current leaderboard says about a model." Both are honest, but they answer different questions, and reading one as the other is the most common way to misinterpret a Luak result.

**Signed bundles are immutable evidence.** Once a run is written to `runs/<bundle_id>.json` and hash-signed, the file is not rewritten — not when scoring rules change, not when judges are upgraded, not when bugs are fixed. The bundle records what the run produced *at the moment it produced it*. Tampering breaks the hash check; the trust layer marks tampered bundles as not ranked.

**Some older bundles carry historical stored scores.** Luak's scoring discipline tightened during the May 2026 trust audit (see `tests/safety-scoring.test.ts`, `tests/lane-scoring.test.ts`). Bundles written before that audit may show a stored `score.total` that included regression / integrity / efficiency credit even when correctness was zero. Those numbers are correct as a record of what the *pre-audit* formula produced. They are not current trust claims.

**The leaderboard, UI warnings, recommendation cards, diagnostics, and exports all use the current trust rules.** Specifically:

- The backend leaderboard composite excludes NC bundles (provider / network / judge / test outages) via `verdict.countsTowardModelScore`. A model that never actually ran does not get a capability score.
- The repo-mode and conversational score formulas gate secondary credit on non-zero correctness. A run that produced no correct output cannot float to 15–60% on R/I/E defaults.
- The UI's lane scope banner surfaces `PROVISIONAL · n=<x>`, `ALL NOT-COMPLETE`, `<x>% NC`, `ALL RUNS FAILED`, `<x>% INFRA`, and `<n> HISTORICAL` chips when the conditions are met.
- The bundle detail panel shows a `STORED HISTORICAL SCORE` banner when a bundle predates current scoring discipline, and a `NOT COUNTED TOWARD LEADERBOARD` banner when the verdict excludes it from the composite.
- Recommendation cards (Best Overall, Best Value, Fastest Usable) refuse to crown a model with zero composite or zero pass rate. Risky / Avoid is intentionally the opposite — it surfaces failed or invalid models so users see them.

**NC, provider, judge, and test failures stay visible as evidence.** They are not deleted, they are not hidden, and they do not vanish from the run history. They are excluded from *capability averages* because they did not measure the model. They remain counted in `nc_rate`, `failed_provider`, `failed_judge`, and the failure taxonomy.

**Raw `score.total` is historical stored data.** A bundle's `score.total` is what the scoring formula produced when the bundle was written. For a current-discipline interpretation, read the leaderboard endpoint or the UI — both recompute against current rules and exclude bundles that should not count. Do not treat `score.total` from a raw bundle file as the current Luak trust claim for a model.

**JSON and CSV exports carry honesty metadata.** Lane leaderboard exports (`luak.lane.leaderboard.v2` schema) include:

- `counts_in_leaderboard` — true only if the row contributed to the current composite
- `nc_rate`, `model_failure_rate`, `completion_rate` — so you can tell "model never ran" from "model failed"
- `reliability_score`, `confidence`, `sample_adequate`, `provisional` — sample-quality signals
- a `note` field summarizing data quality (e.g. "zero composite — no scoring-eligible runs counted", "75% NC (provider/network/judge outages)")
- top-level `honesty_notes` explaining what was filtered and what is provisional

Drilldown exports add `counts_toward_leaderboard`, `is_pre_fix_historical`, and `exclusion_reasons` per run so a consumer can route each bundle to the right interpretation.

**Read order for current trust.** If you want the current Luak verdict for a model:

1. Use the UI (lane tab) or the `/api/leaderboard?task_families=<lane>` endpoint.
2. Use the lane diagnostic: `node scripts/lane-diagnostic.mjs <lane>` — it prints leaderboard-equivalent averages with NC excluded and flags pre-fix bundles still in scope.
3. Use the lane export (JSON/CSV) — the `note` and `counts_in_leaderboard` columns tell you exactly what each row means.

Reading raw signed bundle files directly is fine for audit (verifying what a run produced) but is not the right surface for "what does Luak currently say about this model."

## Security and Trust Model

Luak assumes prompt injection is a system problem, not just a model problem.

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

Luak supports optional review layers such as:

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

The advisory model judge defaults to **OpenRouter `xiaomi/mimo-v2.5-pro`**. Configure via `OPENROUTER_API_KEY`. Override with:

- `LUAK_JUDGE_PROVIDER` — provider id (default `openrouter`)
- `LUAK_JUDGE_MODEL` — model id (default `xiaomi/mimo-v2.5-pro`)

Legacy aliases `CRUCIBLE_JUDGE_PROVIDER` / `CRUCIBLE_JUDGE_MODEL` are still honored; prefer the `LUAK_*` names for new setups.

Fallback: when the configured judge provider is unreachable, only the deterministic scorer runs and the model judge is recorded as `judge_usage.kind = "skipped"`. The run is never silently re-routed to a different model.

Each bundle records both costs separately:

- `usage` — tested-model token / cost spend
- `judge_usage` — judge-model token / cost spend, with `kind: "deterministic" | "model" | "skipped"`

## QA Harness

The QA harness walks every tab/lane, runs every test through the full pipeline, and emits a machine-readable report agents like Ricky and Ptah can consume.

```bash
pnpm run harness                                # offline mock adapter, every lane
pnpm run harness -- --tab personality           # only the Personality lane
pnpm run harness -- --task personality-002      # one test by id
pnpm run harness -- --live                      # use the configured judge model
                                               # (OpenRouter MiMo by default;
                                               #  needs OPENROUTER_API_KEY)
pnpm run harness -- --enable-judge              # also run the model judge layer
```

Per-test it records: `manifest_loaded`, `request_sent`, `response_received`, `judge_ran`, `bundle_stored`, `ui_summary_well_formed`, `drilldown_evidence_present`, plus tested-model and judge-model token + cost split. The report is written to `runs/_harness_report_<timestamp>.json`.

Exit codes: `0` clean, `1` test failures only, `2` pipeline breakage, `3` conversational task incomplete (verdict neither PASS nor FAIL).

## Adapters and Providers

Luak is meant to evaluate models through adapters rather than binding itself to a single provider.

The repo already supports a provider-first flow through adapters and exposes provider/model metadata in the bundle and API. Supported adapters/providers currently include:

- `ollama`
- `anthropic`
- `openai`
- `openrouter`
- `openai-compatible`
- `openclaw`
- `peh`
- `grimoire-cc`
- `grimoire-codex`
- `minimax`
- `zai`
- `google`
- `groq`
- `mistral`
- `together`
- `deepseek`
- `mimo`

That means you can compare:

- local setups
- hosted APIs
- agent wrappers
- different execution systems

without losing track of who actually ran the task and under what identity.

### Current Release Certification Scope

The current release candidate is not unqualified `FULL_RELEASE_READY`.
Certification is scoped to the evidence archived in `docs/RELEASE_READINESS.md`.

Certified release-target models:

- OpenRouter / `deepseek/deepseek-v4-pro`
- OpenRouter / `xiaomi/mimo-v2.5-pro`
- Ollama / `qwen3.5:9b`

Other providers and models may appear in the UI or adapter registry, but
visibility does not mean release certification. Those routes remain
uncertified unless a matching real-provider report is archived. Repo-mode
certification is representative smoke coverage only, not proof that every
repo task family has been live-certified. Automated UI-shape checks and the
manual browser UI checklist pass for the scoped target set, but this remains
`RELEASE_SCOPED_TO_CERTIFIED_TARGETS`, not `FULL_RELEASE_READY`.

### Vision Capability-Certified (separate from the release-certification scope above)

Vision is currently the one **capability** that has been formally
promoted under Luak's doctrine-gated capability-certification
track (`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`). This is
**separate from** the general release-certification scope above:

- Vision capability certification is based on Luak's 15-test
  Vision suite run across **three independent route families**
  (MiMo, GPT-5, Anthropic) with aggregate pass rate ≥ 80% and no
  disallowed recurring measurement attribution.
- It says the **capability evaluation pipeline** works correctly
  and that real models pass it. It does **not** certify any one
  model as universally release-ready.
- It does **not** affect the leaderboard composite
  (`TAB_CONFIG.vision.scoreFamilies = []`).
- It does **not** mutate `reports/model-certification/certified-models.json`
  or `MODEL_CERTIFICATION.models[].tier`. Those files remain
  byte-identical to their pre-promotion state. The release-
  certification scope above is unchanged by Vision promotion.
- Promotion is operator-explicit (signed confirmation phrase at
  `POST /api/capabilities/vision/promote`). An immutable receipt
  lives under `reports/capability-promotions/vision/`. Local
  state lives in `data/capability-certifications.json` and is
  gitignored — fresh checkouts have no capability-promoted state
  and render the chip as `EXPERIMENTAL` by default.
- Full plain-English summary, audit trail, and verification
  commands: [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md).

Capability badges other than Vision (Roleplay, tool-calling, etc.)
remain experimental until they reach the same level of
multi-family evidence under the same doctrine.

## Methodology and Trust Docs

Luak is being documented as a public audit and evidence-inspection system rather than only a codebase. Start here:

- [docs/methodology.md](docs/methodology.md)
- [docs/scoring.md](docs/scoring.md)
- [docs/SCORING_FIELDS.md](docs/SCORING_FIELDS.md) — composite vs correctness vs efficiency credit; what each `score.*` field means; why `total_percent` may not match the binary correctness anchors.
- [docs/versioning.md](docs/versioning.md)
- [docs/reproducibility.md](docs/reproducibility.md)
- [docs/CAPABILITY_CERTIFICATION_DOCTRINE.md](docs/CAPABILITY_CERTIFICATION_DOCTRINE.md) — capability-specific certification track (separate from general model certification).
- [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md) — plain-English audit summary for Vision Capability-Certified (the one currently-promoted capability).
- [docs/MULTIMODAL_VISION_SUITE.md](docs/MULTIMODAL_VISION_SUITE.md) — Vision suite design, 15-test list, scorers, fixture provenance.

## UI and API

Luak includes a local API and browser UI for inspecting runs, receipts, bundles, quarantined evidence, and comparisons.

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
- pnpm 9 or newer
- Git, if you are cloning from source

This release has been verified on Linux with Node `v22.22.2` and pnpm `9.x`. Linux, macOS, and WSL2 are the intended first-run environments. Native Windows PowerShell commands are documented, but native Windows has not been fully verified for this release.

### Distribution Status

`v0.1.0` is **source-install only**. Clone the repo and run `pnpm install && pnpm run build` from a checkout. Packaged installers are planned but not shipped yet:

- **npm package**: not published — install from the repo
- **Standalone binary**: not available
- **Docker image**: not published
- **OS installers (deb/rpm/msi/pkg)**: not available

The `luak.service` file is a systemd example for advanced Linux operators only; it is not required for the local quickstart.

Install dependencies and build:

```bash
pnpm install
pnpm run build
```

If anything fails, run `pnpm run doctor` for a read-only diagnostic of Node/npm versions, build artifacts, and required directories.

## First 5 Minutes

If you have never run Luak before and just want to see it work, do this in order. It uses no API keys, no provider accounts, and no network calls beyond `pnpm install`.

```bash
git clone <this-repo>
cd luak
pnpm install
pnpm run build
pnpm run smoke
pnpm run serve
```

Expected outcome:

1. `pnpm run smoke` finishes with `Smoke passed.` This proves the deterministic offline pipeline works on your machine.
2. `pnpm run serve` prints a banner that ends with `Luak server running on http://127.0.0.1:18795` and `UI: http://127.0.0.1:18795/`.
3. Open `http://127.0.0.1:18795/` in your browser. You will see the Luak UI shell.
4. The default public leaderboard view will be **empty**. That is expected on a fresh checkout — Luak only ranks **verified eligible bundles**, and the smoke test produces deliberately quarantined mock/demo evidence. Empty here means "nothing has earned a public rank yet," not "broken."
5. Quarantined / mock-or-demo evidence (including the smoke output) is visible from `/api/leaderboard/quarantine` and is labeled `NOT RANKED`. That is the correct first-run state.
6. Stop the server with `Ctrl+C`. Run `pnpm run clean:state -- --confirm` if you want to wipe local runs before continuing.

You are now ready to import real evidence (see "Adding Tasks and Adapters") or run a live adapter (see "Live Adapter Setup").

## Public Quick Start

### Prerequisites

- Node.js 20 or newer
- pnpm 9 or newer
- Git

Linux, macOS, or WSL2:

```bash
# Clone and enter the repo
git clone <this-repo>
cd luak

# Install dependencies and build
pnpm install
pnpm run build

# Run the deterministic offline smoke test
pnpm run smoke

# Start the local API / UI
pnpm run serve
```

Windows PowerShell:

```powershell
# Clone and enter the repo
git clone <this-repo>
cd luak

# Install dependencies and build
pnpm install
pnpm run build

# Run the deterministic offline smoke test
pnpm run smoke

# Start the local API / UI
pnpm run serve
```

Expected smoke output includes:

```text
Luak smoke test: deterministic offline mock run.
Luak Harness - MOCK adapter
Tests:    1 passed / 0 failed (1 total)
Smoke passed.
```

The smoke path uses a deterministic mock adapter and writes temporary smoke state under the operating system temp directory. It does not require provider API keys, Colosseum, Peh, private services, or pre-existing `runs/` data. Smoke output is mock/demo evidence and is excluded from public ranking.

By default, a fresh checkout has no verified public ranking data. The leaderboard may be empty until you import or generate verified eligible evidence. Old local runs do not silently become public rankings; tampered, unsigned, legacy, mock/demo, malformed, or unverified bundles are quarantined and labeled `NOT RANKED`.

`pnpm run serve` binds to `127.0.0.1` by default and prints the UI URL:

```text
Luak server running on http://127.0.0.1:18795
UI: http://127.0.0.1:18795/
API: http://127.0.0.1:18795/api/
```

Set `LUAK_PORT` to use a different port. Set `LUAK_HOST=0.0.0.0` only when you intentionally want the server reachable beyond the local machine and have reviewed `SECURITY.md`. Legacy `CRUCIBLE_PORT` / `CRUCIBLE_HOST` are still honored as deprecated aliases.

To stop the server, press `Ctrl+C` in the terminal where it is running. There is no separate stop command. State written to `runs/` and `state/` persists across restarts; use `pnpm run clean:state -- --confirm` to clear it.

## Security note

**Luak has no built-in authentication.** Anything that can reach the bound port can call the API. The default bind is `127.0.0.1`, which keeps the server reachable only from your own machine. This app assumes it is running on a trusted private network. Do not expose it directly to the public internet without adding your own access control.

If you need access from another device, put a private-network gate in front of Luak — pick whichever fits your setup:

- run it behind Tailscale or a VPN and rely on tailnet / VPN-level identity;
- bind to `0.0.0.0` only when there is a firewall in front and the LAN is trusted;
- run a reverse proxy (nginx, Caddy, Cloudflare Tunnel, etc.) that handles authentication before forwarding to Luak.

There are no built-in tokens, sign-in screens, or pairing flows to configure. Securing the network path is the operator's responsibility.

## Setting LUAK_HMAC_KEY

Luak signs every evidence bundle with HMAC-SHA-256. The signing key is `LUAK_HMAC_KEY` (legacy `CRUCIBLE_HMAC_KEY` is still honored as a deprecated alias). Without it:

- bundles are still produced, but their `bundle_signature_status` is `unsigned_key_missing`;
- the public leaderboard quarantines those bundles and labels them `NOT RANKED`;
- the server prints a startup warning so you do not silently produce unrankable evidence.

To set a key for local development:

```bash
# Linux / macOS / WSL2
export LUAK_HMAC_KEY="$(openssl rand -hex 32)"
pnpm run serve
```

```powershell
# Windows PowerShell
$env:LUAK_HMAC_KEY = -join ((1..64) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
pnpm run serve
```

Or persist it in `.env` (copy from `.env.example`). Treat the key as a secret: anyone who has it can sign bundles that the server will accept as authentic. **Changing or losing the key invalidates existing bundles** — the leaderboard will move them to quarantine. For a single-operator local install, that is fine; for shared evidence, pick a key once and keep it.

## Common Commands

```bash
# Type-check without emitting build output
pnpm run typecheck

# Build
pnpm run build

# Run the full test suite
pnpm test

# Run deterministic offline smoke
pnpm run smoke

# Run the release verification bundle
pnpm run verify:release

# Check pnpm advisories at moderate severity and above
pnpm run audit:release

# Verify oracle hashes
pnpm run oracle:hash -- --check

# Read-only environment audit (Node version, build artifacts, env vars)
pnpm run doctor

# Preview which local directories will be deleted (no-op without --confirm)
pnpm run clean:state
```

Live adapter examples:

```bash
# Offline pipeline validation only. This is mock mode, not model evidence.
pnpm run harness -- --task safety-001

# OpenRouter live run. May incur provider cost.
export OPENROUTER_API_KEY=...
pnpm run harness -- --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001

# MiniMax direct live run. May incur provider cost.
export MINIMAX_API_KEY=...
pnpm run harness -- --adapter minimax --model MiniMax-M2.7 --task safety-001

# Tune conservative live-call resilience.
pnpm run harness -- --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001 --retries 2 --timeout-ms 120000

# Verify a stored evidence bundle
pnpm run cli -- verify run_2026-04-05_poison-001_gemma4
```

Luak is an evidence viewer and local evaluation layer, not a guarantee of model safety. Passing a task means the model passed that task under this harness, with this adapter, at that time. It does not show that the model is universally safe or reliable.

Mock mode is for offline pipeline validation only. Mock results must not be cited as live model evidence.

## Clearing Local State

Luak writes local runs and state to ignored directories by default:

- `runs/` for generated evidence bundles and harness reports
- `state/` for provider registry data

To clear local/demo state, stop the server first, then run:

```bash
# Preview what would be deleted (safe; reports paths only)
pnpm run clean:state

# Actually delete runs/ and state/
pnpm run clean:state -- --confirm
```

`clean:state` only touches those two directories under the repo root. It does not delete imported evidence stored elsewhere, tasks, oracles, or your `.env`. You can still remove the directories manually with your file manager or shell — the script just gives you a portable, scriptable, opt-in option.

## Troubleshooting First Run

Run `pnpm run doctor` first — it is read-only and reports most common issues.

- **Port already in use:** run with a different port, for example `LUAK_PORT=18895 pnpm run serve` on Linux/macOS/WSL2 or `$env:LUAK_PORT=18895; pnpm run serve` in PowerShell. The default port is `18795`.
- **`node: command not found` or wrong Node version:** Luak requires Node 20+. Check with `node --version`. Install from [nodejs.org](https://nodejs.org/) or your package manager. `nvm install 22 && nvm use 22` works on Linux/macOS/WSL2.
- **`pnpm: command not found`:** install pnpm with `corepack enable && corepack prepare pnpm@latest --activate` or `npm install -g pnpm`.
- **Windows execution policy blocks `npm`:** PowerShell may refuse to run npm shims with `cannot be loaded because running scripts is disabled on this system`. Fix once per user: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`. Use Windows Terminal (PowerShell 7+) for the commands in this README; cmd.exe is not tested.
- **Empty leaderboard / "I see no data":** this is the correct fresh-checkout state. Default leaderboards rank only verified eligible evidence. Smoke output is mock/demo and is deliberately quarantined. Inspect `/api/leaderboard/quarantine` to confirm the data is there but `NOT RANKED`.
- **`LUAK_HMAC_KEY is not set` warning:** expected on a first local run. Bundles you generate without a key will be quarantined as `unsigned_key_missing`. Set the key (see "Setting LUAK_HMAC_KEY") before generating evidence you intend to publish. Legacy `CRUCIBLE_HMAC_KEY` still works.
- **Cannot reach the API from another device:** the default bind is `127.0.0.1`. Set `LUAK_HOST` to a routable address (your Tailscale IP, a LAN IP, or `0.0.0.0` when firewalled) and read the security note in `SECURITY.md` first. Luak has no built-in auth — anything that can reach the bound port can call the API.
- **Malformed or tampered runs:** Luak quarantines them. Inspect safe metadata at `/api/leaderboard/quarantine`; do not cite them as public leaderboard evidence.
- **Live adapter fails with "missing key":** offline `pnpm run smoke` needs no provider keys. Live adapters fail loudly and name the required key, such as `OPENROUTER_API_KEY` or `MINIMAX_API_KEY`.
- **PowerShell path issues:** use pnpm scripts (`pnpm run smoke`, `pnpm run serve`, `pnpm run harness -- --task safety-001`) instead of invoking files under `dist/` directly.
- **`pnpm install` fails on registry / EAI_AGAIN / 403:** corporate proxies and outdated certificates are the usual cause. Try `pnpm config get registry` (should be `https://registry.npmjs.org/`), clear with `pnpm store prune`, and rerun. `pnpm audit` warnings during install are advisory; `pnpm install` will still complete.
- **Need to start fresh:** stop the server, then `pnpm run clean:state -- --confirm` removes `runs/` and `state/`. This wipes generated bundles and the local provider registry. It does not touch tasks, oracles, or imported evidence stored elsewhere.
- **Need remote access:** default binding is local-only. Set `LUAK_HOST=0.0.0.0` deliberately and put a private-network gate (Tailscale, VPN, firewall, reverse-proxy auth) in front of Luak — read `SECURITY.md` first.

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

Unknown adapters, missing keys, and missing required model ids fail loudly. Luak does not silently fall back to mock when live mode was requested.

## Interpreting Results

Every bundle and summary separates model failures from provider, runner, and judge failures.

- `PASS`: the task completed and met the pass threshold.
- `FAIL/MODEL`: the model completed the task but violated requirements or scored below threshold.
- `NC/PROVIDER` or `NC/NETWORK`: provider rate limit, timeout, empty response, auth, 5xx, network, or unavailable errors. Do not treat these as model quality.
- `NC/HARNESS`: runner or local environment failure. Inspect diagnostics before rerunning.
- `NC/JUDGE` or `NC/TEST`: evaluator or test harness could not produce a reliable verdict.

Bundles include `interpretation` with a one-sentence reason, evidence summary, whether the result reflects model capability, retry/provider confidence notes, cost, duration, and recommended interpretation.

Live runs may incur cost. Cost fields are transparent but provider-reported costs are only as accurate as the provider response; otherwise Luak records an estimate.

## Adding Tasks and Adapters

To add a task, create a manifest under `tasks/<family>/<task-id>/manifest.json`. Repo-execution tasks include a fixture repo and oracle file under `oracles/`; conversational tasks define questions and deterministic scoring rules directly in the manifest.

Every release task must declare `metadata.benchmark_provenance` with `source`, `public_status`, `oracle_visibility`, `gold_solution_visibility`, `contamination_risk`, and at least one `known_scoring_limitations` entry. The manifest loader treats missing or empty provenance as a release-gate failure, and bundles, reports, and the UI surface these fields so benchmark claims remain auditable.

To add an adapter, implement `CrucibulumAdapter` from `adapters/base.ts`, register it in `adapters/registry.ts`, and ensure the bundle records adapter, provider, model, usage, provider attempts, and structured provider errors. The `CrucibulumAdapter` name is compatibility naming from the older/internal protocol layer.

## Release Limitations

Luak currently emphasizes deterministic, auditable evidence over broad benchmark coverage. Safety tasks are caveated diagnostics, not a certification or proof of universal safety. Provider behavior, model versions, pricing, and rate-limit behavior can change. Repeat runs are recommended before making claims.

Current release evidence supports scoped certification only: the platform/mock
gate, representative repo-mode smoke, and broad real-provider smoke for
OpenRouter DeepSeek, OpenRouter Mimo, and Ollama `qwen3.5:9b`. It does not
certify every UI-visible provider/model, every repo-mode task family, or the
full all-provider/all-model release.

See `SECURITY.md` for the public security policy and trust model, and `CHANGELOG.md` for release notes. The included `luak.service` is an advanced Linux/systemd example only; it is not required for the local quickstart.

## Exit Codes

- `0`: task passed
- `1`: task failed
- `2`: integrity violation
- `3`: harness error
- `4`: injection detected
- `5`: adapter error

## Why This Is Different

Luak is not trying to be a generic "AI benchmark platform."

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

Luak is a good fit for:

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

> Luak turns model and agent trial outputs into auditable scoreboards, receipts, and comparison views, with verified evidence gates for public rankings.

## License

MIT
