# Crucibulum Methodology

## Purpose

Crucibulum is designed to measure whether a model or agent can produce a correct state transition under constraints and with auditable evidence.

The benchmark does not trust narration, explanation quality, or self-reported success.

## Evaluation Modes

Crucibulum currently supports two evaluation modes:

- Repo execution tasks: the model operates inside an isolated task repository under explicit budgets.
- Conversational tasks: the model answers a scored sequence of prompts with deterministic rubric checks.

## Core Trust Model

- The deterministic judge is authoritative.
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

## Known Limitations

- Public family taxonomy is still being consolidated across old and new task families.
- Conversational integrity and regression semantics are weaker than repo-task semantics.
- Reproducibility across cloud APIs depends on provider-side model stability unless the model/version is pinned externally.
