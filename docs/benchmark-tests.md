# Benchmark Tests

Crucible benchmark tests measure task performance in the benchmark lane only:

- `spec_discipline`: local repo tasks scored by deterministic public/hidden verification.
- `truthfulness`: factual refusal, recall, extraction, reasoning, workflow, summarization, and code-answer tasks.
- `cost_efficiency`: concise-answer and visible-thinking discipline tasks.

They do not measure poison-repo resistance, safety policy, personality style, memory behavior, build-only behavior, or broad release readiness.

## Scoring

Repo benchmarks use deterministic command/oracle scoring. Conversational benchmarks use deterministic scorers such as `text_match`, `text_match_all`, `regex_match`, `recall`, and refusal checks. Optional review-layer model judgments are advisory; deterministic scoring remains authoritative.

Every benchmark evidence bundle may include `benchmark_evaluation`:

- `PASS`: met pass threshold.
- `PARTIAL`: useful but below threshold.
- `WRONG_ANSWER`: completed response was wrong.
- `SAFE_BUT_UNHELPFUL`: repo task completed without a useful patch.
- `EMPTY_RESPONSE`: no usable response was captured.
- `PROVIDER_FAILURE`: provider or network failure.
- `TIMEOUT`: timeout.
- `PARSER_FAILURE`: parser/scorer failed to interpret output.
- `RUBRIC_MISMATCH`: fixture/scoring setup is not evaluable.
- `AMBIGUOUS_FIXTURE`: fixture is known ambiguous.
- `UNKNOWN`: insufficient evidence.

A 0% benchmark score must be read with this category. `EMPTY_RESPONSE`, `PROVIDER_FAILURE`, `TIMEOUT`, `PARSER_FAILURE`, and `RUBRIC_MISMATCH` are not model-capability losses.

## Examples

Pass: a context-extraction answer includes every required fact, or a spec task passes hidden correctness and regression checks without integrity violations.

Partial: a multi-question benchmark answers some questions correctly but stays below the pass threshold.

Fail: a completed answer gives the wrong value, omits required facts, or a repo patch fails the hidden oracle.

Not complete: provider timeout, provider auth/network failure, empty response, parser failure, or non-evaluable rubric.

## Known Limitations

- Deterministic text scoring can reject correct wording that misses the expected phrase.
- Public synthetic prompts carry contamination risk; check each task's `benchmark_provenance`.
- Multi-fact fixtures should use `text_match_all` or regexes that require the actual final answer.
- Live-provider results must include provider, model, token counts, and category before being used for release decisions.

## Release Readiness

As of 2026-05-16, benchmark classification, fixture-level validation, parser goldens, and reporting surfaces are hardened. Live-provider readiness remains `UNKNOWN` until a provider-keyed environment runs at least one live benchmark pass/fail path.
