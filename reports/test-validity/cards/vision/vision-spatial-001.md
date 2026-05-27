# vision-spatial-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | spatial reasoning (2×2 quadrant) |
| Fixture | `fixtures/vision/vision-spatial-001.png` (sha256 `b6c53d7e8f3d9714a85a12d20ab8eb79690f74386931fee21a9a0def6f364fbd`) |
| Scorer | `text_match` — pass-phrase `blue`, max_chars 80 |
| Experimental | yes |

## Intent

Discriminate the top-right quadrant from the other three. A model
that cannot ground "top-right" or cannot identify the colour
`blue` will fail.

## Fixture facts

- 400×400 PNG, four explicit quadrants split by visible grid lines.
- TL: red square. TR: **blue circle**. BL: green triangle. BR: yellow star.
- All four colours are saturated; no risk of colour-confusion at
  reasonable image-transport resolution.

## Expected PASS

- Response contains `blue` within 80 chars.

## Expected FAIL

- Names the wrong colour (`red`, `green`, `yellow`).
- Lists all four colours — exceeds 80 chars cap.

## Pass examples

- `Blue.`
- `The shape in the top-right is blue.`

## Fail examples

- `red, blue, green, yellow` (lists all four; cap prevents listy answers from passing)
- `green` (wrong quadrant)

## False-pass risks

- A very short answer that just says `blue` correctly is a PASS — by
  design.
- An answer like `not blue` would PASS the bare substring; consider
  adding `text_match_all` with anti-phrases if a future model
  exhibits this. Today no observed model does so on this fixture.

## False-fail risks

- Model uses colour synonyms (`navy`, `cobalt`). Operationally none
  observed.

## Known limitations

- `text_match` is substring-based. Strong enough for single-colour
  answers under the 80-char cap.

## Human review needed

No.
