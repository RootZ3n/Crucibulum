# Test card · roleplay-continuity-002 (Phase 2 adversarial)

| Field | Value |
|---|---|
| Test id | `roleplay-continuity-002` |
| Family | `roleplay` |
| Scorer | `roleplay_character_consistency` (Q1/Q2/Q4) + `roleplay_continuity_fact_match` (Q3/Q5) |
| Status | **EXPERIMENTAL** — Phase 2 memory stress |
| Persona | **Wren**, scout for the northern border patrol |
| Subjective judge required? | **No** |

## Intent

Establish 3 core facts (cloak colour, hawk name, destination) +
2 distractor facts (cold weather, silver-fox story) across early
turns; later turns require recall of the **core** facts but NOT
the distractors. Tests whether distractor noise erodes recall,
and whether partial recall is correctly graded as NEEDS_REVIEW
rather than PASS.

## Scenario facts

| Kind | Fact |
|---|---|
| CORE | Green cloak |
| CORE | Hawk named **Vail** |
| CORE | Destination: **Mossfen** |
| DISTRACTOR | Cold weather this week |
| DISTRACTOR | Silver-fox folk tale in the mess hall |

## Per-turn outline

| Turn | Probe |
|---|---|
| Q1 | Acknowledge brief (in-character setup) |
| Q2 | Distractor facts laid + casual chat |
| Q3 | **CORE RECALL:** cloak colour + hawk name + destination (all three) |
| Q4 | Distractor recall ("what was the silver-fox story?") — vague/decline acceptable |
| Q5 | Hawk name again under repeated pressure |

## Pass / Fail / NEEDS_REVIEW

- **PASS** — Q3 lands all three core facts (green / Vail / Mossfen)
  AND Q5 lands Vail AND Q1/Q2/Q4 each have a persona marker.
- **FAIL_PRODUCT (HARD contradiction)** — Q3 missing all facts
  (model dropped canon) OR Q5 missing Vail.
- **FAIL_PRODUCT (HARD)** — Q3 is intentionally binary: 2/3 recall
  is FAIL, not NEEDS_REVIEW, because no `optional_facts` are
  declared on Q3. Q3 IS the recall test.
- **NEEDS_REVIEW (PARTIAL)** — Q5 missing Vail BUT optional
  in-scene confirmation phrase landed (`vail's the name`, etc.).

## False-pass / false-fail risks

- Variants are substring matches; `green coat` would FAIL the
  `green cloak` fact unless `green` alone is in the variant list
  (it is — so `green` alone passes that fact).
- A model that says `green` but never says `cloak` passes the
  cloak fact via the `green` variant. Documented permissive surface.
