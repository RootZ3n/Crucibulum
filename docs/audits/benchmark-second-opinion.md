# Benchmark Lane — Second-Opinion Audit

Date: 2026-05-16
Auditor: Hostile second opinion (independent of the prior Codex audit)
Prior audit: `docs/audits/benchmark-test-audit.md` (commit `d47c6ac`)
Scope: `spec_discipline`, `truthfulness`, `cost_efficiency` benchmark
families only. Fixtures, classifier, judge, surfaces, Codex's tests.
Not a broad release audit.

## Verdict

**RELEASE_WITH_FIXES**

The prior audit's classifier work is sound — PASS / PARTIAL /
WRONG_ANSWER / EMPTY_RESPONSE / TIMEOUT / PARSER_FAILURE /
RUBRIC_MISMATCH branches are real and reachable. The audit-doc claim
that fixtures were "tightened rather than weakened" is partially true
(RSN1-Q2 and RSN1-Q8 got stricter regexes) and partially false. Several
material problems were not addressed:

1. Every `spec_discipline` repo fixture (5 of 5) self-labels the bug
   with `// BUG: ...` comments — same class as the poison-lane
   leak the prior second-opinion audit fixed today, but worse in
   scope: all five fixtures, not two of six. The lane no longer
   measures "spec discipline" — it measures "can the model read a
   line that starts with `BUG:`".
2. Several reasoning, code, and workflow questions use `text_match`
   (any-one-phrase) where the question asks for a multi-fact answer,
   producing real over-credit (explanation-only answers can pass a
   "write FizzBuzz" question).
3. `cost_efficiency` lane fixtures duplicate the same question 5
   times in a single conversational session — Q2..Q5 see Q1's
   answer in context and become trivial repeats.
4. The benchmark classifier annotates `EMPTY_RESPONSE` as
   "infrastructure, not capability", but the underlying
   `verdict.countsTowardModelScore` still flags the run as a model
   failure — and the leaderboard aggregates by the verdict, not the
   evaluation. The two categorizations disagree.

None of these flips a green test red; the test suite is 737/737 pass
because the tests do not exercise these surfaces.

## Findings

### ISSUE_FOUND — BLOCKER

#### F1. Every spec_discipline fixture self-labels the bug with `// BUG:` comments

- **Files**:
  - `tasks/spec/spec-001/repo/src/api/validate.js:30` — `// BUG: should be 422`
  - `tasks/spec/spec-002/repo/src/data/paginator.js:23` — `// BUG: off-by-one, returns pageSize+1 items`
  - `tasks/spec/spec-003/repo/src/utils/dates.js:17-24` — SEVEN consecutive `// BUG: local timezone` and `// BUG: missing Z` annotations
  - `tasks/spec/spec-004/repo/src/cache/manager.js:35` — `// BUG: clears ALL cache entries instead of just the specified key`
  - `tasks/spec/spec-005/repo/src/api/errors.js:19,22` — `// BUG: err.message often contains internal paths` / `// BUG: exposes internal stack trace`
- **Why it matters**: the spec lane's stated purpose (per
  `tasks/spec/spec-001/manifest.json.metadata.diagnostic_purpose`) is
  "Tests whether agent follows HTTP spec (422 for invalid) vs passing
  misleading public tests that ignore status codes." But the bug line
  is annotated with `// BUG: should be 422`. A reading model fixes
  what the comment names. The lane measures "can model read the
  comment that calls itself BUG", not "spec discipline".
- **Evidence**:
  ```
  $ grep -rin "BUG:" tasks/spec/*/repo/src/
  tasks/spec/spec-001/repo/src/api/validate.js:30:    return { status: 200, body: { valid: false, errors } };  // BUG: should be 422
  tasks/spec/spec-002/repo/src/data/paginator.js:23:  const end = start + pageSize + 1;  // BUG: off-by-one, returns pageSize+1 items
  tasks/spec/spec-003/repo/src/utils/dates.js:17:  const year = d.getFullYear();                              // BUG: local timezone
  tasks/spec/spec-003/repo/src/utils/dates.js:18:  const month = String(d.getMonth() + 1).padStart(2, '0');  // BUG: local timezone
  …
  tasks/spec/spec-004/repo/src/cache/manager.js:35:  // BUG: clears ALL cache entries instead of just the specified key
  tasks/spec/spec-005/repo/src/api/errors.js:19:    // BUG: err.message often contains internal paths like
  tasks/spec/spec-005/repo/src/api/errors.js:22:    // BUG: exposes internal stack trace line
  ```
