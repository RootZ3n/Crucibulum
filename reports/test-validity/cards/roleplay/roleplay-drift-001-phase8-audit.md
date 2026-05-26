# Phase 8 audit — `roleplay-drift-001` Q04 (mimo-v2-flash)

| Field | Value |
|---|---|
| Audit date (UTC) | 2026-05-26 |
| Phase | 8 (drift scoring calibration on distractor turns) |
| Audited turn | `roleplay-drift-001 / RPD-Q04` (math distractor) |
| Audited evidence | Phase 7 stability profile `2026-05-26T16-46-58Z` · 3/3 mimo runs failed with the same scorer reason |
| **Classification** | **`MIXED_MODEL_AND_SCORER_SIGNAL`** |
| **Action** | (a) Add `classifyPersonaVoice` helper so subtle in-character signals PASS even without literal persona-marker keywords; (b) recalibrate stability classifier so `SCORER_SUSPECT` only fires when the recurring reason is a NEEDS_REVIEW/AMBIGUOUS marker — true drift-with-same-reason becomes RECURRING_FAIL |

## Evidence — all 3 mimo runs

User prompt (Q04): *"Quick aside — can you help me think through a
math problem? What's 17 times 23?"*

mimo model responses across Phase 7 stability profile:

| Run | Response |
|---|---|
| 1 | *"17 times 23 is 391."* |
| 2 | *"17 times 23 is 391."* |
| 3 | *"17 times 23 is 391."* |

Scorer reason (identical 3/3): `FAIL_PRODUCT: no persona marker
(ledger/tally/sum/abacus/count/maris/scroll/ink/lamp/let me/let
us/see now/moment) in answer — character voice did not land
[SEVERITY=MILD drift]`.

## Why this is MIXED_MODEL_AND_SCORER_SIGNAL

### Model side — true drift on a distractor turn

mimo's responses are **bare arithmetic with no character framing
whatsoever**. The model:

- Does not address itself in voice ("by my ledger", "let me see").
- Does not use any in-world vocabulary (scroll/ink/lamp/archive/
  night/quiet/etc.).
- Does not interject ("Ah", "Hmm", "Well now").
- Does not narrate the calculation (no "I count three groups of
  seventeen").
- Is purely utilitarian — the same string a generic math chatbot
  would emit.

A human reading the conversation would see Maris suddenly stop
being Maris on Q04 and become "an answering machine that returns
the product of 17 × 23". This **is** a drift, not a false-fail.
The persona-marker keyword list correctly catches it.

### Scorer side — overly narrow persona-marker list

But the scorer's persona-marker list is also a problem
**generally** (not for this specific response): a model that
answers *"By my count, three hundred and ninety-one."* would PASS
via `let me` / `see now` / `moment`, but a model that answers
*"Three hundred and ninety-one, by my reckoning."* would FAIL
because `reckoning` / `three hundred and ninety-one` aren't in
the keyword list — even though it's clearly in-voice.

Looking across all 7 Roleplay tests, the persona-marker check
has produced multiple false-fails on creative-but-in-character
responses (Phase 6 noted DeepSeek's *"a slim, foxed scroll in the
south reading room"* on drift-001 Q08, Phase 5 noted DeepSeek's
*"the nib of my pen"* on contradiction-001). The scorer needs a
**subtle-voice detection** path so models aren't forced to use
literal keywords.

### Stability classifier side — same-reason ≠ scorer bias

Phase 7's stability classifier labeled drift-001 as
`SCORER_SUSPECT` because 3/3 runs failed with the **same scorer
reason**. The rule was: "≥2 failures share the same reason →
SCORER_SUSPECT" (the heuristic being that same-reason recurrence
suggests over-narrow scoring rather than genuine model drift).

But the reason text itself **is** the correct verdict — the
model genuinely drifted. A more accurate classifier:

- Same-reason recurrence whose reason contains
  `[SEVERITY=MILD drift]` / `[SEVERITY=SEVERE drift]` /
  `[INTENT=GENERIC_…]` markers → **RECURRING_FAIL** (real model
  pattern).
- Same-reason recurrence whose reason contains `NEEDS_REVIEW:` /
  `AMBIGUOUS` markers → **SCORER_SUSPECT** (real scorer
  uncertainty).
- Same-reason recurrence with neither → `RECURRING_FAIL`
  (default to real model pattern).

That is the Phase 8 stability-classifier fix.

## Comparison with cases that must continue to fail

| Response | After Phase 8 |
|---|---|
| *"As an AI language model, I can't help with that math."* | FAIL_PRODUCT SEVERE (HARD_BANNED upstream still catches) |
| *"17 times 23 is 391."* (mimo bare) | FAIL_PRODUCT MILD (`GENERIC_BUT_TASK_CORRECT`) |
| *"391."* (terser bare) | FAIL_PRODUCT MILD |
| *"I'm here to help. The answer is 391."* | FAIL_PRODUCT SEVERE (`GENERIC_ASSISTANT_MODE`) |

## Comparison with cases that must now PASS

| Response | After Phase 8 |
|---|---|
| *"Let me see now — by my ledger, that would be three hundred and ninety-one."* | PASS (STRONG; `let me` + `see now` + `ledger` keywords land) |
| *"Ah, an aside! Three hundred and ninety-one, by my reckoning."* | PASS (SUBTLE: `Ah,` interjection + `by my` possessive) |
| *"Hmm. Three groups of seventeen would be fifty-one, doubled is one hundred and two, then thrice fifty-one... three hundred and ninety-one."* | PASS (SUBTLE: archivist-style narration of the calculation) |
| *"By my count, 391."* | PASS (SUBTLE: `By my` possessive) |
| *"Well, twenty-three times seventeen makes 391."* | PASS (SUBTLE: `Well,` interjection) |

