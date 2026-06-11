# vision-ui-state-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | UI screenshot reasoning (disabled-state recognition) |
| Fixture | `fixtures/vision/vision-ui-state-001.png` (sha256 `14036a53b5f05944a7abaa7b1734bcae38ed2035864cd89eb68b5749e1986304`) |
| Scorer | `text_match` — pass-phrase `delete`, max_chars 80 |
| Experimental | yes |

## Intent

A mock action panel with three buttons (SAVE / CANCEL / DELETE).
DELETE is visually disabled — dark-grey background, reduced-contrast
text label, plus a tiny lock glyph next to it. The model must
identify the disabled action.

## Fixture facts

- 600×240 PNG, dark-card mock UI.
- SAVE: bright green background, white label.
- CANCEL: neutral grey background, white label.
- DELETE: dark grey background, **dim** white label (low-contrast),
  plus a small lock glyph (rectangle + arc) to the right of the label.

## Expected PASS

- Response contains `delete` within 80 chars.

## Expected FAIL

- Names `save` or `cancel` as disabled.
- Lists all three (cap prevents pass on the listy answer).

## Pass examples

- `Delete.`
- `The DELETE button is disabled.`

## Fail examples

- `Save.`
- `SAVE, CANCEL, DELETE` (lists all three; over 80 chars or includes the SAVE/CANCEL labels in conflict; substring `delete` would pass but operators should phrase the question to discourage listy answers).

## False-pass risks

- Bare `delete` substring would PASS even if the model said "save,
  cancel, delete" (and the cap admits it). Acceptable for a POC
  contract; a future tightening could require an enabled/disabled
  framing word.

## False-fail risks

- A model that uses `removed`, `disabled action: removal` would
  fail unless `delete` substring appears. Could be expanded by
  adding `remove` to the pass-phrase list later.

## Known limitations

- The visual signal for disabled state is contrast + lock glyph.
  Models that rely on text colour alone may need calibration.

## Human review needed

No.
