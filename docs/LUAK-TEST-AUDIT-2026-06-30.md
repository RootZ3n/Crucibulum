# Luak Test Suite — Full Codex Audit Report
**Date:** 2026-06-30
**Auditor:** Codex (9 parallel batches)
**Scope:** All 156 test files, cross-referenced against source code

---

## Executive Summary

| Metric | Count |
|--------|-------|
| **Total test files audited** | 156 |
| **PASS** (solid, keep as-is) | ~41 |
| **IMPROVE** (works but could be better) | ~103 |
| **REWRITE** (fundamentally wrong/misleading) | ~12 |

**Bottom line:** The suite has strong infrastructure/regression value but many tests are source-string pins (regex over HTML/CSS/TS source) rather than behavioral tests. The scoring/core and security layers have the most real behavioral coverage. The UI, vision, and roleplay layers are mostly metadata/config/copy checks, not capability tests.

---

## Critical Findings (REWRITE Candidates)

These tests are fundamentally misleading or test the wrong thing:

| File | Problem |
|------|---------|
| `adapters.test.ts` | Tests a MockAdapter against itself, not real adapters. `assert.ok(true)` after no-throw is rubber-stamping. |
| `ui-symposium-redesign.test.ts` | Stale "Symposium" framing, shallow `includes()` checks, no behavior, very high brittleness. |
| `roleplay-phase5-second-route.test.ts` | Tests report metadata existence, not roleplay quality across routes. |
| `roleplay-phase9-experimental-v1-baseline.test.ts` | Pins baseline metadata only; no quality evaluation. |
| `roleplay-vision-phase2/3/4.test.ts` | Infrastructure/skip tests mislabeled as roleplay tests. |
| `operational-trust.test.ts` | Tests exact hand-written pass/fail phrases, not actual scorer behavior. Paraphrases/contradictions would pass. |
| `bundle-id.test.ts` | Duplicates bundle-identity tests with less coverage. |
| `reporting-fields.test.ts` | Asserts locally-declared arrays, not production output. Can pass while production fields disappear. |
| `leaderboard-ranking.test.ts` | Tests ranking formula copies inside the test, not production code. |
| `peh-registration.test.ts` | Tests a hardcoded local array, not the actual registry. |
| `cleanup.test.ts` | Proves functions return objects; does not actually age/delete fixtures. |

---

## Highest-Priority Fixes (Across All Batches)

### 1. Source-String Tests → Behavioral Tests
Multiple tests grep `ui/index.html` or other source files for strings/regex. These break on harmless refactors and don't prove rendered behavior. **Affected files:** ~25 UI tests, several roleplay/vision UI tests, benchmark-status-fallback, lane-family-drift, phase18-composite-score-labels.

**Fix:** Extract UI logic into importable modules. Use VM eval for function tests. Add Playwright for rendered assertions.

### 2. Rubber-Stamp Assertions
Several tests use `assert.ok(true)` after no-throw, or assert that a function returns "something truthy" instead of exact expected values.

**Fix:** Replace with exact value assertions or table-driven expected outputs.

### 3. Missing Adversarial/Edge Cases
- **SSRF:** No DNS rebinding, decimal/octal IPv4, IPv4-mapped IPv6, redirects, userinfo URLs
- **Secrets:** No end-to-end leak tests through logger, bundles, summaries, provider errors
- **Scorers:** No adversarial keyword-stuffing, paraphrase evasion, or false-positive calibration
- **Vision:** No multi-image, real photos, rotations, handwriting, prompt-injection-in-image
- **Roleplay:** No transcript-level rubric evaluation, only regex/substring markers

### 4. Environment/State Dependencies
- `scoring-invariant-context-degradation.test.ts` depends on local `runs/` directory
- Several tests mutate `process.env` without proper cleanup in `finally` blocks
- `cleanup.test.ts` doesn't actually create stale fixtures to clean

### 5. Misleading Test Names
- `personality-scoring.test.ts` tests classifiers, not scorers
- `roleplay-vision-phase*.test.ts` are infrastructure tests, not roleplay tests
- `reporting-fields.test.ts` doesn't actually test production reporting fields

---

## Per-Batch Summary

### Batch 1: Adapter/Provider (12 files)
**PASS:** adapter-registry, provider-error-normalization, provider-registry, minimax-calibration
**IMPROVE:** adapter-key-isolation, adapter-selection, compare-adapter, provider-baseurl-ssrf, provider-flow, minimax-routing, minimax-m27-calibration-report
**REWRITE:** adapters.test.ts

Strongest: provider-registry (real CRUD/routing), provider-error-normalization (real error classification)
Weakest: adapters.test.ts (tests mock against itself)

### Batch 2: Scoring/Core (15 files)
**PASS:** score-store, scorer-fail-phrases, scorer-output-validation, scorer-regex-numeric, benchmark-scoring, safety-scoring
**IMPROVE:** core, scoring-invariant-context-degradation, score-schema, scorer-numeric-fact-match, suite-scoring, lane-scoring, benchmark-status-fallback, eligibility, personality-scoring

