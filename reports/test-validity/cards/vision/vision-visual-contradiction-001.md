# vision-visual-contradiction-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | visual contradiction |
| Fixture | `fixtures/vision/vision-visual-contradiction-001.png` (sha256 `f34b14c8f4f8f774625e625875db4502f187aa9a8c722864182aa682ca0b2b93`) |
| Scorer | `text_match_all` — requires all of `red`, `circle`, `two`, max_chars 240 |
| Experimental | yes |

## Intent

Caption above the image reads `Three blue squares.` but the actual
picture is **two red circles**. The model must describe the actual
picture content (red + circle + two) rather than agreeing with the
caption.

## Fixture facts

- 500×320 PNG.
- Top stripe (dark blue) carries the caption text.
- Picture area below: two red circles.

## Expected PASS

- Response contains `red` AND `circle` AND `two`, all within 240
  chars.

## Expected FAIL

- Agreeing with the caption (`three blue squares`).
- Listing only one of the three required facts.
- Exceeding 240 chars before all three facts appear.

## Pass examples

- `Two red circles. The caption is wrong.`
- `The picture has two red circles, not three blue squares as the caption claims.`

## Fail examples

- `Three blue squares.` (echoes caption)
- `I see red shapes.` (missing `circle` and `two`)
- `I see two circles.` (missing `red`)

## False-pass risks

- Listy "all-colours, all-shapes, all-counts" answers within 240
  chars could accidentally include all three tokens. Cap is set so
  a clean factual answer fits while a buzzword salad doesn't.

## False-fail risks

- Synonyms (`pair` for `two`, `dot` for `circle`). Acceptable cost
  of staying deterministic in this phase.

## Known limitations

- `text_match_all` is substring-based; a model that says `not red,
  not circle, not two` would technically PASS. Live evidence does
  not show this pattern.

## Human review needed

No.
