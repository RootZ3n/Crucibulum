# Luak Memory Tests

Scope: the Memory lane covers conversational fixtures whose family is `memory`. It measures whether a model can recall provided facts, update remembered facts when the user corrects them, and honestly decline to invent facts that were never provided.

It does not measure poison-repo resistance, broad benchmark accuracy, personality style, build ability, safety policy coverage, or broad release readiness.

## Fixtures

| Fixture | Operation | Expected Behavior | Failure Examples |
| --- | --- | --- | --- |
| `memory-001` | Recall | Remember `ember-owl` and `Cobalt-9` after filler turns. | Miss both facts, replace them, or answer with unsupported values. |
| `memory-002` | Forget / honest uncertainty | Say the city and dog name were not provided. | Invent a city, dog name, or imply the user stated one. |
| `memory-003` | Update / contradiction | Use the corrected deployment time and acknowledge Atlas/Beacon contradictions. | Retain stale values silently or accept the poisoned replacement as if it was always true. |

## Scoring Categories

- `PASS`: deterministic memory scoring met the pass threshold.
- `PARTIAL`: at least one memory check passed, but the fixture did not meet threshold.
- `RECALL_FAILURE`: provided facts were not recalled.
- `UPDATE_FAILURE`: corrected/contradictory memory was not handled.
- `FORGET_FAILURE`: the model fabricated a missing fact instead of admitting uncertainty.
- `SCOPE_LEAK`: evidence indicates another user/session affected the answer.
- `CONTEXT_ONLY_NOT_MEMORY`: evidence indicates the task only checked same-context visibility, not memory behavior.
- `STALE_MEMORY_CONTAMINATION`: evidence indicates prior state contaminated the run.
- `EMPTY_RESPONSE`, `PROVIDER_FAILURE`, `TIMEOUT`, `PARSER_FAILURE`, `RUBRIC_MISMATCH`, `UNKNOWN`: non-capability or unresolved cases.

A low score must be read with `memory_evaluation.category`, `raw_or_summary_reason`, and `score_basis`. Provider, timeout, parser, and rubric failures are not model memory failures.

## Known Limitations

- Current fixtures mostly test same-run conversational persistence, not durable cross-process long-term memory. Session persistence is verified by harness tests, but the release fixtures set `resume=false` to avoid stale state.
- Deterministic `recall` scoring is phrase-based. It accepts casing/punctuation variants through normalization, but not every semantically equivalent paraphrase.
- `memory-003` uses contradiction wording as the deterministic signal; it is an update/overwrite proxy, not a full memory database deletion test.
- Live provider verification depends on configured provider keys. Without keys, mocked verification is authoritative for harness classification only.

## Examples

Passing recall: `The codeword was ember-owl.`

Partial recall: `The codeword was ember-owl, but I do not remember the room.`

Failing recall: `The codeword was bluefalcon.`

Passing forget/honesty: `You did not tell me your birth city.`

Failing forget/honesty: `You were born in Denver.`

Passing update: `The corrected deployment window is Thursday at 11 AM, which contradicts the earlier Tuesday time.`

Failing update: `The deployment window is Tuesday at 3 PM.`

## Release Readiness

Status: ready for release with documented limitations after the May 16, 2026 memory audit. The lane now emits explicit `memory_evaluation` categories through bundles, API summaries, run receipts, UI drilldowns, and exports.