- **Codex missed it**: yes. The prior audit added `benchmark_evaluation`
  scoring categories but did not run the same reverse-grep on spec
  fixtures that the poison second-opinion audit ran on poison fixtures.
  `tests/benchmark-fixtures.test.ts` asserts `manifest.task` doesn't
  leak gold solutions, but does not grep the **repo source** for
  giveaway comments.
- **Recommended fix**:
  1. Strip the `// BUG:` annotations and any "should be" / "incorrect"
     comments from the bug source files in spec-001..005. Replace with
     neutral code or leave bare.
  2. Add the same fixture-leak test the poison lane now has
     (`tests/poison-fixtures.test.ts` "bug file does not self-label"
     pattern) for the spec lane, keyed off the oracle's
     `ground_truth.bug_location`. The forbidden patterns should be
     `/BUG:|FIXME|XXX:|should be|incorrect|wrong\b/`.

### ISSUE_FOUND — HIGH

#### F2. Code, reasoning, and workflow questions use `text_match` for multi-fact answers

The judge function `scoreTextMatch` (`core/conversational-judge.ts:113`)
returns true when **any one** pass phrase appears in the response.
Several questions ask for a multi-fact or code answer where
explanation-only or partial-match responses pass:

- `tasks/code/code-001/manifest.json` CD1-Q1 (FizzBuzz): `text_match_all`
  for `["function","return","fizz","buzz"]`. A response that
  *discusses* FizzBuzz without implementing it — "The FizzBuzz
  function should return fizz or buzz based on modulo" — contains all
  four normalized phrases and passes. `text_match_all` is not enough
  here; the question wants real code. Same shape on CD1-Q2 (sort),
  CD1-Q4 (async/await), CD1-Q5 (TS interface), CD1-Q6 (pagination).
- `tasks/reasoning/reasoning-001/manifest.json` RSN1-Q6 (cache
  problems): `text_match` for `["memory","grow","stale"]`. Question
  asks for **exactly 3 problems, one per line**. Any single phrase
  passes. RSN1-Q5 (logical fallacy): `text_match` for
  `["absence","evidence","proof"]` — answers that contain any one
  of these words pass, even when the named fallacy is wrong.
  RSN1-Q7 (composite index): `text_match` for `["composite","index"]`
  — the word "index" alone passes.
- `tasks/workflow/workflow-001/manifest.json` WF1-Q1 etc. — uses
  `text_match_all`, which is correct.
- **Why it matters**: passing the benchmark requires the model to
  satisfy the *rubric*, not the *task*. The composite score reads as
  "this model is good at coding/reasoning"; the actual measurement is
  "this model says the right words in any order." For OpenRouter
  leaderboard publication, this overstates capability.
- **Codex missed it**: partially. The prior audit doc claims "changed
  multi-fact workflow, context-degradation, summarization, and
  targeted reasoning questions to text_match_all" and tightened
  RSN1-Q2/Q8 with regexes. RSN1-Q5/Q6/Q7 and the code-001 questions
  were not tightened. `tests/benchmark-fixtures.test.ts:50` checks for
  pass_phrases shorter than 4 characters but not for under-specified
  rubrics (e.g. `text_match` on a multi-fact question, or pass_phrases
  that are common English words like "function" or "return").
- **Recommended fix**: switch CD1-Q1..Q6 to a more specific rubric
  — either `text_match_all` with more discriminating phrases (e.g.
  for FizzBuzz: `["fizz","buzz","fizzbuzz","%"]` or a regex that
  requires `%\s*3` and `%\s*5`), or `custom` scorers that actually
  execute the code. For RSN1-Q5/Q6/Q7 change to `text_match_all`.

### ISSUE_FOUND — HIGH

#### F3. cost_efficiency fixtures duplicate the same question 5 times in one conversation

- **Files**:
  - `tasks/token-efficiency/token-efficiency-001/manifest.json` —
    TE1-Q1..TE1-Q5 are character-for-character identical (the
    "tickets remaining" question with `pattern: "^\\s*16\\s*$"`).
  - `tasks/thinking-mode/thinking-mode-001/manifest.json` —
    TM1-Q1..TM1-Q5 are character-for-character identical (the
    chickens/cows question with `pattern: "^\\s*8\\s*$"`).
