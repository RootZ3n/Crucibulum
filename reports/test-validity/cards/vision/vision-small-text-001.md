# vision-small-text-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C (Vision suite expansion 5 → 15) |
| Category | small-text OCR |
| Fixture | `fixtures/vision/vision-small-text-001.png` (sha256 `be21823275da8a745482a2d30e6d10c23c9e0e8698e537e6118296b243d5d7ce`) |
| Scorer | `regex_match` — `^\s*8273\s*$` |
| Experimental | yes; not in leaderboard / not in certification |

## Intent

Measure whether a model can OCR a small but cleanly-rendered 4-digit
number on a flat synthetic panel. Discriminates models that can only
read large title-style text from models that can read smaller body
text under the same image-transport path.

## Fixture facts

- 400×160 PNG, ~3.6 KB.
- Header bar reads `small-text fixture · phase 14`.
- Body label `Receipt ID:` followed by `8273`.
- Right-side distractor `(internal)`.
- Background `(252,252,252)` (flat off-white); body text `(15,15,22)`.

## Expected PASS

- Response is exactly `8273` (optional leading/trailing whitespace).

## Expected FAIL

- Reads `(internal)` or any other token instead.
- Returns prose like `The number is 8273.` — fails the strict regex.
- Spaces between digits (`8 2 7 3`).

## Pass examples

- `8273`
- `\n8273\n`

## Fail examples

- `The receipt ID is 8273.` (prose, but regex is strict)
- `8 2 7 3`
- `eight two seven three`

## False-pass risks

- Negligible. The 12-char `maxLength` + exact regex prevents
  multi-token answers from sneaking through.

## False-fail risks

- A model that follows the question literally but adds punctuation
  (`8273.`) fails. Acceptable for a token-precision OCR contract;
  re-prompting can fix.

## Known limitations

- The font is PIL's bundled default; some models may render it as
  bitmap-like. That's the point — small-text OCR is supposed to be
  harder than `vision-ocr-001`.

## Human review needed

No — deterministic regex.
