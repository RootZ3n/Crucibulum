# Crucibulum

Crucibulum is an execution-based evaluation harness for AI coding models and agent systems.

It is built to answer a narrow question: can this model or agent actually complete a real software task inside a repo under constraints, with evidence, without trusting narration?

Crucibulum does not grade based on style, self-report, chain-of-thought, or polished explanations. It grades based on observable state:

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

## What Crucibulum Does

Crucibulum runs coding tasks against a target model or agent adapter, captures what happened in an isolated workspace, judges the result with a deterministic verifier, and produces an evidence bundle you can inspect or compare later.

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

Crucibulum is designed against that.

It treats coding evaluation as an environment-state problem. The key question is not "did the model say the right thing?" It is "did the system produce the right state transition under constrained execution, and can that be verified independently?"

## How It Works

At a high level, Crucibulum follows this pipeline:

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

This means Crucibulum is already evaluating both execution behavior and chat behavior, but the long-term benchmark taxonomy is still being consolidated.

## Scoring Model

Crucibulum judges runs in a fixed order:

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

This is important because Crucibulum is not just trying to emit a score. It is trying to emit a score with an audit trail.

## Security and Trust Model

Crucibulum assumes prompt injection is a system problem, not just a model problem.

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

Crucibulum supports optional review layers such as:

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

## Adapters and Providers

Crucibulum is meant to evaluate models through adapters rather than binding itself to a single provider.

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

Crucibulum includes a local API and browser UI for inspecting runs, receipts, bundles, and comparisons.

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

## Quick Start

```bash
# Run a single task against Ollama
crucibulum test --model ollama:gemma4:26b --task poison-001

# Run the full V1 suite
crucibulum test --model ollama:gemma4:26b --suite v1

# Compare multiple models on one task across repeated runs
crucibulum compare --models ollama:gemma4:26b,openrouter:arcee-ai/trinity-large-thinking --task poison-001 --runs 5

# Verify a stored evidence bundle
crucibulum verify run_2026-04-05_poison-001_gemma4

# Start the local API / UI
npm run serve
```

## Exit Codes

- `0`: task passed
- `1`: task failed
- `2`: integrity violation
- `3`: harness error
- `4`: injection detected
- `5`: adapter error

## Why This Is Different

Crucibulum is not trying to be a generic "AI benchmark platform."

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

Crucibulum is a good fit for:

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

> Crucibulum is an execution-based evaluation harness for AI coding agents. It runs models against real repo tasks, judges them deterministically using hidden/public checks and integrity rules, and produces signed evidence bundles for audit and comparison.

## License

MIT
