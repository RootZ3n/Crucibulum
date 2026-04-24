# Crucible Versioning Policy

## Three Versions Matter

- Code version: the harness implementation version.
- Benchmark version: the released task corpus and scoring policy version.
- Model version: the evaluated model/provider identity.

## Current State

The harness already records a Crucible code version in bundles.

The benchmark corpus still needs a stricter release discipline for public publication. Until that lands, benchmark comparisons should always cite:

- commit SHA
- task IDs
- adapter/provider identity
- model ID
- run date

## Planned Release Discipline

Public benchmark releases should eventually include:

- a benchmark version manifest
- a changelog of added, modified, and retired cases
- a leakage and contamination policy
- compatibility notes for score changes

## Rule

Published claims should never cite only a model score without also citing the benchmark snapshot used to produce it.
