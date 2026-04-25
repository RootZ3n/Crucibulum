# Crucible

Crucible is an execution-based evaluation harness for AI coding models and agent systems.

It is built to answer a narrow question: can this model or agent actually complete a real software task inside a repo under constraints, with evidence, without trusting narration?

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

Crucible runs coding tasks against a target model or agent adapter, captures what happened in an isolated workspace, judges the result with a deterministic verifier, and produces an evidence bundle you can inspect or compare later.

In practice, that means it can:

- run a single task against a model
- run an entire benchmark suite
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

It treats coding evaluation as an environment-state problem. The key question is not "did the model say the right thing?" It is "did the system produce the right state transition under constrained execution, and can that be verified independently?"

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
- the deterministic judge is the source of truth

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

This means Crucible is already evaluating both execution behavior and chat behavior, but the long-term benchmark taxonomy is still being consolidated.

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

Review models may summarize, flag concerns, or recommend reruns. They may not override scoring, mutate pass/fail, or rewrite authoritative truth.

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
- bundle truth

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

Exit codes: `0` clean, `1` test failures only, `2` pipeline breakage.

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

The benchmark is being documented as a public-audit system rather than only a codebase. Start here:

- [docs/methodology.md](docs/methodology.md)
- [docs/scoring.md](docs/scoring.md)
- [docs/versioning.md](docs/versioning.md)
- [docs/reproducibility.md](docs/reproducibility.md)

## UI and API

Crucible includes a local API and browser UI for inspecting runs, receipts, bundles, and comparisons.

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

The UI is there to make evidence inspection practical, but the trust model does not depend on the UI. The source of record remains the bundle and the deterministic judge output.

## Install

```bash
npm install
npm run build
```

## Public Quick Start

```bash
# Offline pipeline validation only. This is mock mode, not model evidence.
node dist/cli/main.js harness --task safety-001

# OpenRouter live run. May incur provider cost.
export OPENROUTER_API_KEY=...
node dist/cli/main.js harness --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001

# MiniMax direct live run. May incur provider cost.
export MINIMAX_API_KEY=...
node dist/cli/main.js harness --adapter minimax --model MiniMax-M2.7 --task safety-001

# Tune conservative live-call resilience.
node dist/cli/main.js harness --adapter openrouter --model xiaomi/mimo-v2.5-pro --task safety-001 --retries 2 --timeout-ms 120000

# Verify a stored evidence bundle
crucible verify run_2026-04-05_poison-001_gemma4

# Start the local API / UI
npm run serve
```

Crucible is an evaluation harness, not a guarantee of model safety. Passing a task means the model passed that task under this harness, with this adapter, at that time. It does not prove the model is universally safe or reliable.

Mock mode is for offline pipeline validation only. Mock results must not be cited as live model evidence.

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

To add an adapter, implement `CrucibulumAdapter` from `adapters/base.ts`, register it in `adapters/registry.ts`, and ensure the bundle records adapter, provider, model, usage, provider attempts, and structured provider errors.

## Release Limitations

Crucible currently emphasizes deterministic, auditable evaluation over broad benchmark coverage. Safety tasks are caveated diagnostics, not a proof of universal safety. Provider behavior, model versions, and pricing can change. Repeat runs are recommended before making claims.

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

> Crucible is an execution-based evaluation harness for AI coding agents. It runs models against real repo tasks, judges them deterministically using hidden/public checks and integrity rules, and produces signed evidence bundles for audit and comparison.

## License

MIT
