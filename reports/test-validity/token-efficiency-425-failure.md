# Token-efficiency 425 failure — root cause report

- **Timestamp (UTC):** 2026-05-25T21-07-34Z
- **Operator question:** "Focused run shows deepseek/deepseek-v4-flash. Raw error: 'Response did not match pattern /^\s*425\s*$/'. Model answer shown: 6. Is this a real fail or a malformed test?"

## TL;DR

**The test is valid.** The model genuinely got two arithmetic
problems wrong in the same run; the operator's screenshot conflated
the error message from one question with the expected pattern from
another. There is no scorer bug, no malformed manifest, no UI
hydration mismatch — just an unfortunate side-by-side display of
two separate failures.

## The two separate failures in this bundle

Run: `runs/run_2026-05-25_token-efficiency-001_deepseek-deepseek-v4-flash_06e45740.json`
(bundle hash + run id available in the JSON).

The bundle's timeline contains two `type:"error"` events:

| Q | Prompt | Expected pattern | Model said | Verdict |
|---|---|---|---|---|
| **TE1-Q1** | "A team has 18 queued tickets. They close 7, reopen 2 of those, then 5 new tickets arrive, then they close 2 more. How many tickets remain?" | `/^\s*16\s*$/` | **`6`** | FAIL |
| **TE1-Q4** | "A library has 530 books on loan. 142 are returned, 75 are then re-loaned, then 38 more are returned. How many books are currently on loan?" | `/^\s*425\s*$/` | **`351`** | FAIL |

The operator's screenshot showed "Got: 6" (from Q1's error) next to
"pattern /^\s*425\s*$/" (from Q4's pattern). These are two
different questions — Q1 expected `16`, Q4 expected `425`. They both
failed; just not the way the screenshot suggested.

## Math check (independent solve)

**TE1-Q1:** `18 − 7 + 2 + 5 − 2 = 16` ✓
- Start: 18 queued
- Close 7 → 11 queued (7 closed)
- Reopen 2 of those → 13 queued (5 still closed)
- 5 new arrive → 18 queued
- Close 2 more → **16 queued**

**TE1-Q4:** `530 − 142 + 75 − 38 = 425` ✓
- Start: 530 on loan
- 142 returned → 388 on loan
- 75 re-loaned → 463 on loan
- 38 more returned → **425 on loan**

Both expected answers are mathematically correct under the only
plausible interpretation of the prompt. No ambiguity in either
prompt: "How many tickets remain" / "How many books are currently
on loan" both have exactly one defensible answer.

## Was the model wrong?

Yes, on both:
- **TE1-Q1 (got `6`)** — no path through the arithmetic produces 6.
  The closest wrong-answer paths give 7 (close 7 - reopen 0 + close 0
  with errors), 11 (forgetting the reopen-and-new-arrive steps), or 2
  (subtracting everything). `6` is just a hallucinated number.
- **TE1-Q4 (got `351`)** — `530 − 142 − 75 + 38 = 351` would be the
  arithmetic if the model interpreted "re-loaned" as "additionally
  returned and then re-loaned subtracted" or similar sign-flip. Still
  wrong: re-loaned means "loaned out again" which adds to "on loan",
  not subtracts.

These are honest **FAIL_PRODUCT** classifications. No retry,
provider issue, or hydration mismatch involved.

## Was the test valid?

Yes:
- ✅ Prompt is unambiguous English with one defensible answer.
- ✅ Expected answer is mathematically correct (verified above).
- ✅ Regex `^\s*N\s*$` is the right strictness for a token-efficiency
  test — the point of this family is that "Reply with ONLY the
  number" rules out verbose responses; that is the measurement.
- ✅ `maxLength: 12` is generous for a 3-digit answer; even
  `"425 books"` (9 chars) would fit.
- ✅ No oracle-visibility leak — public benchmark, no contamination
  risk above "medium" per the manifest.

## Was the scorer valid?

Yes. `scoring_type: regex_match`, applied to the model's response
verbatim. The error message format
`"<qid>: FAIL — Response did not match pattern <regex>. Got: <answer>"`
is honest — it shows the operator both the regex and what was
actually returned.

## Was the UI mapping suspect?

The operator's confusion came from the focused-run inspector showing
both Q1 and Q4 errors in the same panel. The data is correct (the
bundle has both errors with the correct prompt/answer pairings); the
visual layout invites cross-reading. Worth a follow-up to make
per-question failure cards visually adjacent and clearly bounded so
"Got: 6" can never be misread as belonging to Q4's pattern.

**Not a hydration bug.** The bundle's `timeline` entries are
well-formed and per-question. The extractor at
`scripts/test-validity-audit.mjs` consistently maps each error to
the right question id.

## Classification

| Field | Value |
|---|---|
| Test | `tasks/token-efficiency/token-efficiency-001/` (Q1, Q4) |
| Status | **VALID_STRICT_NUMERIC** (both questions) |
| Action | None — keep ranked |
| Quarantine | No |
| Scorer fix | None needed |
| Model verdict | Genuine FAIL_PRODUCT |
| UI follow-up | Visually isolate per-question failures in the focused-run inspector so two simultaneous fails can't appear to belong to one question |

## Evidence

- Bundle: `runs/run_2026-05-25_token-efficiency-001_deepseek-deepseek-v4-flash_06e45740.json`
- Manifest: `tasks/token-efficiency/token-efficiency-001/manifest.json`
- Auditor: `scripts/test-validity-audit.mjs --recent-failures --write-report`
- Suspect-failures report: `reports/test-validity/suspect-failures/latest.md`
