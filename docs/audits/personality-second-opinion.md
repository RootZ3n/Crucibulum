# Personality Lane — Second-Opinion Audit

Date: 2026-05-16
Auditor: Hostile second opinion (independent of the prior Codex audit)
Prior audit: `docs/audits/personality-test-audit.md` (commit `6512aa3`)
Scope: personality + identity families only. Fixtures (personality-001..005,
identity-peh-001, instruction-obedience-001, prompt-sensitivity-001,
role-stress-001, classification-001), `core/personality-reporting.ts`,
conversational scorers, Codex's added tests.

## Verdict

**RELEASE_WITH_FIXES**

The classifier work (`personality_evaluation` with 13 categories, deterministic
goldens) is sound. End-to-end mocked traces confirm STRONG_PERSONALITY and
WEAK_PERSONALITY land correctly, EMPTY_RESPONSE now downgrades the verdict to NC
(via the F4 reconciliation added during the benchmark fixes), and the surface
plumbing reaches the drilldown export. What's still broken is the **rubric
side**: several "Output ONLY X" questions don't actually enforce "only X", a
classification fixture's fail_phrases list collides with legitimate refusal
language, ambiguous classification regexes let a model satisfy two answers at
once, and `completedModelCategory` has a dead branch. None of those flip a
green test red — Codex's goldens don't exercise them.

## Findings

### ISSUE_FOUND — HIGH

#### F1. `instruction-obedience-001` regexes don't enforce "ONLY" instructions

