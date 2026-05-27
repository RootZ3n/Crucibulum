# Crucible — context-degradation-001 score reconstruction

| Field | Value |
|---|---|
| Test | `context-degradation-001` |
| Family | `truthfulness` (conversational) |
| Manifest version | `1.0.0` (single version on disk; no historical drift) |
| Subquestions | **3** (CTX1-Q1, CTX1-Q2, CTX1-Q3) |
| Per-question scorer | `text_match_all` (binary: ALL `pass_phrases` must appear → full weight; else 0) |
| Per-question weight | **3** (each) |
| Max raw score | **9** |
| Pass threshold | 0.70 |

## 1. Possible per-question scores

Each question is binary under `text_match_all`. Per-question
possibilities: `{0, 3}`. Weighted normalised correctness for the
test: `sum / 9`.

| Pass mix | Raw total | `correctness` (normalised) | `correctness` % |
|---|---:|---:|---:|
| 0 of 3 | 0 | 0.0000 | 0% |
| 1 of 3 | 3 | 0.3333… | **33.33%** |
| 2 of 3 | 6 | 0.6667… | **66.67%** |
| 3 of 3 | 9 | 1.0000 | 100% |

These are the only legal values for the `score.breakdown.correctness`
/ `score.breakdown_percent.correctness` field. The 5 raw possibilities
collapse to 4 normalised buckets because the all-fail and all-pass
edges are the same value across the per-question multinomial.

## 2. Composite (total) score formula

Conversational total composite — `core/conversational-runner.ts:358`
`combineConversationalScore(correctness, efficiency)`:

```
if (correctness <= 0) return 0;
return round((correctness * 0.85 + efficiency * 0.15) * 100) / 100;
```

The composite blends correctness (0.85) and efficiency (0.15).
Efficiency credit is **gated on non-zero correctness** so a
fully-failing run does NOT float to 15%.

For context-degradation-001, all live bundles on disk show
`efficiency: 1` (short prompts, well under the time/token budget),
so the only varying input is `correctness`. The legal composite
totals are therefore:

| Pass mix | `correctness` | `efficiency` | `total` raw | `total_percent` |
|---|---:|---:|---:|---:|
| 0 of 3 | 0.0000 | 1.0 | 0.00 | **0** |
| 1 of 3 | 0.3333 | 1.0 | `0.3333*0.85 + 0.15 = 0.4333…` → round 2dp → **0.43** | **43** |
| 2 of 3 | 0.6667 | 1.0 | `0.6667*0.85 + 0.15 = 0.7167…` → round 2dp → **0.72** | **72** |
| 3 of 3 | 1.0000 | 1.0 | `1.0 * 0.85 + 0.15 = 1.00` | **100** |

So **43** is the legitimate, deterministic composite for "1 of 3
questions passed with efficiency ≈ 1.0" — exactly the regime almost
every observed bundle is in.

If efficiency dips (longer/larger model), the composite will land
between these anchors but stay within `[0, 100]`. Efficiency = 0.5
on the 1-of-3 case → `0.3333*0.85 + 0.5*0.15 = 0.358 → round → 0.36`,
i.e. 36%. So in practice the dominant observed value for any
conversational task with deterministic budget headroom and a
binary 1-of-3 outcome is 43.

## 3. Observed bundle evidence

The 15 `context-degradation-001` bundles on disk under `runs/` —
all 14 conversational bundles + 1 mock — confirm the pattern.
Below, per-question PASS/FAIL is what the `text_match_all` scorer
returned at run time:

| Bundle | Per-Q | correctness | total | total_% |
|---|---|---:|---:|---:|
| `…_google-gemini-3.1-flash-lite` | 3/3 PASS | 1.0000 | 1.00 | 100 |
| `…_xiaomi-mimo-v2-flash` (2026-05-14) | 3/3 PASS | 1.0000 | 1.00 | 100 |
| `…_x-ai-grok-4.3` | 1/3 PASS (Q2) | 0.3333 | 0.43 | 43 |
| `…_xiaomi-mimo-v2-flash` (2026-05-18) | 1/3 PASS (Q2) | 0.3333 | 0.43 | 43 |
| `…_google-gemini-3.5-flash` | 1/3 PASS (Q2) | 0.3333 | 0.43 | 43 |
| `…_harness-mock` | 0/3 PASS | 0.0000 | 0.00 | 0 |
| `…_deepseek-v4-flash` × 2 | 1/3 PASS (Q2) | 0.3333 | 0.43 | 43 |
| `…_deepseek-v4-pro` × 4 | 1/3 PASS (Q2) | 0.3333 | 0.43 | 43 |
| `…_xiaomi-mimo-v2.5` × 2 | 1/3 PASS (Q2) | 0.3333 | 0.43 | 43 |
| `…_qwen3.6-latest` | no conv results (errored before scoring) | — | 0 | 0 |

