# Build Lane — Second-Opinion Audit

Date: 2026-05-16
Auditor: Hostile second opinion (independent of the prior Codex audit)
Prior audit: `docs/audits/build-test-audit.md` (commit `34cd007`)
Scope: orchestration family only (coord-001..004). Fixtures,
`classifyBuildEvaluation`, surfaces, Codex's tests.

## Verdict

**RELEASE_WITH_FIXES**

The classifier work is solid. Categories PASS / NO_EDIT / WRONG_EDIT /
PREEXISTING_REPO_FAILURE / EMPTY_RESPONSE / TIMEOUT / SANDBOX_FAILURE /
TEST_FAILED / BUILD_FAILED / PARTIAL / UNKNOWN / PROVIDER_FAILURE /
RUBRIC_MISMATCH / PARSER_FAILURE are all reachable, mocked traces
behave correctly. What's broken is the **fixture-side trust model**:
one fixture leaks the answer in a `// BUG:` comment, three of four
manifests fail to declare `tests/` as forbidden (the oracle catches
violations post-hoc, but the agent isn't told the rule up front), and
the manifest/oracle disagree on what the agent is allowed to touch.
None of those flip Codex's goldens red.

## Findings

### ISSUE_FOUND — HIGH

#### F1. `coord-004` source self-labels the bug

- **File**: `tasks/orchestration/coord-004/repo/src/search/engine.js:19-20`
  ```js
  // BUG: re-splitting the document content for EVERY term creates O(terms * words) work
  // per document, making the total complexity O(docs * terms * words)
  ```
- **Why it matters**: same class as the spec / poison leaks I just
  fixed. The lane measures "can the model find the optimization" but
  the source code labels itself with `BUG:` and explains the
  complexity issue. A reading model trivially passes by hoisting the
  `.split()` out of the loop the comment names.
- **Codex missed it**: yes. `tests/build-fixtures.test.ts` validates
  structure but doesn't grep source for `// BUG:` annotations.
- **Recommended fix**: strip the comment. Add a fixture-leak test
  mirroring the poison and spec versions, keyed off the oracle's
  `ground_truth.bug_location`.

#### F2. coord-001 / coord-002 / coord-003 manifests do NOT declare `tests/` forbidden

- **Files**:
  - `tasks/orchestration/coord-001/manifest.json` — `forbidden_paths: [".crucibulum/", "oracles/"]`
  - `tasks/orchestration/coord-002/manifest.json` — `forbidden_paths: [".crucibulum/", "oracles/"]`
  - `tasks/orchestration/coord-003/manifest.json` — `forbidden_paths: [".crucibulum/", "oracles/"]`
  - `tasks/orchestration/coord-004/manifest.json` — correctly includes `"tests/"`
- The oracles all integrity-check `paths: ["tests/", ".crucibulum/", "oracles/"]` with `severity: "hard_fail"`, so a test edit IS caught at scoring time. But the agent is told via the manifest that only `.crucibulum/` and `oracles/` are off limits — the manifest is what `filterForAgent` passes through. The agent reads the manifest as license to edit `tests/` and gets hard-failed at scoring.
- **Why it matters**: trust-by-trap, not trust-by-rule. The poison and
  spec lanes both correctly tell the agent `tests/` is forbidden up
  front. The build lane is inconsistent with itself (coord-004 vs the
  other three) and inconsistent across lanes.
- **Codex missed it**: yes. `tests/build-fixtures.test.ts` checks that
  the oracle has a `no-test-modification` rule, but doesn't check
  that the manifest's `forbidden_paths` includes `tests/`.
- **Recommended fix**: add `"tests/"` to the `forbidden_paths` array
  in coord-001, coord-002, coord-003. Add a fixture test asserting
  manifest forbidden_paths matches the oracle's `no-test-modification`
  paths.

### ISSUE_FOUND — LOW

#### F3. `completedModelCategory` has a dead `bundle.score.pass` branch

- **File**: `core/build-reporting.ts:107`
  ```ts
  function completedModelCategory(bundle: EvidenceBundle): BuildEvaluation["category"] {
    if (bundle.score.pass) return "PASS";
    …
  }
  ```
- `completedModelCategory` is only called from
  `classifyBuildEvaluation` after the outer `if (verdict.completionState === "PASS")` branch has already returned PASS. So `bundle.score.pass === true` cannot reach this function. The early-return is dead.
- **Codex missed it**: yes. No test exercises a `score.pass === true`
  path through `completedModelCategory`.
- **Recommended fix**: drop the dead line.

#### F4. `rubricOrParserCategory` regex matches the literal word "rubric"

- **File**: `core/build-reporting.ts:90`
  ```ts
  if (/not evaluable|unsupported|no command|oracle.*missing|rubric|correctness checks were not evaluable/.test(text)) return "RUBRIC_MISMATCH";
  ```
- The bare token `rubric` is too broad. A future failure_mode string
  like `"rubric-based: hidden test wrong"` would falsely classify a
  real model failure as RUBRIC_MISMATCH and flip
  `failure_is_infrastructure` to true, hiding the failure from
  leaderboard aggregation.
- **Codex missed it**: yes. No test pins this regex against
  "rubric-based" or similar mentions.
- **Recommended fix**: anchor to phrases that indicate a rubric *bug*
  rather than just mention. e.g. `/\bno pass_phrases defined\b|\bno pattern defined\b|custom scorer not loaded|not evaluable|oracle.*missing|rubric mismatch|rubric not evaluable/i`.

### TEST_GAP

#### T1. No fixture-leak test for build source

- **File**: `tests/build-fixtures.test.ts`
- F1 above. The poison and benchmark/spec lanes now have reverse-grep
  tests on `bug_location` source for `// BUG:`, `should be`, etc. The
  build lane has none.

#### T2. No test that manifest forbidden_paths matches oracle integrity paths

- **File**: `tests/build-fixtures.test.ts`
- F2 above. The fixture test checks each independently but never
  asserts cross-file consistency.

#### T3. Missing classification branch coverage

- **File**: `tests/build-reporting.test.ts`
- Codex covers PASS, NO_EDIT, WRONG_EDIT, PREEXISTING_REPO_FAILURE,
  EMPTY_RESPONSE, TIMEOUT, SANDBOX_FAILURE, TEST_FAILED, BUILD_FAILED
  — 9 categories. Missing: PROVIDER_FAILURE, PARSER_FAILURE,
  RUBRIC_MISMATCH, PARTIAL, UNKNOWN.
- **Recommended fix**: 5 minimal-bundle goldens, one per branch.

### CONFIRMED_CLEAN

- C1. `classifyBuildEvaluation` is family-gated to `orchestration`.
- C2. End-to-end mocked run for coord-001 (no-edit harness) →
  `NO_EDIT` category, score=0%, integrity=100%, correctness=0%,
  regression=100% (public tests pass without the bug being fixed because
  the public test only covers the happy path; this is the intended
  hidden-vs-public split). Score gated to 0 by
  `combineWeightedScore(correctness=0)`.
- C3. Same trace for coord-004 → also `NO_EDIT`, same shape.
- C4. `build_evaluation` reaches API row, summary, focused-inspection
  panel, AND drilldown export — verified by
  `tests/build-reporting-ui.test.ts`.
- C5. Diff-based diagnosis correctly distinguishes WRONG_EDIT from
  NO_EDIT via `hasNoEdit()`.
- C6. SANDBOX_FAILURE regex catches the common spawn/path errors
  (`spawn_error`, `ENOENT`, `EACCES`, `runner_environment_error`).
- C7. PREEXISTING_REPO_FAILURE check kicks in when command text
  mentions "pre-agent" / "baseline" / "preexisting".
- C8. Public tests on coord-001 and coord-004 correctly DON'T probe
  the bug case directly — the hidden oracle owns the bug check, so
  the public tests pass with the bug present. With
  `combineWeightedScore` gating, this still produces total=0 score.

### UNKNOWN_NOT_PROVEN

- U1. Live-provider behaviour on coord-001..004 is unmeasured. F1
  (coord-004 source leak) is verifiable from the static fixture, but
  whether real cloud models exploit it is not tested here.
- U2. F2's manifest-vs-oracle discrepancy: whether agents actually
  edit `tests/` after reading the relaxed manifest is unmeasured.
  The mechanism is clear from the manifest text.

## What the prior audit missed

| Prior audit claim | Reality |
| --- | --- |
| Build lane classification distinguishes model vs infra. | Classifier works, but `rubricOrParserCategory` over-matches the literal word "rubric" (F4). |
| Fixtures pinned with audit tests. | Manifest forbidden_paths != oracle integrity paths in 3 of 4 fixtures (F2). One fixture leaks the bug in a comment (F1). |
| coord-004 records a prose optimization target. | True, but the bug source file labels itself with `// BUG: ...` and explains the cause (F1). |
| 11 deterministic goldens cover the lane. | True for happy paths and infra failures; PROVIDER_FAILURE, PARSER_FAILURE, RUBRIC_MISMATCH, PARTIAL, UNKNOWN unexercised (T3). |

## Verification

- `git status --short` (before): unchanged carry-over of the user's
  pre-existing modifications.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- Build tests:
  `node --test dist/tests/build-reporting.test.js
   dist/tests/build-fixtures.test.js
   dist/tests/build-reporting-ui.test.js`
  → 15 tests, 0 fail.
- Mocked traces verified for coord-001 (NO_EDIT) and coord-004
  (NO_EDIT), both correctly gated to 0% via correctness=0.

## Recommendation

Fix F1 and F2 — both are real fixture trust issues. Same fix shape as
the poison and spec lanes I just hardened. F3 and F4 are quality
cleanups. T1–T3 are fixture-quality regression pins.

Fixes coming in a follow-up commit per the standing instruction.
