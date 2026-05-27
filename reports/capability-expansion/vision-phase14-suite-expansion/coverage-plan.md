# Crucible — Vision Phase 14 / Roadmap C coverage plan (5 → 15 tests)

| Field | Value |
|---|---|
| Phase | 14 / Roadmap C — Vision suite expansion 5 → 15 tests |
| Doctrine target | `CAPABILITY_CERTIFIED` suite-size gate (`minSuiteSize: 15`) |
| Affects leaderboard | **No** (Vision stays excluded) |
| Affects certification | **No** (no model/capability promotion) |

## Doctrine coverage targets

`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md` calls out the categories
a CAPABILITY_CERTIFIED Vision suite must exercise:

- OCR
- object count
- chart reading
- UI screenshot reasoning
- uncertainty honesty
- spatial reasoning
- small text / noisy text
- visual contradiction
- multi-object comparison
- hallucination resistance

## Current 5 tests (preserved unchanged)

| ID | Category | Scorer | Fixture sha256 source |
|---|---|---|---|
| `vision-ocr-001` | OCR | `regex_match` | locked, manifest v1.0.0 |
| `vision-ui-001` | UI screenshot reasoning | `text_match` | locked, manifest v1.0.0 |
| `vision-chart-001` | chart reading | `numeric_fact_match` | locked, manifest v1.0.0 |
| `vision-object-count-001` | object count | `numeric_fact_match` | locked, manifest v1.0.0 |
| `vision-uncertainty-001` | uncertainty honesty | `uncertainty_honesty` | locked, manifest v1.2.0 (Phase 10 v2 fixture) |

All 5 fixtures + hashes + manifests are **preserved unmodified** in
Phase 14. Tests P3 in the Phase-14 test file asserts no existing
hash was overwritten.

## 10 new tests (Phase 14)

| # | ID | Category | Scorer | Fixture | False-pass risk | False-fail risk |
|---|---|---|---|---|---|---|
| 6 | `vision-small-text-001` | small text OCR | `regex_match` | small "8273" digits | model OCRs partial number | model can't read tiny font on some pipelines |
| 7 | `vision-noisy-text-001` | noisy OCR | `regex_match` (variants) | noisy "READY" | matches any 5-letter token | refuses noisy text |
| 8 | `vision-spatial-001` | spatial reasoning (2x2) | `text_match` (color names) | 4-quadrant colored shapes | model name-drops every color | model misidentifies quadrant |
| 9 | `vision-spatial-002` | spatial reasoning (3x3) | `text_match` (row variants) | star in row-2 of 3x3 | model says "row 1 or 2" | model uses 0-indexed row |
| 10 | `vision-visual-contradiction-001` | visual contradiction | `text_match_all` | text says "3 squares", picture shows 2 circles | accepts a one-sided answer | model doesn't notice mismatch |
| 11 | `vision-hallucination-resistance-001` | hallucination resistance | **`absence_honesty` (NEW)** | only 2 apples, prompt asks about absent banana | accepts "yes there's a banana" via substring tricks | overly strict on hedged answers |
| 12 | `vision-multi-object-compare-001` | multi-object comparison | `text_match_all` | 5 squares of different sizes, target = largest color | model lists all colors | size confusion |
| 13 | `vision-ui-state-001` | UI screenshot reasoning | `text_match` | mock UI with disabled DELETE button | answers "save" (also visible) | model can't read disabled-state styling |
| 14 | `vision-chart-trend-001` | chart reading | `text_match` | 5-point bar chart, decreasing trend | accepts either direction word | uses ambiguous wording |
| 15 | `vision-table-001` | multi-object / table | `numeric_fact_match` (digit) | 3-row table, Bob/85 | picks wrong row | misreads column |

### Coverage-vs-category matrix

| Category | 5 POC tests | + 10 new tests | Suite total |
|---|:--:|:--:|:--:|
| OCR | 1 (`ocr-001`) | +2 (`small-text-001`, `noisy-text-001`) | 3 |
| object count | 1 (`object-count-001`) | +1 (`multi-object-compare-001`) | 2 |
| chart reading | 1 (`chart-001`) | +1 (`chart-trend-001`) | 2 |
| UI screenshot reasoning | 1 (`ui-001`) | +1 (`ui-state-001`) | 2 |
| uncertainty honesty | 1 (`uncertainty-001`) | — | 1 |
| spatial reasoning | 0 | +2 (`spatial-001`, `spatial-002`) | 2 |
| small / noisy text | 0 | +2 (`small-text-001`, `noisy-text-001` — overlap with OCR) | 2 |
| visual contradiction | 0 | +1 (`visual-contradiction-001`) | 1 |
| multi-object comparison | 0 | +1 (`multi-object-compare-001`) | 1 |
| hallucination resistance | partial (uncertainty) | +1 (`hallucination-resistance-001`) | 2 |
| **Total fixtures** | **5** | **+10** | **15** |

Every doctrine category is covered by at least one test post-Phase-14.

## Scorer plan

Reuse the existing scorer registry where it covers the case
correctly:

- `regex_match` — `vision-small-text-001`, `vision-noisy-text-001`
- `text_match` / `text_match_all` — `vision-spatial-001`,
  `vision-spatial-002`, `vision-visual-contradiction-001`,
  `vision-multi-object-compare-001`, `vision-ui-state-001`,
  `vision-chart-trend-001`
- `numeric_fact_match` — `vision-table-001`

Add **one** new scorer:

- **`absence_honesty`** — used by `vision-hallucination-resistance-001`.
  PASS if the answer contains a denial token AND does not also
  contain a confident-presence claim for the absent object. FAIL
  if the answer asserts the absent object is present. NEEDS_REVIEW
  if hedged ("might be a banana"). Mirrors the structure of
  `uncertainty_honesty` (semantic-first, marker reasons).

No `spatial_relation_match` or `table_fact_match` is needed —
`text_match` / `text_match_all` / `numeric_fact_match` cover those
patterns cleanly. Rationale: every new scorer is a maintenance
liability and a contamination risk; only add when an existing one
can't safely cover the contract.

## Fixture-generation contract

Extend `scripts/generate-vision-fixtures.py` with deterministic
`make_<id>()` functions. Constraints:

- All synthetic, no copyrighted content, no PII.
- All under 50 KB per fixture.
- All rendered with PIL's default font + simple shape primitives.
- Re-running the generator must produce byte-identical PNGs (so
  manifest sha256s stay stable across operators).
- Each new function pinned by name in the generator's `main()`
  function so a hash-stability test can iterate the canonical list.

## Out-of-scope

- **No promotion.** Even with 15 tests, the doctrine evaluator still
  blocks `CAPABILITY_CERTIFIED` on `independent-routes` (1 < 3).
  Roadmap Phase E adds the third route. Phase 14 only addresses
  the suite-size gate.
- **No judge-model scorers.** Every new scorer is deterministic.
  Roleplay Phase F is the future judge-rubric phase.
- **No leaderboard impact.** `TAB_CONFIG.vision.scoreFamilies` stays
  `[]`. Every new manifest declares `experimental:true` +
  `affectsLeaderboard:false` + `affectsCertification:false`.
- **No certified-models.json mutation.** Read-only addition of
  fixtures + manifests + scorer.
