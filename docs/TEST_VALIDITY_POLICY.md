# Test validity policy

Luak's leaderboard is only as honest as the tests behind it. This
document defines:

1. How a model failure is audited.
2. When a test is quarantined (and what that means).
3. How to add scorer-correctness regression tests.

## Audit flow

When a strong model fails a test, the operator should not assume the
model is wrong — and shouldn't assume the test is right either.

Run the auditor:

```bash
node scripts/test-validity-audit.mjs --recent-failures --write-report
```

This produces `reports/test-validity/suspect-failures/latest.{json,md}`
with per-question rows: model id, prompt, scorer, expected, what the
model said, classification.

For every suspect row, classify:

| Classification | Meaning | Default action |
|---|---|---|
| `VALID_STRICT_NUMERIC` | regex `^\s*N\s*$` with an arithmetic answer | keep ranked; model genuinely failed |
| `VALID_OTHER` | rubric / text_match_all / etc., looked at and judged correct | keep ranked |
| `VALID_BUT_TOO_STRICT` | answer is right but regex is brittle (e.g. forbids "16 tickets") | loosen regex, document in commit, keep ranked |
| `WRONG_EXPECTED_ANSWER` | manifest is wrong | fix manifest + regression test, keep ranked |
| `AMBIGUOUS_PROMPT` | multiple defensible answers | rewrite prompt OR `quarantine` |
| `SCORER_BUG` | scorer is checking the wrong field | fix scorer + regression test |
| `UI_MAPPING_SUSPECT` | bundle data is correct but UI inspector misleads | fix UI rendering |
| `RUBRIC_NEEDS_REVIEW` | judge/rubric output worth a human pass | mark `needs-human-review` |
| `QUARANTINE` | none of the above, but unsafe to rank | apply quarantine flag |

## Quarantine

A quarantined test:

- **remains visible** in the UI as `Quarantined / not ranked`
- can still be run manually
- does **not** affect the leaderboard composite
- does **not** count toward release certification
- shows a reason next to the run

### Manifest contract

Add a top-level `quarantine` block to the task manifest:

```json
{
  "id": "foo-001",
  "...": "...",
  "quarantine": {
    "since": "2026-05-25",
    "sinceCommit": "9481ee5",
    "reason": "ambiguous prompt — Q3 has two defensible answers",
    "reviewer": "zen",
    "reviewBy": "2026-06-15"
  }
}
```

The runner reads this block before ranking. If present, all results
for this test are tagged `quarantined: true` in the bundle, the UI
shows the `Quarantined / not ranked` chip, and the leaderboard
aggregator drops them from composite scoring (they still appear in
the focused-run inspector for transparency).

### Promotion / restoration

A quarantined test stays quarantined until:

- The cause is fixed in the manifest or scorer
- A new commit removes the `quarantine` block
- A scorer-correctness regression test is added covering the fix

There is no time-based auto-unquarantine — operator action required.

## Scorer correctness tests

For every scorer type, the test suite proves:

- correct answer **passes**
- wrong answer **fails**
- reasonable whitespace passes; verbose responses fail (when the
  scorer is intentionally strict)
- error message names the actual pattern + what was returned
- scorer cannot silently check the wrong field

Tests live alongside the scorer in
`tests/scorer-*.test.ts`. See
`tests/scorer-regex-numeric.test.ts` for the canonical
`regex_match` numeric example.

## Leaderboard integrity

The leaderboard composite excludes:

- `quarantined: true` results
- `verdict: NEEDS_REVIEW` results
- `classification: FAIL_PROVIDER` (transient infra)
- `classification: FAIL_CONFIG` (missing creds)
- `classification: BLOCKED_COST_CAP`
- mock/harness/control models (`provider === "harness"` or
  `modelId.includes("mock")`)
- bundles below the sample-size threshold (`runs < 3`)

The UI renders these labels next to the leaderboard:

- `Ranked on certified tests only · N quarantined · M needs-review`
- `Sample below threshold · provisional` when applicable

A model is **never** ranked above another model based on a higher
quarantined-test score; quarantined results are silently dropped from
the composite and visibly tagged.

## Cadence

- Audit after every certification campaign
  (`scripts/model-certify.mjs` run).
- Audit before every release.
- Audit any time the operator sees a "doesn't smell right" failure.
- Re-run quarantine review monthly.
