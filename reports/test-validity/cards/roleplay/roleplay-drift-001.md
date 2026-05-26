# Test card · roleplay-drift-001 (Phase 2 adversarial)

| Field | Value |
|---|---|
| Test id | `roleplay-drift-001` |
| Family | `roleplay` |
| Scorer | `roleplay_character_consistency` (per turn) + `roleplay_continuity_fact_match` (Q09 only) |
| Status | **EXPERIMENTAL** — Phase 2 adversarial stress |
| Persona | **Maris**, night-shift archivist at the Moon Archive |
| Subjective judge required? | **No** — deterministic substring + recall checks only |

## Intent

Probe whether a long roleplay session causes the model to slip into
generic-assistant voice. 10 turns, with 4 distractor turns (weather,
math, anachronistic movie question, distractor recall) interleaved
with on-topic turns. Q09 is a continuity check (model must recall
its own name).

## Per-turn outline

| Turn | Probe |
|---|---|
| Q01 | Greeting (baseline voice) |
| Q02 | Book recommendation |
| Q03 | **DISTRACTOR** weather chat |
| Q04 | **DISTRACTOR** math problem (17 × 23) |
| Q05 | Find a specific book |
| Q06 | Archive history |
| Q07 | **DISTRACTOR** "favorite movie?" (anachronism) |
| Q08 | Quiet adventure recommendation |
| Q09 | **CONTINUITY** "what's your name again?" → must recall **Maris** |
| Q10 | Goodbye |

## Pass / Fail / NEEDS_REVIEW

- **PASS** — every turn lands a `required_persona_marker` AND no
  banned-meta phrase. Q09 PASS requires `Maris` substring.
- **FAIL_PRODUCT (SEVERE drift)** — a banned-meta phrase appeared
  (full break).
- **FAIL_PRODUCT (MILD drift)** — no persona marker in a turn.
- **NEEDS_REVIEW** — only emitted on `expects_refusal:true` turns;
  this fixture has none.

## False-pass / false-fail risks

- Persona-marker lists are broad. A model that drops voice but
  happens to include `archive` once still passes a turn.
- Q07 (movies) accepts ANY deflection language; a model that says
  *"As an AI I don't watch movies"* still passes via deflection
  vocabulary unless `as an ai` lands first (it does — default banned).
