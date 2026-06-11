# vision-table-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | small-table lookup |
| Fixture | `fixtures/vision/vision-table-001.png` (sha256 `e348639f71f3b7687e7b00db02d28e7fdbdac361121cabf186e8192320b87470`) |
| Scorer | `numeric_fact_match` · expected `85` (variants `85`, `eighty-five`, `eighty five`) · max_chars 80 |
| Experimental | yes |

## Intent

A small 3-row scoreboard table. The model must look up the value
for `Bob` and return `85`. Discriminates from confused-row answers
(`72` for Alice, `64` for Carol).

## Fixture facts

- 440×260 PNG.
- Header `NAME | SCORE` on a dark stripe.
- Rows: `Alice 72`, **`Bob 85`**, `Carol 64`.

## Expected PASS

- Response contains `85` within 80 chars AND does not also contain
  a contradicting number (`72` / `64`) appearing like the answer.
  `numeric_fact_match` enforces the contradiction guard.

## Expected FAIL

- Returns `72` (Alice) or `64` (Carol) — wrong row.
- Returns a list `Alice 72, Bob 85, Carol 64` — the `72` and `64`
  trip the contradiction guard.

## Pass examples

- `85`
- `Bob's score is 85.`
- `85 (Bob)`

## Fail examples

- `72`
- `64`
- `Bob is 85, Alice is 72, Carol is 64` (contradiction guard)

## False-pass risks

- Within 80 chars and the contradiction guard, false-pass surface
  is small.

## False-fail risks

- Listy answers fail by design. Re-prompting fixes.

## Known limitations

- Three-row table only. No multi-column lookup test in this phase.

## Human review needed

No.