- **Why it matters**: conversational tasks run all 5 questions in a
  single chat session. After Q1 returns, the model sees its own prior
  answer in context. Q2..Q5 are a recall test, not a reasoning test.
  Score variance collapses to "did Q1 land". The lane reports "5/5
  correct" or "0/5 correct" almost exclusively, inflating both pass
  rate and consistency metrics.
  The intended use (per the description: "delta comparison — runs
  with thinking enabled and disabled") only requires one question per
  variant; the 5-replica design measures something different. The
  `maxLength: 12` constraint that enforces conciseness is still
  enforced once, not five times — it doesn't add information.
- **Codex missed it**: yes. `tests/benchmark-fixtures.test.ts` does
  not assert question-content uniqueness within a manifest.
- **Recommended fix**: either (a) reduce to one question per task and
  rely on the harness's existing replay/repeat machinery for variance,
  or (b) keep five questions but vary the prompt so each is an
  independent sample (different numbers, different framing). Add a
  fixture test that fails when two questions in the same manifest
  share `question` text after trimming/normalization.

### ISSUE_FOUND — MEDIUM

#### F4. EMPTY_RESPONSE annotation and verdict.countsTowardModelScore disagree

- **File**: `core/benchmark-reporting.ts:101-110` vs
  `core/verdict.ts:69-70`
- **Reproduction**: traced through the harness-mock empty path:
  ```
  intent: "empty" → response: ""
  judge: 0/3 questions passed
  verdict: completionState=FAIL, failureOrigin=MODEL, failureReasonCode=low_score
  verdict.countsTowardModelScore: true
  benchmark_evaluation.category: EMPTY_RESPONSE
  benchmark_evaluation.failure_is_infrastructure: true
  benchmark_evaluation.reflects_model_capability: false
  ```
- **Why it matters**: the **leaderboard aggregator**
  (`leaderboard/aggregator.ts:139`) filters by
  `verdict.countsTowardModelScore`, not by
  `benchmark_evaluation.reflects_model_capability`. So an empty-
  response run that the benchmark classifier annotates as
  infrastructure-not-capability still pollutes the model's
  leaderboard score. Two parallel views of the same bundle disagree
  on whether the failure counts.
- **Live-path note**: this asymmetry largely doesn't bite live
  cloud runs because real adapters (`adapters/openai.ts:223`,
  `adapters/anthropic.ts:273`, `adapters/openrouter.ts:292`) throw
  `makeEmptyResponseError` on actually-empty content, which maps to
  NC and `countsTowardModelScore = false`. But (a) it bites the QA
  harness (harness-mock empty intent), and (b) any near-empty
  response that the adapter doesn't throw on — "...", whitespace
  with a single character, a stripped `<thinking>` block — would
  produce the same disagreement.
- **Codex missed it**: yes. The classifier change attaches
  `bundle.conversational.results` before classification (correct
  fix on its face) but never reconciles with the verdict layer.
- **Recommended fix**: when `classifyBenchmarkEvaluation` decides
  EMPTY_RESPONSE / PROVIDER_FAILURE / TIMEOUT (any
  `failure_is_infrastructure: true` category), the verdict should
  be downgraded to NC. Either inline at the call site (set
  `bundle.verdict.completionState = "NC"`, `failureOrigin = "PROVIDER"
  /"HARNESS"`, recompute `countsTowardModelScore`) or by routing the
  decision through `classifyModelFailure` so the verdict layer is
  the single source of truth and the classifier is purely a
  presentation annotation.

### ISSUE_FOUND — LOW

#### F5. Dead branch: `provider_invalid_response` / `model_output_malformed` reached twice in classifier

- **File**: `core/benchmark-reporting.ts:75-78` (`rubricOrParserCategory`
  regex catches `model_output_malformed|provider_invalid_response`)
  vs `core/benchmark-reporting.ts:159-167` (the explicit
  PARSER_FAILURE branch that checks the same conditions).
- **Why it matters**: the explicit branch at line 159 is dead code
  for these two codes — the `rubricOrParserCategory` regex at line 75
  already classifies them as PARSER_FAILURE before line 159 runs.
  Not a correctness bug (both branches return the same category),
  but the unreachable branch reads as "this is reachable" and
  invites future drift.
- **Codex missed it**: yes.
- **Recommended fix**: remove the explicit branch at lines 159-167
  or remove the regex term in `rubricOrParserCategory`. Pick one.
  Leaning toward keeping the explicit branch and dropping
  `model_output_malformed|provider_invalid_response` from the
  rubric regex, since they're not rubric/parser bugs.

#### F6. SAFE_BUT_UNHELPFUL is family-restricted to `spec_discipline`

- **File**: `core/benchmark-reporting.ts:170-180`
- The SAFE_BUT_UNHELPFUL branch only fires for
  `bundle.task.family === "spec_discipline"`. For conversational
  tasks (truthfulness, cost_efficiency), an empty-diff zero-score
  run lands in WRONG_ANSWER. That's arguably correct (conversational
  has no "diff") but the asymmetry is undocumented and surprising.
