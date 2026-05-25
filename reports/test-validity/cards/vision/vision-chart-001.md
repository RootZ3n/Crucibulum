# Test card · vision-chart-001

| Field | Value |
|---|---|
| Test id | `vision-chart-001` |
| Family | `vision` (`tasks/vision/vision-chart-001/`) |
| Scorer | `regex_match` accepting `Wednesday` or `Wed` |
| Status | **EXPERIMENTAL** — pending live smoke |
| Concision is part of the test | **Yes** — explicit "Reply with ONLY the day". |

## What this test claims to measure

Chart reading: can the model identify the peak bar in a simple
synthetic bar chart and name its day-of-week label?

## Exact fixture

- Path: `fixtures/vision/vision-chart-001.png`
- sha256: `c64f6e3e21a9d5bd28ac626377496682a28306656943f0f09ab5b8cb5120590c`
- Five bars (Mon..Fri) with values 35/52/87/41/60. Peak `Wed` at 87, rendered in red so it's visually unambiguous.

## Exact prompt

> Look at this bar chart. Reply with ONLY the day of the week with the highest bar.

## Expected answer

`Wednesday` or `Wed`.

## Scorer

`regex_match` with `^\s*(Wednesday|Wed)\s*$`, `maxLength: 16`.

## What counts as pass

- Response is `Wednesday` or `Wed` (whitespace-tolerant).

## What counts as fail

- Wrong day (`Tuesday`, `Friday`).
- Verbose answer (`The peak is on Wednesday at 87`).
- Multiple days listed.

## What would be a false fail

- Model says `wednesday` (lowercase). Regex is case-insensitive via the `i` flag in the scorer? Actually no — `^\s*(Wednesday|Wed)\s*$` is case-sensitive in the current matcher. Acceptable trade-off for an exact-day-name test; could be loosened later if real models flap on case.

## What would be a false pass

- None identified. The regex requires the literal day string and nothing else.

## Audit history

- 2026-05-25 — scaffolded; live smoke deferred (not in the smoke default set).