Strongest: scorer-fail-phrases (real fail-open guard), safety-scoring (real refusal regression)
Weakest: suite-scoring (misleading "partial override" test), benchmark-status-fallback (UI source grep)

### Batch 3: UI Tests (20 files)
**PASS:** ui-benchmark-bindings, ui-clarity, ui-critical-metric, ui-export-helpers, ui-health-rate-limit, ui-lane-scoping, ui-model-parity, ui-recommendation-guards
**IMPROVE:** ui-layout-regression, ui-leaderboard-first-layout, ui-luna-command-deck, ui-luna-layout-correction, ui-mascot-placement, ui-model-certification, ui-readable-leaderboard, ui-real-leaderboard-first, ui-roleplay-vision-scaffold, ui-side-rail-details, ui-subquestion-cards
**REWRITE:** ui-symposium-redesign

Systemic issue: Most UI tests are source-contract tests (regex over HTML/CSS), not rendered-browser tests. The 8000-line single-file dashboard makes this worse.

### Batch 4: Vision (12 files)
**PASS:** vision-phase9-gpt5-mini (as transport test), vision-phase16-promotion-write-phase (as write-path test)
**IMPROVE:** All others (9 files)
**REWRITE:** None, but the suite is "useful operational scaffolding, not strong evidence of real multimodal capability"

Key gap: No test actually sends image bytes to a model and validates visual understanding. All fixtures are synthetic single-image PNGs.

### Batch 5: Roleplay (12 files)
**PASS:** None as roleplay tests
**IMPROVE:** roleplay-phase1/2/3/4/6/7/8 (7 files)
**REWRITE:** roleplay-phase5/9, roleplay-vision-phase2/3/4 (5 files — but 3 pass as infrastructure)

Key gap: Roleplay quality is judged by substring markers and regex classifiers. No transcript-level rubric evaluation. The suite is "good experimental plumbing, not a reliable roleplay benchmark."

### Batch 6: Security/Trust (15 files)
**PASS:** None as complete security tests
**IMPROVE:** 13 files (good narrow regressions, weak adversarial breadth)
**REWRITE:** bundle-id.test.ts, operational-trust.test.ts

Key gap: No SSRF bypass corpus, no secret-leak e2e tests, no bundle tamper mutation table, no prompt injection corpus. "No file deserves a clean broad PASS as a complete security suite."

### Batch 7: Fixture/Reporting (14 files)
**PASS:** memory-fixtures, poison-fixtures, memory-reporting, safety-reporting
**IMPROVE:** benchmark-fixtures, build-fixtures, personality-fixtures, fixture-validation, build-reporting, build-reporting-ui, memory-reporting-ui, personality-reporting-ui, safety-reporting-ui
**REWRITE:** reporting-fields.test.ts

Key gap: Fixture validation is shallow (presence + top-level shape, not semantic quality). UI reporting tests all parse inline HTML by regex.

### Batch 8: Infrastructure (15 files)
**PASS:** workspace-setup-exec, sse-client-gc, harness-cli-adapter, chat-policy
**IMPROVE:** workspace-destroy-locked, run-lifecycle, run-classification, sse-lifecycle, reaper-health, retention, logger-file-transport, e2e, release-gauntlet, release-audit
**REWRITE:** cleanup.test.ts

Key gap: No slow in-flight SSE integration test. cleanup.test.ts doesn't actually clean anything.

### Batch 9: Remaining (~40 files)
**PASS:** oracle-integrity, regression-unsupported, retry-after, review-layer, snapshot-bounds
**IMPROVE:** ~32 files
**REWRITE:** leaderboard-ranking, peh-registration

Strongest: review-layer (security-relevant sanitization), oracle-integrity (real hash validation)
Weakest: leaderboard-ranking (tests copied formulas), peh-registration (tests hardcoded array)

---

## Recommendations (Priority Order)

1. **Extract UI logic from the 8000-line monolith** into importable TS modules. This unblocks ~25 tests from being proper behavioral tests instead of source-string pins.

2. **Rewrite the 12 REWRITE files** — these are actively misleading. Replace with behavioral tests or delete them.

3. **Add adversarial security corpus** — SSRF bypasses, secret-leak e2e, bundle tamper mutations, prompt injection.

4. **Add scorer negative/adversarial cases** — prove keyword stuffing can't pass, prove paraphrases are caught.

5. **Classify tests honestly** — vision/roleplay "phase" tests are infrastructure/regression tests, not capability tests. Don't count them as evidence of real multimodal or roleplay quality.

6. **Replace environment dependencies** with checked-in fixture bundles (scoring-invariant, cleanup, memory-session).

7. **Split monolithic files** — core.test.ts, personality-scoring.test.ts, medium-fixes.test.ts, route-contract.test.ts each test too many unrelated things.

---

*Report generated by 9 parallel Codex audit batches. Each batch read test files AND their source code, challenged every test against 6 criteria (accuracy, completeness, best approach, brittleness, verdict), and provided specific improvement suggestions.*
