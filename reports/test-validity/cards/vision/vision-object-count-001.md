# Test card · vision-object-count-001

| Field | Value |
|---|---|
| Test id | `vision-object-count-001` |
| Family | `vision` (`tasks/vision/vision-object-count-001/`) |
| Scorer | `numeric_fact_match` (NEW Phase 5 scorer) |
| Status | **EXPERIMENTAL** — recalibrated 2026-05-25 |
| Concision is part of the test | **No.** This is recognition + counting only. |

## What this test claims to measure

**Visual recognition and counting.** Can the model identify the
discrete coloured objects in the image and count them correctly?

Explicitly NOT measured here: token efficiency, instruction-following
on "Reply with ONLY X" phrasing. A future `vision-concise-answer-001`
test will measure that separately so the two capabilities don't get
conflated.

## Exact fixture

- Path: `fixtures/vision/vision-object-count-001.png`
- sha256: `88d142f1f1d852b924adee1fef3209f39f6de4a5dd40ef9b0d77b70bf876aed0`
- Seven equally-sized red dots on a white background, non-overlapping,
  rendered by `scripts/generate-vision-fixtures.py`.

## Exact prompt

> How many red dots are in this image?

(Phase 5 update: removed the "Reply with ONLY the number" suffix —
this test isn't about concision.)

## Expected answer

The correct count: **7** (or `seven`), plus the literal phrase
`red dot` (or `red dots`) to prove the model is reasoning about the
right objects, not just emitting a number.

## Scorer

`numeric_fact_match`:
- `expected_number: 7`
- `expected_number_variants: ["7", "seven"]`
- `required_object: "red dot"`
- `max_chars: 600`

## What counts as pass

- `7` (with `red dot` substring somewhere in ≤ 180 chars)
- `There are 7 red dots.`
- `I see seven red dots.`
- `Seven red dots are visible.`
- `7 red dots, equally spaced.`

## What counts as fail

- **Wrong count** — `6 red dots`, `8 red dots`, `Eight red dots`. Reason carries "wrong count: expected 7, model said 6".
- **Missing object/colour** — `7 of them`, `seven`. Reason carries "missing required object/colour: red dot".
- **Too verbose** — > 600 chars. Reason carries "answer too verbose: N chars (max_chars 600)". The cap is generous because vision models commonly narrate their counting reasoning; a real rambler will go far past 600 chars.
- **Refusal / empty.**

## What would be a false fail

- Model says `there are 7 spots` (uses "spots" not "dots"). Today this fails on the `required_object` check. Acceptable: the test is about recognising "red DOTS"; if the operator wants to accept "spots" too, they widen `required_object` to a regex or use `expected_number_variants` differently in a follow-up.

## What would be a false pass

- Model says `7 days a week, 7 red dots` — passes today even though the first `7` is irrelevant. Acceptable for an MVP scorer; the second mention of `7` next to `red dots` is the correct content.
- Model says `not 7, but 6 red dots` — would pass today because `7` appears as a standalone digit. This is a known limitation of substring scoring; mitigation is the rubric judge in a future phase.

## Audit history

- **2026-05-25 (Phase 4)** — Live smoke against OpenRouter / `xiaomi/mimo-v2-omni` returned `FAIL_PRODUCT` because the old `regex_match` scorer with `maxLength: 12` rejected the 592-char natural-language answer "To determine the number of red dots, I need to count them carefully… There are 7 red dots." Operator flagged this as scorer-contract brittleness, not a real model failure.
- **2026-05-25 (Phase 5)** — Switched scorer to `numeric_fact_match` (NEW); manifest version bumped 1.0.0 → 1.1.0; prompt loosened (removed "Reply with ONLY the number"). Re-smoke confirms PASS with the recalibrated scorer.