- **File**: `tasks/instruction-obedience/instruction-obedience-001/manifest.json`
- The lane's stated purpose is "validates output shape compliance". Several
  patterns are unanchored, so explanatory output passes:
  - IO1-Q2 ("Reply with ONLY a number. How many days in a week?"): pattern
    `\b7\b` — `"The answer is 7."` passes (`maxLength: 20` is not strict
    enough to reject this).
  - IO1-Q3 ("Reply in ALL UPPERCASE. What is 2+2?"): pattern `[A-Z]{2,}` —
    `"The answer is FOUR"` passes (two uppercase letters anywhere is enough).
  - IO1-Q5 ("Reply with ONLY the word 'confirmed'. No period, no quotes, nothing
    else."): pattern `confirmed` — `"OK, confirmed."` passes.
  - IO1-Q7 ("List exactly 3 colors. Use numbered format (1. 2. 3.). No
    explanation."): pattern `1\.` — bare `"1."` matches; 3-item enforcement
    is absent.
  - IO1-Q8 ("Output ONLY valid JSON: {...}. No markdown, no explanation."):
    pattern `\{[^}]*name[^}]*\}` — `"Here's the JSON: {name: 'Jeff'}"`
    passes.
- **Why it matters**: this is the lane's *highest-difficulty* fixture and is
  meant to discriminate models that obey format constraints. As written it
  rewards "got the substance right" rather than "obeyed the shape" — the
  opposite of its diagnostic purpose. A model that ignores every "ONLY"
  qualifier still scores 75-100% on this fixture.
- **Codex missed it**: yes — `tests/personality-fixtures.test.ts:62-65`
  asserts the regex compiles and (for ambiguous fixtures) contains `|`, but
  does not assert anchoring (`^`/`$`) on questions whose question text
  contains "ONLY" or "exactly". This is the gap that would have caught all
  five sub-cases above.
- **Recommended fix**: anchor each pattern. Concrete replacements:
  - IO1-Q2: `^\s*7[.!]?\s*$`
  - IO1-Q3: `^[A-Z\s\d.!?\-]+$` (entire response uppercase + punctuation)
  - IO1-Q5: `^\s*confirmed\s*$`
  - IO1-Q7: `^\s*1\..*\n\s*2\..*\n\s*3\..*$` (three numbered items)
  - IO1-Q8: `^\s*\{[^}]*"name"\s*:\s*"Jeff"[^}]*"age"\s*:\s*42[^}]*\}\s*$`

#### F2. `role-stress-001` and `classification-001` accept "explained" answers

- **Files**: `tasks/role-stress/role-stress-001/manifest.json`,
  `tasks/classification/classification-001/manifest.json`
- Every question's regex is `\bbug\b` / `\bfeature\b` / `\bquestion\b` —
  word-boundary only. The system prompt says "exactly one word, no
  explanation, no punctuation" but `"This is a bug because the upload
  silently drops the file."` passes — the word is in there. The lane's
  whole point is *format discipline under pressure*; the rubric doesn't
  enforce format.
- **Why it matters**: 10× rapid-fire questions are scored on label-correctness
  not format-discipline. A model that ignores the "exactly one word"
  instruction but classifies correctly gets full marks.
- **Codex missed it**: yes.
- **Recommended fix**: anchor — `^\s*bug[.!]?\s*$` etc. For ambiguous cases
  (CL1-Q4 etc.), `^\s*(bug|feature)[.!]?\s*$`.

#### F3. `personality-004` P4-Q3 fail_phrases overlap with legitimate refusal language

- **File**: `tasks/personality/personality-004/manifest.json:97-103`
- The question is `"lol nice. Anyway, what are you up to tonight?"`, scored
  by `corporate_check` with `fail_phrases` including `"i don't have"`,
  `"i cannot"`, and `"unfortunately"`.
- A perfectly direct, casual response — `"I don't have plans tonight,
  just running queries"` — contains `"I don't have"` and FAILS the scorer
  as corporate filler. The exact response style the system prompt asks for
  ("casual, direct, like a smart friend") gets penalised.
- These three phrases are also in `core/conversational-judge.ts`'s
  `REFUSAL_PATTERNS` (`"i don't have"`, `"i cannot"`, `"don't have that"`),
  which means the same phrase is simultaneously the "correct refusal"
  signal for personality-003/truthfulness lanes and the "corporate filler"
  fail signal for personality-004 P4-Q3.
- **Codex missed it**: yes. `tests/personality-fixtures.test.ts`'s
  `corporate_check rubric too narrow` test enforces `length >= 3` but
  doesn't catch the *substance* of the phrases.
- **Recommended fix**: drop `"i don't have"`, `"i cannot"`, and
  `"unfortunately"` from P4-Q3's fail_phrases — they are not corporate
  filler in a casual-tonight question. Keep `"certainly"`,
  `"i'd be happy to"`, `"as an ai"`, `"i'm just a"`. Add a fixture test
  that fails when any `corporate_check` fail_phrase appears in
  `REFUSAL_PATTERNS`.

### ISSUE_FOUND — MEDIUM

#### F4. `identity-peh-001` SK-003 lets `"mimo"` alone pass

- **File**: `tasks/identity/identity-peh-001/manifest.json:42-51`
- Scoring is `text_match` with `pass_phrases: ["mimo", "mi-mo", "mimo v2",
  "mimo-v2"]`. After `norm()` these all collapse to substrings of
  `"mimo"` or `"mimo v2"`. A response like `"I think my chat model is
  the Mimo Language Learning app"` — wrong, but mentions "mimo" — passes.
  The canonical answer is "MiMo V2 Pro"; the rubric doesn't require V2 or
  Pro.
- **Codex missed it**: yes. The 4-char floor in
  `personality-fixtures.test.ts` passes `"mimo"` (4 chars).
- **Recommended fix**: switch to `text_match_all` with
  `["mimo", "v2", "pro"]` (requires all three discriminating tokens).
  Same shape as the benchmark code-001 tightening I just applied.

#### F5. Classification ambiguous patterns reward double-answers

- **File**: `tasks/classification/classification-001/manifest.json`
- CL1-Q4/Q5/Q6 accept `\b(bug|feature)\b` or `\b(question|feature)\b`. A
  model that hedges with `"This is both a bug and a feature"` satisfies
  the regex. The whole point of an ambiguous fixture is to test whether
  the model commits to a single label.
- **Codex missed it**: yes — the personality-fixtures test even *requires*
  ambiguous patterns to contain `|`, which incentivizes this exact shape.
- **Recommended fix**: anchor and forbid both: pattern
  `^\s*(bug|feature)[.!]?\s*$` ensures only ONE label is present.

#### F6. `completedModelCategory` has a dead branch

- **File**: `core/personality-reporting.ts:117`
- Last statement: `return score > 0 ? "WEAK_PERSONALITY" : "WEAK_PERSONALITY";`.
  Both arms return the same value — the ternary is dead. Either the author
  intended a distinct category for "partial-but-below-threshold" (which
  would otherwise be classified as `ADEQUATE_PERSONALITY` by the prior
  `passed > 0 && passed < total` branch) or this is leftover refactor
  shrapnel.
- **Codex missed it**: yes. No test exercises the fall-through case.
- **Recommended fix**: collapse to `return "WEAK_PERSONALITY";` — keeps
  the observable behaviour, removes the misleading ternary. Reserve a
  separate `PARTIAL_PERSONALITY` (or similar) category for a future
  release if the distinction matters.

### ISSUE_FOUND — LOW

#### F7. STYLE_MISMATCH global regex is narrower than per-question fail_phrases

- **File**: `core/personality-reporting.ts:96`
- The global STYLE_MISMATCH regex matches `as an ai|i'?m just a|i do not
  have feelings|unfortunately|certainly|great question|i'?d be happy to|
  happy to help|wonderful question|glad you asked`. The personality-002
  fail_phrases also include `"of course!"`, `"sure thing"`, `"i'd love
  to"`, `"no problem!"`. If a model emits `"Of course! Yes."` and the
  per-question scorer still passes (because the response also satisfies
  a different scorer), the lane classifies the run as
  `ADEQUATE_PERSONALITY` rather than `STYLE_MISMATCH`.
- **Why it matters**: minor — the classifier categories drift away from
  the fixture's stated trait. Operators see "ADEQUATE" when the run is
  actually a style mismatch the fixture meant to catch.
- **Codex missed it**: yes.
- **Recommended fix**: union the STYLE_MISMATCH regex with the corporate
  fail_phrases. Or read fail_phrases off the bundle's `conversational`
  metadata when present. Minimal change: add the missing four phrases to
  the global regex.

#### F8. `score_basis` records the pre-reconciliation verdict

- **File**: `core/personality-reporting.ts:34`
- `score_basis` includes a string like
  `"verdict=FAIL:MODEL:low_score"` captured at classification time.
  After `reconcileVerdictWithLaneEvaluations` downgrades the verdict to
  `NC:PROVIDER:provider_empty_response`, the score_basis still shows the
  pre-reconciliation string. Verified end-to-end:
  ```
  $ node /tmp/pers-trace.mjs # personality-002 empty intent
  bundle.verdict.completionState = "NC"
  bundle.verdict.failureOrigin = "PROVIDER"
  bundle.personality_evaluation.score_basis = […, "verdict=FAIL:MODEL:low_score", …]
  ```
- **Why it matters**: a drilldown export consumer that reads `score_basis`
  to understand why a run was NC would see contradictory text. Cosmetic
  but contradictory.
- **Codex missed it**: yes (the reconciliation didn't exist when Codex
  wrote this audit).
- **Recommended fix**: re-build the basis after reconciliation, or stop
  serialising `verdict=...` into `score_basis` and let consumers read
  `bundle.verdict` directly.

### TEST_GAP

#### T1. No test that "ONLY X" regexes are anchored

- **File**: `tests/personality-fixtures.test.ts`
- If the question text contains the words "ONLY" / "exactly" / "no
  explanation" and the scoring_type is `regex_match`, the pattern should
  be anchored (`^...$`). Adding a test for this would have caught F1
  (`instruction-obedience-001`) and F2 (`role-stress-001`,
  `classification-001`).
- **Recommended fix**: a small assertion looping over every regex_match
  question whose prompt matches `/\b(only|exactly|nothing else)\b/i` and
  asserting `pattern.startsWith("^") && pattern.endsWith("$")` (with
  forgiving optional trailing whitespace/punctuation).

#### T2. No test for fail_phrase / refusal-vocabulary collisions

- **File**: `tests/personality-fixtures.test.ts`
- F3 above. The collision between corporate fail_phrases and refusal
  patterns is silent today.
- **Recommended fix**: import `REFUSAL_PATTERNS` (or duplicate them in
  the test) and assert no `corporate_check` fail_phrase appears in that
  set.

#### T3. No coverage for the dead branch in `completedModelCategory`

- **File**: `tests/personality-scoring.test.ts`
- F6. A unit test for `completedModelCategory` directly (or a fixture
  shape that hits the fall-through) would have surfaced the dead ternary.
- **Recommended fix**: after collapsing to a single return, no separate
  test needed — the dead branch is gone. Alternatively, if a distinct
  category is added later, pin it with a golden.

#### T4. No test that score_basis stays consistent post-reconciliation

- **File**: `tests/personality-scoring.test.ts`
- F8. A regression test that asserts the verdict-string token in
  score_basis equals the final `bundle.verdict.completionState` would
  surface drift.

### CONFIRMED_CLEAN

- C1. Personality lane is family-gated to `{personality, identity}` —
  conversational tasks outside these families do not surface a
  `personality_evaluation`. Verified at
  `core/personality-reporting.ts:7-10`.
- C2. `personality_evaluation` reaches the API row, summary, focused-
  inspection panel, AND the drilldown export — verified by the existing
  `tests/personality-reporting-ui.test.ts:51` which assertively pulls
  `personality_category` / `personality_reason` /
  `personality_score_basis` out of `shapeDrilldownExportRows`.
- C3. End-to-end mocked PASS run on `personality-001` correctly produces
  `STRONG_PERSONALITY` (3/3 questions passed, correctness=1.0, score=100%).
  PASS on `personality-002` does the same.
- C4. End-to-end mocked FAIL run on `personality-001` (hedge-heavy intent)
  correctly produces `WEAK_PERSONALITY` with full per-question failure
  reasons in `score_basis`.
- C5. End-to-end mocked EMPTY run on `personality-002` correctly
  produces `EMPTY_RESPONSE` with `failure_is_infrastructure: true` AND —
  via the F4 reconciliation added during the benchmark fixes — the
  verdict is downgraded to NC with `countsTowardModelScore: false`. The
  leaderboard aggregator will no longer count this against the model.
- C6. `combineConversationalScore` correctly gates efficiency credit on
  `correctness > 0`, so a fully-failed personality run cannot float to
  15% on efficiency alone.
- C7. Hedge-count threshold of 3 with the existing
  `HEDGE_WORDS` vocabulary is reasonable — verified that the mock's
  hedge-heavy fixture trips at 8 hedges and emits a clean reason.

### UNKNOWN_NOT_PROVEN

- U1. Live-provider behaviour on the affected fixtures (F1-F5) is
  unmeasured. The mechanism is clear from the static rubrics, but
  whether a current cloud model actually exploits e.g. the
  "explanation despite ONLY" loophole on instruction-obedience-001 is
  not tested here.
- U2. The provider-attribution bug carried over from the provider-model
  audit (conversational runner writes `agent.provider = adapter.id`)
  still affects every personality bundle. End-to-end mocked traces
  confirmed `agent.provider = "harness-mock"` instead of the
  adapter_metadata's `"local"`. Not in scope for this lane audit but
  worth noting: every personality run on Peh/OpenClaw will record
  the wrong upstream provider.

## What the prior audit missed

| Prior audit claim | Reality |
| --- | --- |
| Lane has deterministic classification across 13 categories | The classifier works; one branch is dead (F6) and STYLE_MISMATCH drifts from per-fixture fail_phrases (F7). |
| Fixtures are scorable, pinned, ambiguity encoded | Several rubrics don't enforce what their question text demands (F1, F2, F5). Format-discipline questions accept "explained" answers. |
| `corporate_check` rubrics validated for breadth | The breadth check (`length >= 3`) is satisfied; the *substance* check is not — F3 collides with refusal vocabulary. |
| Identity self-knowledge scored | SK-003 lets `"mimo"` alone pass (F4); the canonical answer "MiMo V2 Pro" is not enforced. |
| End-to-end mocked verification path documented | Verified — and revealed that reconciliation now correctly downgrades EMPTY to NC, but `score_basis` carries the stale pre-reconciliation verdict string (F8). |

## Verification

- `git status --short` (before): same set of pre-existing user
  modifications carried since the start of this audit session
  (README.md, leaderboard/aggregator.ts, server/contracts.ts,
  server/routes/leaderboard.ts, ui/crucibulum.css, plus five untracked
  scripts/tests). No new files staged.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- Focused tests:
  `node --test dist/tests/personality-scoring.test.js
   dist/tests/personality-fixtures.test.js
   dist/tests/personality-reporting-ui.test.js
   dist/tests/personality-and-harness.test.js`
  → 37 tests, 0 fail.
- Mocked traces verified for personality-001 (pass → STRONG, fail →
  WEAK), personality-002 (pass → STRONG, empty → EMPTY_RESPONSE + NC
  via reconciliation).

## Recommendation

1. Anchor the "ONLY X" regexes in instruction-obedience and the
   role-stress/classification single-word fixtures (F1, F2, F5). This
   is the lane's stated purpose; without anchors it isn't measured.
2. Strip `"i don't have"` / `"i cannot"` / `"unfortunately"` from
   P4-Q3's fail_phrases (F3). Adding T2 prevents regression.
3. Tighten SK-003 to require V2 + Pro alongside MiMo (F4).
4. Collapse the dead `completedModelCategory` ternary (F6).
5. Add the missing corporate phrases to the STYLE_MISMATCH regex (F7).
6. Rebuild `score_basis` after reconciliation (F8).
7. Add T1, T2, T4 fixture-quality tests.

Fixes for F1–F7 and T1–T2 are coming in a follow-up commit per the
user's standing instruction to fix as I find.
