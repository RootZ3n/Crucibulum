# vision-multi-object-compare-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | multi-object comparison |
| Fixture | `fixtures/vision/vision-multi-object-compare-001.png` (sha256 `7f9f598f10e49559e73186233c734c8a0a8ab6fc3f2ba9d119230f277c446ddb`) |
| Scorer | `text_match` — pass-phrase `blue`, max_chars 80 |
| Experimental | yes |

## Intent

Five coloured squares of distinct sizes. The blue square (110×110)
is the largest. The model must identify the largest by colour.

## Fixture facts

- 560×280 PNG.
- Squares left-to-right: red 60×60, green 80×80, yellow 70×70,
  orange 90×90, **blue 110×110**.
- Sizes are visually unambiguous (50% delta from second-largest).

## Expected PASS

- Response contains `blue` within 80 chars.

## Expected FAIL

- Names a smaller square (`orange`, `green`, etc.).

## Pass examples

- `Blue.`
- `The blue square is the largest.`

## Fail examples

- `Orange.`
- `red, green, yellow, orange, blue` (lists all five; cap prevents pass)

## False-pass risks

- Same `text_match` bare-substring caveat as `vision-spatial-001`.
  80-char cap mitigates.

## False-fail risks

- A model that says `cobalt` or `navy` would fail. Acceptable for
  this POC.

## Known limitations

- Single-axis size comparison only. A future test could ask "which
  is smallest of those above a threshold" to stress reasoning.

## Human review needed

No.