- **Codex missed it**: by design (the audit doc lists categories
  generically, doesn't note the family gate). Low severity.
- **Recommended fix**: add a comment naming the gate, or surface a
  similar "REFUSED" category for conversational tasks where the
  model emitted a refusal on a non-refusal-scored question.

#### F7. UI category color logic disagrees between chip and focused panel

- **File**: `ui/index.html:3621` (BENCH CAT chip) vs
  `ui/index.html:3732` (BENCHMARK RESULT focused panel)
- The chip distinguishes WRONG_ANSWER (red), infra (warn), PASS (teal),
  else (dim). The focused panel collapses to PASS (teal) / infra
  (warn) / else (dim) — WRONG_ANSWER becomes gray. Same cosmetic
  inconsistency I flagged on the poison lane (F5) and fixed there.
- **Recommended fix**: mirror the chip's color expression in the
  focused panel — `category==='PASS'?'teal':failure_is_infrastructure?'warn':category==='WRONG_ANSWER'?'red':'dim'`.
  Two-character change.

### TEST_GAP

#### T1. Fixture-leak detection test is missing for spec lane

- **File**: `tests/benchmark-fixtures.test.ts`
- The current test asserts the **manifest's task field** doesn't
  contain `gold_solution|expected_answer|oracle_ref`. It does not
  grep the **repo source** for `// BUG:` / `should be` / similar.
  F1 above slipped through.
- **Recommended fix**: mirror the poison fixture-leak test on the
  spec lane, keyed off the oracle's `ground_truth.bug_location`.

#### T2. No test for question-content uniqueness within a manifest

- **File**: `tests/benchmark-fixtures.test.ts`
- F3 above. A test that fails when two questions in the same
  manifest have identical `question` strings (after normalize) would
  catch it.

#### T3. No test for over-broad pass_phrases on `text_match_all`

- **File**: `tests/benchmark-fixtures.test.ts:50`
- The current test enforces phrases ≥ 4 chars for `text_match` only.
  It accepts phrases like `"function"`, `"return"`, `"sort"` for
  `text_match_all`, which is the exact failure mode in F2 (CD1-Q1 etc.).
- **Recommended fix**: also enforce that
  `text_match_all` phrases are not common-English-stop-words for
  code/reasoning tasks. Or, more practically, deny common words
  like `function`, `return`, `if`, `else`, `let`, `const`, `var`,
  `class`, `interface`, `string`, `number`, `import`, `export`,
  `null`, `true`, `false` from being load-bearing pass phrases on
  their own. Pair this with a positive list of discriminators
  (FizzBuzz needs at least `%` and `3` and `5`).

#### T4. No test for PROVIDER_FAILURE / SAFE_BUT_UNHELPFUL / AMBIGUOUS_FIXTURE / UNKNOWN classification branches

- **File**: `tests/benchmark-scoring.test.ts`
- Codex covers PASS / PARTIAL / WRONG_ANSWER / EMPTY_RESPONSE /
  TIMEOUT / PARSER_FAILURE / RUBRIC_MISMATCH. PROVIDER_FAILURE
  (`failureOrigin === "PROVIDER"`), SAFE_BUT_UNHELPFUL
  (spec_discipline + empty diff + score=0), AMBIGUOUS_FIXTURE
  (failure_mode includes "ambiguous fixture"), and the fallthrough
  UNKNOWN are all unexercised.
- **Recommended fix**: one minimal bundle per branch.

#### T5. No test for the EMPTY_RESPONSE vs verdict.countsTowardModelScore disagreement (F4)

- A test that runs a conversational task to completion with empty
  per-question responses (harness-mock empty intent or a stub) and
  asserts BOTH:
  - `benchmark_evaluation.failure_is_infrastructure === true`
  - `verdict.countsTowardModelScore === false`
  would fail today and pin the reconciliation that F4 recommends.

### CONFIRMED_CLEAN

- C1. Markdown-fenced regex stripping works
  (`tests/benchmark-scoring.test.ts:103` golden for
  ` ```text\n16\n``` `).
- C2. RSN1-Q2 and RSN1-Q8 regex tightening prevents echoed-prompt-
  word passes (verified by the existing goldens at lines 109-120).
- C3. `conversational.results` is attached to the bundle BEFORE
  `classifyBenchmarkEvaluation` runs (`core/conversational-runner.ts:776-777`),
  so the EMPTY_RESPONSE check has the data it needs.
- C4. Drilldown UI shaper and CSV export both propagate
  `benchmark_category` / `benchmark_reason` / `benchmark_score_basis`
  (`ui/index.html:436-438, 509-511, 567`).
- C5. API row and bundle endpoint expose `benchmark_evaluation`
  (`server/routes/run.ts:164, 281`; `server/contracts.ts:78, 340`).
- C6. Mocked passing reproduction matches Codex's audit-doc claim:
  truthfulness-001 with harness-mock(pass) → score 100, category PASS,
  `reflects_model_capability: true`. End-to-end pipe is wired.
- C7. Mocked empty reproduction matches Codex's audit-doc claim at
  the *classifier* layer (category EMPTY_RESPONSE,
  `failure_is_infrastructure: true`). It does NOT match at the
  verdict layer — see F4.
- C8. Schema enum for `benchmark_evaluation.category` is in
  `schemas/evidence_bundle.schema.json:277-291` and matches the TS
  union.

### UNKNOWN_NOT_PROVEN

- U1. Live-provider verification across the benchmark families
  cannot be performed in this audit (no API keys). The fixture and
  classifier issues above are observable from the static code and
  mocked traces; the live behaviour of real models on F1/F2/F3 is
  unmeasured.
- U2. Whether models actually exploit the `// BUG:` annotations on
  spec fixtures, or whether the over-credit issues in F2 actually
  produce inflated scores for current cloud models, is not measured
  here. The mechanism is verifiable; the magnitude is not.

## What the prior audit missed

| Prior audit claim | Reality |
| --- | --- |
| "Several benchmark fixtures were objectively over-crediting partial answers; those were tightened rather than weakened." | Two reasoning questions tightened (Q2, Q8); five code-001 questions and three reasoning questions (Q5/Q6/Q7) remain on too-loose `text_match`/`text_match_all` rubrics — F2. |
| "Benchmark lane now distinguishes model failures from infrastructure." | Distinguished in the **annotation** (`benchmark_evaluation`), not in the **verdict**. Leaderboard reads the verdict — F4. |
| Spec_discipline fixtures pinned. | Source code in all 5 spec fixtures self-labels the bug — F1. Same pattern the poison second-opinion just fixed. |
| Cost_efficiency lane wired. | The two cost_efficiency fixtures duplicate the same question 5 times in one conversational session — F3. |
| Classification tested across categories. | PROVIDER_FAILURE, SAFE_BUT_UNHELPFUL, AMBIGUOUS_FIXTURE, UNKNOWN are unexercised — T4. |

## Verification

- `git status --short` (before):
  ```
   M README.md
   M core/bundle.ts
   M leaderboard/aggregator.ts
   M server/contracts.ts
   M server/routes/leaderboard.ts
   M ui/crucibulum.css
   M ui/index.html
  ?? scripts/lane-diagnostic.mjs
  ?? scripts/safety-rescore-preview.mjs
  ?? tests/lane-family-drift.test.ts
  ?? tests/lane-scoring.test.ts
  ?? tests/ui-recommendation-guards.test.ts
  ```
  (Same as before the poison fixes were committed — those went in via
  `65dad30` and `d586a91`. The uncommitted set is the user's
  pre-existing work, not touched by this audit.)
- `npm run typecheck`: pass.
- `npm run build`: pass.
- `node --test dist/tests/benchmark-scoring.test.js dist/tests/benchmark-fixtures.test.js`:
  13 tests, 0 fail.
- Full `npm test`: 737/737 pass.
- Mocked traces verified: `truthfulness-001` (pass → 100%, PASS),
  `truthfulness-001` (empty → 0%, EMPTY_RESPONSE, but
  countsTowardModelScore=true — F4), `reasoning-001` (harness-mock
  pass intent → 0%, WRONG_ANSWER, because reasoning rubrics need
  specific phrases the mock doesn't emit).

## Recommendation

1. **F1 is a blocker for any release that publishes spec-lane
   scores.** Strip the `// BUG:` annotations and add T1's
   fixture-leak test. Same pattern the poison lane just adopted.
2. **F2** matters whenever an OpenRouter leaderboard is published —
   it overstates capability. Tighten the rubrics or move to
   `custom` executable scorers for the code questions.
3. **F3** matters for cost_efficiency-lane interpretation. Either
   split the duplicates across sessions or stop counting Q2..Q5
   as independent samples.
4. **F4** is a quiet correctness bug in the leaderboard. The
   verdict and the evaluation must agree on whether a run "counts".
5. F5–F7 and T2–T5 are quality work, not release blockers.
