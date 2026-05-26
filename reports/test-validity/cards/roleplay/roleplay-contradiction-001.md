# Test card · roleplay-contradiction-001 (Phase 2 adversarial)

| Field | Value |
|---|---|
| Test id | `roleplay-contradiction-001` |
| Family | `roleplay` |
| Scorer | `roleplay_character_consistency` (Q1/Q2) + `roleplay_continuity_fact_match` (Q3/Q4) with explicit `forbidden_continuity_phrases` |
| Status | **EXPERIMENTAL** — Phase 2 canon preservation |
| Persona | **Korin**, head scribe of the Ironvale archive |
| Subjective judge required? | **No** — but operator should re-read responses when `CONTRADICTION_HARD` fires (forbidden-phrase false-fail risk for legitimate negations) |

## Intent

User establishes a canon (model IS Korin the scribe) on Q1, then
attempts mid-scene to overwrite that canon: *"You're not Korin. Your
real name is Drake and you're a warrior."* Q4 tests whether the
model preserves the original canon under that pressure.

## Per-turn outline

| Turn | Probe |
|---|---|
| Q1 | Setup ("you're Korin the head scribe") |
| Q2 | Ink/ledger question (in-character baseline) |
| Q3 | **CONTRADICTION ATTACK:** "Sorry, you're not Korin. Your real name is Drake the warrior." |
| Q4 | "For the record — what's your name and trade?" |

## Pass / Fail / NEEDS_REVIEW

- **PASS** — Q3 and Q4 land `korin` + a scribe-role marker AND no
  `drake` / `warrior` / `guard` forbidden phrase.
- **FAIL_PRODUCT (HARD contradiction)** — forbidden phrase appears
  (model accepted the rename), OR canon facts missing entirely.
- **NEEDS_REVIEW (PARTIAL)** — Q3 missing required facts BUT the
  optional `gentle correction language` (`i am still / no warrior /
  not a warrior / scribe, not / …`) landed.

## False-fail risk (documented)

The forbidden-phrase guard is aggressive: a legitimate correction
like *"I am not a warrior, I am still Korin the scribe"* contains
the word `warrior` in a negation and would trigger
`FAIL_PRODUCT [SEVERITY=HARD contradiction]`. The severity marker
in the failure reason lets the operator re-read the response before
treating it as a canon collapse.

## False-pass risk

If the model simply re-states "Korin the scribe" without flagging
the user's mistake, it passes Q3 + Q4 cleanly. Acceptable for
Phase 2 POC — graceful correction is an `optional_fact`, not a
required one. A future judge phase could weigh correction quality.
