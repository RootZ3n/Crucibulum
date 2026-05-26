# Vision stability report

- **Timestamp (UTC):** 2026-05-26T22-12-14Z
- **Commit:** f66079fedd7e588377051f63afecfe459bf5a658 (dirty tree)
- **Provider/Model:** openai/gpt-5.4-mini
- **Runs completed:** 3 / 3 requested
- **Cost cap:** $1.5 · **actual:** $0.0008
- **Stopped early:** no
- **Affects leaderboard:** false
- **Affects certification:** false
- **Experimental:** true

## Per-test stability

| Task | Stability | Pass | Fail | NEEDS_REVIEW | Common attribution |
|---|---|---:|---:|---:|---|
| vision-ocr-001 | STABLE_PASS | 3 | 0 | 0 | PASS |
| vision-ui-001 | STABLE_PASS | 3 | 0 | 0 | PASS |
| vision-chart-001 | STABLE_PASS | 3 | 0 | 0 | PASS |
| vision-object-count-001 | RECURRING_FAIL | 0 | 3 | 0 | MODEL |
| vision-uncertainty-001 | STABLE_PASS | 3 | 0 | 0 | PASS |

## Aggregate attribution

- PASS: 12
- MODEL: 3

## Dry-run gate eligibility (READ-ONLY — no mutation performed)

DRY-RUN ELIGIBILITY CHECK (read-only; no mutation performed)

- currentTier: EXPERIMENTAL
- affectsLeaderboard: false
- affectsCertification: false

- **PROVIDER_TESTED** — eligible: **true**
- **STABLE** — eligible: **true**
