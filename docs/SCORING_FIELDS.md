# Crucible — scoring fields (composite vs correctness)

| Field | Meaning |
|---|---|
| `score.total` / `score.total_percent` | **Composite** score — the lane composite (`correctness×0.85 + efficiency×0.15` for conversational tests; weighted blend of correctness/regression/integrity/efficiency for repo-mode tests). Bounded `[0, 1]` / `[0, 100]`. **May not match the binary-question anchors.** |
| `score.breakdown.correctness` / `score.breakdown_percent.correctness` | **Correctness** — the per-question rollup. For tests with binary scorers (`text_match_all`, `regex_match`, `numeric_fact_match`, etc.) the legal values are exactly `sum_of_passing_weights / total_weight`. For a 3-question equal-weight binary test that means `{0, 33.33, 66.67, 100}` and nothing in between. |
| `score.breakdown.efficiency` / `score.breakdown_percent.efficiency` | **Efficiency credit** — time/token budget headroom. 0–1. Feeds the composite at 15% for conversational tests. |
| `score.breakdown.regression` / `….integrity` | Repo-mode only: regression-safety and integrity-violation credits. 0/1 or fractional. |
| `score.pass_threshold` / `…_percent` | Pass cut for the **composite**. Defaults vary by lane. |

## Why the distinction matters

The 2026-05-27 scoring-integrity audit
(`reports/scoring-integrity/context-degradation-001/`) traced a
reported "impossible 43" on `context-degradation-001` to a
field-confusion. The test has 3 binary `text_match_all` questions,
weight 3 each — so the only legal `score.breakdown_percent.correctness`
values are `{0, 33.33, 66.67, 100}`. The "43" came from
`score.total_percent`, the lane composite. The conversational
composite formula is:

```
combineConversationalScore(correctness, efficiency):
  if (correctness <= 0) return 0;
  return round((correctness * 0.85 + efficiency * 0.15) * 100) / 100;
```

So for 1-of-3 PASS at `efficiency ≈ 1.0`:
`0.3333 * 0.85 + 1.0 * 0.15 = 0.4333` → rounded → `0.43` → **43%**.

The legal composite anchors for `context-degradation-001` (at
`efficiency = 1.0`) are therefore exactly `{0, 43, 72, 100}` —
**not** the binary correctness anchors. Both the composite and
the correctness fields are correct; they just measure different
things.

The same pattern applies to every conversational test that uses
binary scorers and gets non-trivial efficiency credit. The
composite is what the lane-level "did this run pass" gate uses;
the correctness rollup is what to inspect for raw per-question
accuracy.

## Where each field is surfaced

### UI (`renderFocusedRun` inspector)

- **COMPOSITE** big number — `result.overall` (`score.total_percent`).
  Hover-tooltip explains the blend formula and links here.
- A breakdown sub-line directly under the COMPOSITE number shows
  `correctness X% · efficiency Y% · formula: correctness×85% +
  efficiency×15%` when both fields are present.
- **CORRECTNESS** glyph in the operational readout — the per-
  question rollup. Hover-tooltip explains the binary-anchor
  property and links here.
- **EFFICIENCY CREDIT** glyph — paired with correctness so the
  two halves of the conversational composite are visible side
  by side.

### Markdown reports (per-bundle, under `core/*-reporting.ts`)

Each per-bundle report now uses **`composite_score=`** instead of
the older `score=` to make the field-confusion impossible. All six
reporting modules (`poison-reporting.ts`, `safety-reporting.ts`,
`benchmark-reporting.ts`, `build-reporting.ts`,
`personality-reporting.ts`, `memory-reporting.ts`) print:

```
composite_score=<total_percent>%
correctness=<breakdown_percent.correctness>%
…
```

Old reports on disk still say `score=` — they are immutable
evidence and are not rewritten.

### Scoring invariant (`core/scoring-invariant.ts`)

The Phase 14 scoring-invariant module operates on the two fields
separately:

- `enumerateBinaryConversationalCorrectnessSet(questions)` — the
  legal `correctness` set for a strictly-binary conversational
  manifest.
- `enumerateBinaryConversationalCompositeAnchors(questions, efficiency)`
  — the legal `(correctness, composite)` anchor list at a given
  efficiency.
- `validateBinaryConversationalBundleScoreShape(manifest, bundle)`
  — read-only check that flags `BREAKDOWN_OUT_OF_SET` (correctness
  not in the binary set) or `INVALID_SCORE_SHAPE` (composite ≠
  `combineConversationalScore(correctness, efficiency)`) without
  modifying the bundle.

If a bundle's composite differs from the formula by more than the
rounding tolerance (0.005), the invariant flags
`INVALID_SCORE_SHAPE` — that's a real pipeline bug, not the
composite-vs-correctness confusion this doc addresses.

## Cross-reference

- Scoring-integrity audit:
  `reports/scoring-integrity/context-degradation-001/2026-05-27T01-24-28Z.md`
  (root cause: `VALID_HISTORICAL_SCORING_CONTRACT`).
- Per-bundle reconstruction:
  `reports/scoring-integrity/context-degradation-001/2026-05-27T01-24-28Z-score-reconstruction.md`
  (every legal anchor enumerated; every on-disk bundle classified).
- Conversational composite formula:
  `core/conversational-runner.ts:358` (`combineConversationalScore`).
- Repo-mode composite formula:
  `core/bundle.ts:141` (`combineWeightedScore`).
- Invariant module: `core/scoring-invariant.ts`.
