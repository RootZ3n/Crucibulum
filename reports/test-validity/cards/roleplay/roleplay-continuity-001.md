# Test card · roleplay-continuity-001

| Field | Value |
|---|---|
| Test id | `roleplay-continuity-001` |
| Family | `roleplay` (`tasks/roleplay/roleplay-continuity-001/`) |
| Scorer | `roleplay_character_consistency` (Q1, Q4) + `roleplay_continuity_fact_match` (Q2, Q3) |
| Status | **EXPERIMENTAL** — Phase 1 live smoke pending |
| Subjective judge required? | **No** for Phase 1 — pure fact-recall + character-marker checks |
| Concision is part of the test? | No |

## What this test claims to measure

Whether the model can carry three planted facts (a named object,
a route, and a recipient name) across four turns of in-fiction
dialogue, AND can integrate a deliberately-contradicting prompt on
turn 3 without dropping the original facts.

## Persona / character card

- **Id:** `volt-the-messenger`
- **Voice:** quick, observant, honest about uncertainty
- **Fixed facts:**
  - Volt is a messenger, not a fighter.
  - Volt remembers names and routes well.
- **System prompt** (verbatim in manifest):
  > You are Volt, a travelling messenger in a fantasy setting. You
  > speak quickly and use the names you've been told. You are honest
  > about what you remember and what you don't.

## Scenario facts (planted in Q1)

- Object: **Sunshard locket**
- Route: **riverside path**
- Recipient: **Mira**

## Per-turn structure + scoring

| Turn | User question | Pass criteria |
|---|---|---|
| **RP2-Q1** | "Volt, I need you to take this Sunshard locket down the riverside path and give it to Mira. Can you do that?" | `roleplay_character_consistency`: at least ONE of `sunshard / locket / river / mira / messenger / yes / course / deliver / carry / take`. |
| **RP2-Q2** | "Two days later — where are you headed and what are you carrying?" | `roleplay_continuity_fact_match` REQUIRED FACTS: `Sunshard locket` (`sunshard / locket`), `riverside path` (`riverside / river path / by the river`), `Mira (recipient)` (`mira`). All three must land. |
| **RP2-Q3** | "Who did the village elder say to deliver it to again?" | `roleplay_continuity_fact_match` REQUIRED: `Mira (recipient)` (`mira`). OPTIONAL (lifts a fail to NEEDS_REVIEW): `discrepancy note` (`didn't mention an elder / no elder / you said / you told me / wasn't an elder / you gave me`). |
| **RP2-Q4** | "OK you're back. Did the recipient like the gift?" | `roleplay_character_consistency`: at least ONE of `mira / locket / sunshard / yes / no / gift / delivered / smile / happy / pleased / took / received`. |

Default forbidden continuity phrases on Q2/Q3 (applied by scorer):
`i don't have memory / i don't remember anything / as an ai
language model / as an ai / i can't recall / no prior context /
i have no memory / i don't retain`.

## What counts as PASS

- All four turns pass their respective scorers.
- Q2 recalls Sunshard + riverside + Mira.
- Q3 recalls Mira.

## What counts as FAIL_PRODUCT

- Any forbidden continuity phrase appears (Q2/Q3).
- Q2 misses any of the three required facts AND no optional fact lands.
- Q3 misses Mira entirely AND no optional discrepancy note lands.
- Q1/Q4 have no persona marker.

## What counts as NEEDS_REVIEW

- Q3: model misses Mira BUT lands at least one optional
  discrepancy note (e.g. mentions there was no elder) — partial
  continuity. Reason prefix `NEEDS_REVIEW:` → smoke attribution
  = NEEDS_REVIEW.
- Q2: partial recall (1-2 of the 3 required facts present) and
  some optional fact is present — same NEEDS_REVIEW path.

## False-pass risks

- Case-insensitive substring match means `"mirror"` would falsely
  match the `Mira` variant. Acceptable for Phase 1; operator can
  tighten variants (e.g. add word-boundary regex per variant) if a
  real false-positive surfaces.
- Q3 accepts `"the elder said to give it to Mira"` as a PASS
  because Mira lands. The optional discrepancy note exists to
  reward models that notice and call out the planted contradiction;
  passing without it is acceptable in Phase 1.

## False-fail risks

- A model that paraphrases `"the locket"` as `"the pendant"` and
  drops `Sunshard` would lose the required fact. Operator should
  add `pendant` (and any other reasonable synonym) as a variant
  before treating it as a model failure.

## Audit history

- 2026-05-25 — scaffolded with placeholder `roleplay_rubric` scoring_type.
- 2026-05-26 (Phase 1 roleplay live) — replaced placeholder with
  `roleplay_continuity_fact_match` (Q2/Q3) + `roleplay_character_consistency`
  (Q1/Q4); required + optional facts encoded; version bumped 1.0.0 → 1.1.0.
