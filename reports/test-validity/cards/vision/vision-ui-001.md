# Test card · vision-ui-001

| Field | Value |
|---|---|
| Test id | `vision-ui-001` |
| Family | `vision` (`tasks/vision/vision-ui-001/`) |
| Scorer | `text_match` (Phase 6: ANY of `RUN BENCHMARK` / `Run Benchmark` / `run benchmark`) |
| Status | **EXPERIMENTAL** — Phase 6 live smoke pending |
| Concision is part of the test | **No** — answer can be free text as long as the element is named. |

## What this test claims to measure

UI screenshot diagnosis: can the model identify the clipped/overflowing
UI element by name from a synthetic dashboard mock?

## Exact fixture

- Path: `fixtures/vision/vision-ui-001.png`
- sha256: `b7e842d8acf1ddbb35c7bf34ba267053d9ad37bfa9083936b144e9b35a4d753a`
- Synthetic dashboard mock with a `RUN BENCHMARK >>` button overflowing its card boundary.

## Exact prompt

> Look at this UI screenshot. Which UI element is most-clipped or overflowing its container? Name the element.

(Phase 6 update: prompt softened — no longer "Reply with element name only"; element identification is the test, not concision.)

## Expected facts

ANY of `RUN BENCHMARK` / `Run Benchmark` / `run benchmark` / `RUNBENCHMARK` must appear in the response. (Case-insensitive via the underlying `contains` helper.)

## Scorer

`text_match` (ANY-of) with `pass_phrases: ["RUN BENCHMARK", "Run Benchmark", "run benchmark", "RUNBENCHMARK"]`.

## What counts as pass

- Response contains the literal `RUN BENCHMARK` (case-sensitive currently — see false-fail risk).

## What counts as fail

- Names a different element (`Provider Bay`, `Active Arena`, `Crucible logo`).
- Names a generic concept (`the button`, `the primary action`) without including `RUN BENCHMARK`.
- Refusal / "I cannot see clearly".

## What would be a false fail

- Model answers `the Run Benchmark button` (lowercase) — would fail today. Could be relaxed to case-insensitive in a follow-up, but the manifest currently asks the operator to verify the rendered text exactly.

## What would be a false pass

- Model hallucinates the phrase even though the image is unreadable. Mitigation: judge rubric in a follow-up phase.

## Audit history

- 2026-05-25 — scaffolded; live smoke deferred until Phase 5+ (not in the smoke default set).
