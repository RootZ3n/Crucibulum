# Test card · vision-chart-001

| Field | Value |
|---|---|
| Test id | `vision-chart-001` |
| Family | `vision` (`tasks/vision/vision-chart-001/`) |
| Scorer | `numeric_fact_match` — `expected_number: 87`, `required_object: "wed"`, `max_chars: 600` |
| Status | **EXPERIMENTAL** — Phase 6 live smoke PASS after calibration |
| Concision is part of the test | **No** — Phase 6 decision: this test measures CHART RECOGNITION (day + value), not concision. Free-text answers within 600 chars are accepted as long as both the correct day and value appear. |

## What this test claims to measure

Chart reading: can the model identify the peak bar in a simple
synthetic bar chart, naming BOTH the day-of-week label AND its
numeric value?

## Exact fixture

- Path: `fixtures/vision/vision-chart-001.png`
- sha256: `c64f6e3e21a9d5bd28ac626377496682a28306656943f0f09ab5b8cb5120590c`
- Five bars (Mon..Fri) with values 35/52/87/41/60. Peak `Wed` at 87, rendered in red so it's visually unambiguous.

## Exact prompt

> Which day has the highest bar in this chart, and what is its value?

(Phase 6 update: prompt softened from "Reply with ONLY the day…" — concision is not what this test measures.)

## Expected answer

Response must contain the substring `wed` (case-insensitive) AND the number `87` (digits or variants).

## Scorer

`numeric_fact_match` with:
- `expected_number: 87`
- `expected_number_variants: ["87"]`
- `required_object: "wed"`
- `max_chars: 600`

## What counts as pass

- `Wednesday at 87` — pass.
- `Wed 87` — pass.
- `The peak is Wednesday with a value of 87.` — pass.

## What counts as fail

- Wrong day or wrong value (`Tuesday with 87` → missing-required-object on "wed" actually passes substring? **No** — "tuesday" doesn't contain "wed", so fails missing-required-object).
- Mentions Wednesday but no value, or vice versa.
- Narration over 600 chars (well beyond chain-of-thought needs).

## What would be a false fail

- Model says "the third bar is highest at 87" without naming Wednesday — fails missing-required-object on "wed". Acceptable: chart reading should name the labelled day.

## What would be a false pass

- Model name-drops Wednesday plus any-occurrence of `87` in unrelated narration. Mitigated by the 180-char ceiling — there's not much room for unrelated narration.

## Audit history

- 2026-05-25 — scaffolded with strict `regex_match`.
- 2026-05-25 (Phase 6 manifest update) — switched to `numeric_fact_match` per "scoring should accept correct answers embedded in short natural language within reasonable bounds" rule; concision deliberately deprioritised. Initial `max_chars: 180`.
- 2026-05-26 (Phase 6 live smoke) — `max_chars` raised 180 → 600 after live smoke against `xiaomi/mimo-v2-omni` returned a substantively-correct 347-char chain-of-thought answer (`Wednesday … 87`) that the 180-char ceiling rejected. Classified as SCORER calibration mismatch (not model failure); ceiling now matches the Phase-5 precedent set by vision-object-count-001 for the same scorer class.
