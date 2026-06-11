# vision-spatial-002 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | spatial reasoning (3×3 row identification) |
| Fixture | `fixtures/vision/vision-spatial-002.png` (sha256 `40fc8f8c9dc606ccc2447dbf3617019a7baa6de2fdaa3ddd3245781fe0d9a187`) |
| Scorer | `text_match` — pass-phrases include `row 2`, `row two`, `2nd row`, `second row`, ` 2`, `middle row` |
| Experimental | yes |

## Intent

The model must identify which numbered row of a 3×3 grid contains a
star. Rows + columns are visibly labelled `1`/`2`/`3` so the
grounding is unambiguous.

## Fixture facts

- 420×420 PNG.
- 3×3 grid with thin grey grid lines.
- Single red star at the **centre** cell (row 2, column 2).
- Row labels `1`/`2`/`3` on the left; column labels `1`/`2`/`3` on
  the top.

## Expected PASS

- Answer references row 2 (or "second" / "middle") within 80 chars.

## Expected FAIL

- Answer says `row 1` or `row 3` (wrong row).
- Answer uses 0-indexed terminology (`row 1` for the middle row).

## Pass examples

- `Row 2.`
- `The second row.`
- `Middle row.`

## Fail examples

- `Row 1.`
- `Row 3.`

## False-pass risks

- The pass-phrase ` 2` (leading space) catches answers like
  `Position is at 2`. Within 80 chars this rarely picks up
  false-positive `2`s (e.g. a count of 2 stars would already be
  wrong-fact and would not appear here because the fixture has 1
  star).

## False-fail risks

- Synonyms (`middle band`, `central row`) — would need explicit
  addition if observed.

## Known limitations

- Cross-row answers like `row 1 or 2` would PASS on substring `2`.
  Live evidence on v2.5 in Phase 14 does not show this. If it
  starts happening, switch to `text_match_all` with an anti-phrase
  list.

## Human review needed

No.
