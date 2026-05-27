# vision-chart-trend-001 — test-validity card

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C |
| Category | chart reading (monotonic trend) |
| Fixture | `fixtures/vision/vision-chart-trend-001.png` (sha256 `fdfe03655c49522e62579f0572ee5fd3ff2b62ffe4b73960a11e0d7fca7b3561`) |
| Scorer | `text_match` — pass-phrases `decreasing`, `decreas`, `going down`, `trend down`, `downward`, max_chars 80 |
| Experimental | yes |

## Intent

The fixture is a 5-bar chart with monotonically decreasing values
(200, 160, 120, 80, 40). The model must identify the trend
direction.

## Fixture facts

- 520×320 PNG.
- 5 blue bars, evenly spaced; numeric labels above each bar.
- X axis: D1..D5. Y axis: synthetic volume.

## Expected PASS

- Response contains any decreasing-direction indicator within 80
  chars.

## Expected FAIL

- Says `increasing` or `stable`.

## Pass examples

- `Decreasing.`
- `The trend is going down.`
- `Downward trend.`

## Fail examples

- `Increasing.`
- `Stable.`
- `Mixed.`

## False-pass risks

- Substring `decreas` catches `decrease`, `decreasing`, `decreased`,
  `decreaseable`. Operationally safe.

## False-fail risks

- Synonyms like `falling`, `dropping` would fail. Acceptable
  trade-off for deterministic scoring.

## Known limitations

- Single-trend chart. Doesn't test mixed-direction reasoning.

## Human review needed

No.