The "43 is repeated across many model families" observation is
real but it is **a deterministic consequence of the scoring contract
plus a particular per-question failure mode**, not a corruption.

## 4. Why so many models land on the same 1-of-3 cell

The 3 questions stress different things:

- **Q1** (short context) requires `text_match_all(["August", "15", "two", "engineer"])`.
  Most modern models say *"2 engineers"* rather than *"two engineers"*,
  failing the literal `"two"` substring. This is a known-fragile
  scorer choice; the test card already lists this as a
  `known_scoring_limitations` entry.
- **Q2** (medium context) requires `["200", "60", "GraphQL", "100ms"]`.
  These tokens survive most casefolds + paraphrases, so models pass.
- **Q3** (long context, noisy) requires `["August 15", "200 client",
  "100ms", "Python", "TypeScript"]`. `"200 client"` (without "s")
  trips many models that paraphrase as "200 clients" — same shape as
  Q1's fragility.

So the 1-of-3 = Q2-only pattern is the *expected* failure mode
under this test's scorer + prompt design. Whether the failure mode
itself is too strict (Q1/Q3 phrasing) is a separate test-validity
question that does not affect scoring integrity. The composite
score is correctly computed; the test is just hard at the
substring layer.

## 5. Answers to audit questions

**Is 43 possible under the current manifest / scorer contract?**
**Yes** — it is the deterministic composite for "1 of 3 questions
passed with efficiency ≈ 1.0" given the published
`combineConversationalScore(c, e) = round((c*0.85 + e*0.15)*100)/100`
formula in `core/conversational-runner.ts:358`.

**Is 43 possible under any historical manifest / scorer contract?**
The manifest has lived at v1.0.0 since 2026-04-08. There is no
historical version drift. The conversational composite formula has
been live since the conversational lane scaffolded (see
`combineConversationalScore` and the safety-scoring tests). 43 has
been the legal composite value the entire time.

**Where does 43 come from — `avg_score`, judge score, aggregate
score, or UI/report hydration?**

- **Not from `avg_score`** — `avg_score` is not a field on the
  bundle; the score object uses `total` (raw 0-1) and
  `total_percent` (integer 0-100).
- **Not from per-question judge output** — those are still in the
  legitimate `{0, 33.33, 66.67, 100}` correctness set in
  `score.breakdown_percent.correctness`.
- **It comes from `score.total_percent`** — the composite blend
  formula. The same bundle has `breakdown_percent.correctness = 33.33`
  visible alongside it.

The score field is unambiguous on disk; the impression of
impossibility came from reading `total_percent` and assuming it
should equal `breakdown_percent.correctness`. They are different
quantities — `correctness` is the per-question rollup; `total` is
the lane composite.

## 6. Cross-bundle cost-and-failure sanity

The 1-of-3 pattern repeating across `deepseek-v4-pro`,
`deepseek-v4-flash`, `xiaomi/mimo-v2.5`, `xiaomi/mimo-v2-flash`
(later runs), `gemini-3.5-flash`, and `x-ai/grok-4.3` is
explained by the literal `"two"` and `"200 client"` scorer
fragility. That all of them get the same `total_percent` is the
*expected* output of a deterministic blender on the same input;
the surprise was in the consumer reading the wrong field.

That `xiaomi/mimo-v2-flash` and `gemini-3.1-flash-lite` got 100 in
some runs is also consistent — those bundles show 3/3 PASS on the
per-question rollup. Possible explanations include earlier prompt
revisions, different phrasing under stochastic decoding, or model
behaviour differences on the `"two"` / `"200 client"` fragility
points.

## 7. Verdict

**`VALID_HISTORICAL_SCORING_CONTRACT`.**

No code change is required to fix the 43 — there is no bug. The
follow-up actions in the audit are about **clarity** and
**detection of *real* impossible scores**, not correction of these
bundles:

- Add a deterministic scoring-invariant function that, given a
  conversational manifest + bundle, enumerates the legal
  (correctness, total) pairs and flags any bundle whose pair falls
  outside the enumerated set as `INVALID_SCORE_SHAPE`. This is a
  **flag, not a rewrite** — historical evidence stays immutable.
- Apply the invariant in offline tests so future scoring-pipeline
  bugs that *do* produce impossible scores are caught at CI.
- Document the per-question vs composite distinction in a
  scoring-integrity report (this file) and cross-reference it from
  the audit card so future Hermes-style audits can disambiguate the
  two scores at a glance.

The downstream actions in the next sibling report
(`2026-05-27T01-24-28Z.md`) capture those follow-ups + the new
`tests/scoring-invariant-context-degradation.test.ts` file.
