# Crucible Methodology

## Purpose

Crucible is designed to record and compare observed model or agent behavior under constraints and with auditable evidence.

The scoring and evidence views do not trust narration, explanation quality, or self-reported success.

## Role In The Release Sequence

Crucible is the scoreboard, receipt, and evidence-inspection layer. Colosseum-style systems generate trial runs and receipts; Crucible makes those outputs understandable, comparable, and auditable. Crucible can still run local smoke tasks, but public claims should describe it as an evidence viewer and comparison layer rather than the sole trial-generation system.

## Evaluation Modes

Crucible currently supports two evaluation modes:

- Repo execution tasks: the model operates inside an isolated task repository under explicit budgets.
- Conversational tasks: the model answers a scored sequence of prompts with deterministic rubric checks.

## Core Trust Model

- The deterministic judge is authoritative for configured scoring checks.
- Hidden oracles are never exposed to the evaluated system.
- Integrity checks can fail a run regardless of downstream correctness.
- Review models are advisory only.
- Bundles are hash-signed and retained as evidence.

## Repo Task Method

Repo tasks are judged from:

- correctness checks
- regression checks
- integrity checks
- efficiency relative to task budgets

The evaluated system receives only the agent-visible subset of the manifest.

## Conversational Method

Conversational tasks are judged from:

- per-question deterministic scoring
- weighted aggregation across questions
- efficiency pressure from time and token budgets

Conversational tasks currently do not have oracle-backed regression checks in the same way repo tasks do. That is a known limitation.

## Evidence

Every run produces an evidence bundle with:

- task identity
- environment metadata
- adapter/provider identity
- timeline or conversational trace summary
- verification results
- score breakdown
- usage and estimated cost
- trust metadata
- benchmark provenance, contamination risk, and scoring caveats

## Provenance and Contamination

Release manifests must declare where the task came from, whether task material is public or private, whether the oracle is visible, whether a gold solution is visible, the estimated contamination risk, and known scoring limitations. Crucible fails task loading when this metadata is absent, then carries it into bundles, summaries, and UI inspection panels.

## Known Limitations

- Public family taxonomy is release-candidate level and should be cited with the repository commit, task IDs, and scoring policy used for each comparison.
- Conversational integrity and regression semantics are weaker than repo-task semantics.
- Reproducibility across cloud APIs depends on provider-side model stability unless the model/version is pinned externally.
- Crucible evidence is not a safety certification, universal model ranking, or replacement for external audit.
