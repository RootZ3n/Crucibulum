# vision-noisy-text-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | noisy OCR |
| Fixture | `fixtures/vision/vision-noisy-text-001.png` (sha256 `00af5781f07a5bc4d94af48012b790a68777447328194bb10f6cde8974663239`) |
| Scorer | `regex_match` — `^\s*READY\s*$` |
| Experimental | yes |

## Intent

Measure whether the model can recover the word `READY` through a
deterministic 2-layer dotted-noise overlay. The noise is dense but
the underlying glyphs are still recognisable to a competent OCR.

## Fixture facts

- 480×240 PNG, ~3.2 KB.
- Body word `READY` rendered in the default font at the centre.
- Two dotted noise layers (grey + dull-red dots on a 6×9-px grid)
  cover the entire body area.
- Header reads `noisy-text fixture · phase 14`.

## Expected PASS

- Response is exactly `READY` (case-sensitive, optional whitespace).

## Expected FAIL

- Lowercase `ready` (the prompt says READY explicitly; this is a
  deliberate strict contract — adjustable in a later phase if it
  starts firing on calibration-quality models).
- Refusal / "image is too noisy".
- Inventing a word that's not present.

## Pass examples

- `READY`

## Fail examples

- `ready`
- `It says READY but is noisy.` (prose)
- `RE/4DY` (garbled OCR)

## False-pass risks

- Low. Strict exact-match.

## False-fail risks

- Case mismatch.
- Polite preamble.

## Known limitations

- Strict casefold contract. The intent is "did the OCR succeed
  cleanly under noise". A future phase can introduce case-insensitive
  variants if reasonable models keep tripping.

## Human review needed

No — deterministic regex.