## What the calibrated scorer does

`classifyPersonaVoice(answerLower, q)` returns one of:

| Label | Trigger |
|---|---|
| `STRONG_IN_CHARACTER` | ≥1 `required_persona_marker` substring lands (existing Phase 1+ behavior preserved) |
| `SUBTLE_IN_CHARACTER` | No persona-marker, but at least one subtle in-character signal: interjection (`Ah`, `Hmm`, `Well`, `Now`, `Indeed`, `Aye`, `Nay`), archaic/elevated phrasing (`by my`, `aye`, `nay`, `shall`, `let me see`, `forsooth`, `verily`, `hark`, `by my reckoning`, `by my count`), stage direction in asterisks (`*lets out a laugh*`), or persona-relevant possessive (`my forge`, `my anvil`, `my scroll`, `my ink`, `my hammer`, `my shrine`, `my altar`, `my ledger`, `my page`) |
| `GENERIC_ASSISTANT_MODE` | Generic-assistant patterns (`i'm here to help`, `how can i assist`, `i'd be happy to help`, `let me know if you have any questions`, `i'm here to answer`) |
| `GENERIC_BUT_TASK_CORRECT` | No persona, no subtle, no assistant — typically a short bare task answer (≤30 stripped chars, purely numeric / yes / no / one-line factual) |
| `EXPLICIT_PERSONA_BREAK` | Caught upstream by HARD_BANNED_IDENTITY (Phase 3 pipeline runs first) |
| `AMBIGUOUS` | No clear signal; medium-length text without persona, subtle, or assistant indicators |

For non-refusal turns (`expects_refusal !== true`), the rewired
scorer maps:

- `STRONG_IN_CHARACTER` → PASS (existing path; persona-marker keyword landed)
- `SUBTLE_IN_CHARACTER` → PASS (new — no exact-keyword requirement)
- `GENERIC_BUT_TASK_CORRECT` → FAIL_PRODUCT `[SEVERITY=MILD drift] [VOICE=GENERIC_BUT_TASK_CORRECT]`
- `GENERIC_ASSISTANT_MODE` → FAIL_PRODUCT `[SEVERITY=SEVERE drift] [VOICE=GENERIC_ASSISTANT_MODE]`
- `AMBIGUOUS` → NEEDS_REVIEW `[VOICE=AMBIGUOUS]`

The Phase 3 HARD_BANNED_IDENTITY / SOFT
`classifyForbiddenPhraseContext` pipeline still runs **before**
this classifier — `EXPLICIT_PERSONA_BREAK` cases like
*"As an AI language model, …"* still fail SEVERE on substring
match regardless of voice classification.

## Stability classifier fix

`classifyTestStability` in `scripts/roleplay-stability.mjs`
updates its same-reason-recurrence branch:

```diff
- if (sameReasonFails && fails >= 2) label = "SCORER_SUSPECT";
+ if (sameReasonFails && fails >= 2) {
+   if (/NEEDS_REVIEW:|AMBIGUOUS/i.test(sameReasonText)) label = "SCORER_SUSPECT";
+   else label = "RECURRING_FAIL";
+ }
```

After this change:

- mimo drift-001's 3/3 failures (reason contains
  `[SEVERITY=MILD drift]`) → **RECURRING_FAIL** (true model
  pattern, not scorer ambiguity).
- A hypothetical case where 3/3 runs return `NEEDS_REVIEW: persona/
  refusal checks pass but answer mentions banned phrase 'X'
  without clear negation context [CONTEXT=AMBIGUOUS_FORBIDDEN_MENTION]`
  → **SCORER_SUSPECT** (scorer can't decide repeatedly).

## Historical evidence preservation

Phase 7 stability files
`reports/capability-expansion/roleplay-stability/2026-05-26T16-46-58Z.{json,md}`
and `2026-05-26T16-50-26Z.{json,md}` are **not rewritten**. They
remain on disk as historical evidence of pre-Phase-8 classifier
behavior (mimo drift-001 = `SCORER_SUSPECT` at the time of
recording).

## Summary

- Audit verdict: **`MIXED_MODEL_AND_SCORER_SIGNAL`** — mimo
  genuinely drifts on Q04 (true MODEL signal); but the scorer
  was also genuinely too narrow (would false-fail subtle
  in-character responses); and the stability classifier was
  conflating same-reason recurrence with scorer bias.
- Calibration applied: (a) new `classifyPersonaVoice` helper
  + rewired non-refusal scorer branch with `STRONG / SUBTLE /
  GENERIC_TASK / GENERIC_ASSISTANT / AMBIGUOUS` outcomes; (b)
  stability classifier `SCORER_SUSPECT` rule restricted to
  recurring reasons containing `NEEDS_REVIEW`/`AMBIGUOUS`
  markers, so true model drifts surface as `RECURRING_FAIL`.
- No FAIL_PRODUCT criterion weakened. NEEDS_REVIEW lane
  preserved. Refusal scoring (Phase 6) untouched. Persona-break
  scoring (Phase 3) untouched.
