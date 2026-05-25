# Test card · vision-ocr-001

| Field | Value |
|---|---|
| Test id | `vision-ocr-001` |
| Family | `vision` (`tasks/vision/vision-ocr-001/`) |
| Scorer | `regex_match` (strict — see "concision part of test" below) |
| Status | **VALID_STRICT_NUMERIC** — Vision/Experimental |
| Concision is part of the test | **Yes.** This is the canonical OCR-of-an-exact-digit test. |

## What this test claims to measure

Exact OCR of a literal printed number on a synthetic receipt fixture.
The model must read the digits and return ONLY the number.

## Exact fixture

- Path: `fixtures/vision/vision-ocr-001.png`
- sha256: `e71bc6515656bf881bde4f1314fc0d2694d0494727950ff6117fd37ebd564822`
- Synthetic receipt rendered by `scripts/generate-vision-fixtures.py`
- Body text: `CRUCIBLE 425`

## Exact prompt

> Read the large number printed on this receipt. Reply with ONLY the number.

## Expected answer

`425`

## Scorer

`regex_match` with pattern `^\s*425\s*$`, `maxLength: 12`. Strict by design — this is the OCR-precision test in the suite.

## What counts as pass

- Response is whitespace + `425` + whitespace.

## What counts as fail

- Wrong number (`42`, `4250`, `42.5`).
- Verbose answer (`The number is 425`, `425 dollars`).
- Empty / refusal.

## What would be a false fail

- Model answers `425.0` or `$425` — would fail today. Acceptable: the test is exact-OCR by design.

## What would be a false pass

- None identified. The pattern matches only the literal `425` token.

## Audit history

- 2026-05-25 — Live smoke against OpenRouter / `xiaomi/mimo-v2-omni` returned **PASS**. Model correctly OCR'd `425`. Cost $0.0001.
