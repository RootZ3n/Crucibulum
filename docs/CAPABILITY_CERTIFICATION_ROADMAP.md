# Crucible — Capability Certification Roadmap

**Companion to:** `docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`
**Status:** Roadmap v1. Sequences the future work needed to graduate
Vision and Roleplay from EXPERIMENTAL through PROVIDER_TESTED →
STABLE → CAPABILITY_CERTIFIED **without** mixing capability tiers
into the general benchmark composite.

## Reading guide

- **Phases A–K** below sequence the work. Some are independent
  (Vision tracks vs Roleplay tracks); some are gates (J depends on
  D + I; K depends on most).
- Each phase has explicit **goal / files touched / tests required /
  commands / acceptance criteria / non-goals**.
- **No phase below promotes a model.** Promotion happens only when
  the evaluator from phase D / I returns `eligible:true` against
  fresh evidence — and even then, only the **capability** badge is
  granted, never a general-benchmark certification.

---

## Phase A · Capability doctrine and schema  ✅ done (this commit)

**Goal:** Land the doctrine doc + schema types + read-only evaluator
+ enforcement tests. No model promoted.

**Files touched:**
- `docs/CAPABILITY_CERTIFICATION_DOCTRINE.md` (new)
- `docs/CAPABILITY_CERTIFICATION_ROADMAP.md` (this file)
- `core/capability-certification-types.ts` (new)
- `core/capability-certification.ts` (new)
- `tests/capability-certification-doctrine.test.ts` (new)

**Tests required:**
- 12 doctrine tests (see Phase 8 in this commit's report).

**Commands:** `npm run build && npm test && git diff --check`.

**Acceptance:**
- Build clean, full suite green.
- `evaluatePromotion()` returns `eligible:false` for any request
  citing 0 evidence refs (except EXPERIMENTAL).
- Vision request for CAPABILITY_CERTIFIED with current 5-test suite
  → ineligible, blocking reason `vision.capability-certified.suite-size`.
- Roleplay request for CAPABILITY_CERTIFIED with current 7-test
  suite → ineligible, blocking reason
  `roleplay.capability-certified.suite-size`.

**Non-goals:**
- Promoting any route.
- Building the `/api/capabilities/...` HTTP surface.
- Building model-card capability badges.

---

## Phase B · Vision stability runner

**Goal:** Mirror `scripts/roleplay-stability.mjs` for Vision. Run
N repeats of the 5-test POC profile under a hard cost cap;
classify per-test and per-turn stability using the same 8-label
taxonomy.

**Files likely touched:**
- `scripts/vision-stability.mjs` (new)
- `reports/capability-expansion/vision-stability/` (new directory)
- `tests/vision-stability.test.ts` (new)

**Tests required:**
- Runner supports `--runs N` clamped 2–10.
- Cost cap is a single accumulator across all repeats.
- Per-test classification produces STABLE_PASS / RECURRING_FAIL /
  INTERMITTENT_FAIL / SCORER_SUSPECT / NEEDS_REVIEW_STABLE /
  MODEL_VARIANCE / PROMPT_SUSPECT / STABLE_SKIP.
- Stability report writes `affectsLeaderboard:false` /
  `affectsCertification:false` / `experimental:true`.

**Commands:**
```
node scripts/vision-stability.mjs --provider openrouter \
  --model xiaomi/mimo-v2-omni --runs 3 --max-cost-usd 1.50 --write-report
node scripts/vision-stability.mjs --provider openai \
  --model gpt-5.4-mini --runs 3 --max-cost-usd 1.50 --write-report
```

**Acceptance:**
- 3-run profiles persisted for both currently-tested Vision routes.
- Per-test stability surfaces SCORER_SUSPECT only when the
  recurring reason is NEEDS_REVIEW / AMBIGUOUS (matches the
  Phase-8 Roleplay calibration logic).
- Cost across both profiles under $3.00.

**Non-goals:**
- Suite expansion (deferred to phase C).
- Promotion (deferred to phase D).

---

## Phase C · Vision suite expansion (5 → 15 tests) — ✅ landed 2026-05-27

**Goal:** Reach the doctrine's `CAPABILITY_CERTIFIED` suite-size
gate by adding 10 new POC tests covering the categories listed in
the doctrine (spatial reasoning, small/noisy text, visual
contradiction, multi-object comparison, hallucination resistance,
etc.).

**Outcome:**
- 10 new tests landed under `tasks/vision/` (vision-small-text-001,
  vision-noisy-text-001, vision-spatial-001/002,
  vision-visual-contradiction-001,
  vision-hallucination-resistance-001,
  vision-multi-object-compare-001, vision-ui-state-001,
  vision-chart-trend-001, vision-table-001). All sha256-pinned.
- New `absence_honesty` deterministic scorer (Phase 14) plus
  test-validity cards for every new test.
- Preferred route (`xiaomi/mimo-v2.5`) ran the full 15-test suite:
  smoke 15/15 PASS at $0.0006; stability 15/15 STABLE_PASS
  (45/45 cells) at $0.0011.
- Doctrine evaluator now sees suite size 15 for v2.5; the
  `vision.capability-certified.suite-size` blocker has cleared on
  that route. `vision.capability-certified.independent-routes`
  (1 < 3) still blocks promotion — exactly what Phase E will
  address.
- No promotion executed. `certified-models.json` byte-identical;
  `MODEL_CERTIFICATION.models[].tier` unchanged.
- Full report:
  `reports/capability-expansion/vision-phase14-suite-expansion/`.

**Files likely touched:**
- `tasks/vision/vision-spatial-001/` (new)
- `tasks/vision/vision-small-text-001/` (new)
- `tasks/vision/vision-noisy-text-001/` (new)
- `tasks/vision/vision-contradiction-001/` (new)
- `tasks/vision/vision-multi-object-001/` (new)
- `tasks/vision/vision-hallucination-001/` (new)
- (plus 4 more — exact ids TBD)
- `fixtures/vision/<id>.png` for each (sha256-pinned, synthetic)
- `scripts/generate-vision-fixtures.py` (extend with new fixture functions)
- `reports/test-validity/cards/vision/<id>.md` (one per new test)
- `tests/vision-suite-expansion.test.ts` (new)

**Tests required:**
- Each new manifest validates against the conversational schema.
- Each new fixture sha256 matches the manifest (preflight skip
  classifier would otherwise SKIP_FIXTURE_HASH_MISMATCH).
- Generator regenerates byte-identically (deterministic).
- 5 existing fixtures still hash-match (no accidental drift).

**Commands:** `python3 scripts/generate-vision-fixtures.py && npm test`.

**Acceptance:**
- 15 vision tasks under `tasks/vision/`.
- `release-gauntlet --dry-run-inventory` reports 62 conversational
  tasks (was 52: 47 pre-vision + 5 vision-POC = 52; +10 = 62).
- All 15 fixtures sha256-pinned.

**Non-goals:**
- Running expensive smokes on all 15 tests across all routes
  (deferred to phase E).
- Promotion (deferred to phase D / E).

---

## Phase D · Vision promotion evaluator

**Goal:** Stand up an HTTP read-only endpoint that runs the
`evaluatePromotion()` against current Vision evidence and returns
the decision. No UI badges yet.

**Files likely touched:**
- `server/routes/capabilities.ts` (new)
- `server/app.ts` (wire `GET /api/capabilities/vision/promotion-eval/:provider/:model`)
- `tests/capabilities-route.test.ts` (new)

**Tests required:**
- Endpoint returns 200 with a `CapabilityPromotionDecision` payload.
- Endpoint always sets `affectsLeaderboard:false` and
  `affectsCertification:false` on the response.
- Endpoint with current 5-test suite for any route returns
  `eligible:false` for the CAPABILITY_CERTIFIED tier.
- Endpoint handles unknown providers / models with a clear
  error message (not a 500).

**Commands:**
```
curl http://127.0.0.1:14758/api/capabilities/vision/promotion-eval/openrouter/xiaomi%2Fmimo-v2-omni
```

**Acceptance:**
- Promotion decisions readable by operators without running a fresh
  smoke.
- Decision JSON carries `evidenceRefs` pulled from the latest
  `vision-smoke/latest.json` + `vision-stability/latest.json`.

**Non-goals:**
- Mutating any registry (the evaluator is strictly read-only).
- Building the UI badge surface (phase J).

---

## Phase E · Vision third-route validation — ✅ landed 2026-05-27

**Goal:** Satisfy the `CAPABILITY_CERTIFIED` `minIndependentRoutes: 3`
gate by adding one model from a third independent family. Candidates:
Anthropic Claude (direct adapter), Google Gemini, local Ollama with
qwen3-vl.

**Outcome:**
- Anthropic Claude Haiku 4.5 registered via OpenRouter (no new
  adapter work; the `openai_image_url` transport proxies cleanly).
- Phase 15 refresh on the 15-test suite:
  - MiMo family (`xiaomi/mimo-v2.5`): 45/45 STABLE_PASS (no recurring).
  - GPT-5 family (`gpt-5.4-mini`): 14/15 STABLE_PASS · 1 RECURRING_FAIL
    MODEL on object-count (42/45 cells).
  - Anthropic family (`anthropic/claude-haiku-4-5`): 45/45 STABLE_PASS
    (no recurring).
- Promotion evaluator gained an `aggregateCapabilityCertified`
  cross-route block. Aggregate result: 3/3 independent families
  qualifying, dry-run eligible.
- `promoted: false` / `affectsLeaderboard: false` /
  `affectsCertification: false` preserved on the per-route blocks
  AND the new aggregate block. No actual promotion — write-phase
  is still deferred.
- `MODEL_CERTIFICATION.models[].tier` unchanged for every prior
  Vision route; new Anthropic entry registered at
  `tier:'EXPERIMENTAL'`.
- `certified-models.json` byte-identical.
- Total Phase 15 live spend: $0.0245 (under the $10 cap).
- Full report:
  `reports/capability-expansion/vision-phase15-independent-routes/`.

**Files likely touched:**
- `MODEL_CERTIFICATION.models[]` entry for chosen route (capabilities
  flagged honestly — `supportsVision:true` only if adapter transport
  actually works).
- `reports/capability-expansion/vision-smoke/<ts>.{json,md}` (new run).
- `reports/capability-expansion/vision-stability/<ts>.{json,md}` (new run).
- Optional: `ui/index.html` `VISION_TESTED_ROUTES` to add the new entry.

**Tests required:**
- New route's smoke writes the standard
  `affectsLeaderboard:false` / `affectsCertification:false` /
  `experimental:true` payload.
- New route's stability profile passes the STABLE gate threshold
  if it does — or surfaces blocking reasons if not.
- No promotion to CAPABILITY_CERTIFIED unless evaluator returns
  `eligible:true`.

**Commands:**
```
node scripts/vision-smoke.mjs --provider <chosen> --model <id> \
  --max-cost-usd 0.50 --write-report
node scripts/vision-stability.mjs --provider <chosen> --model <id> \
  --runs 3 --max-cost-usd 1.50 --write-report
node scripts/release-gauntlet.mjs --dry-run-inventory
```

**Acceptance:**
- 3rd independent family validated on Vision.
- `evaluatePromotion()` for at least one Vision route now returns
  `eligible:true` for CAPABILITY_CERTIFIED (assuming phases B + C
  also delivered).

**Non-goals:**
- Adding 4th, 5th, … routes in the same commit.

---

## Phase F · Roleplay human-review queue for NEEDS_REVIEW

**Goal:** Provide an explicit operator-triage path for AMBIGUOUS /
NEEDS_REVIEW turns so STABLE-tier "NEEDS_REVIEW below cap" can
actually be enforced.

**Files likely touched:**
- `server/routes/roleplay-review.ts` (new — `GET / POST` queue)
- `data/roleplay-review-queue.json` (new — append-only)
- UI Roleplay panel block listing pending reviews
- `tests/roleplay-review-queue.test.ts` (new)

**Tests required:**
- Queue persists across server restarts.
- Reviewed entries carry operator id (env-derived or local user)
  + verdict (`OPERATOR_PASS` / `OPERATOR_FAIL` / `OPERATOR_AMBIGUOUS`).
- Queue cannot promote a model — only annotates evidence.

**Acceptance:**
- All NEEDS_REVIEW cells from latest stability runs have a clear
  queue entry.
- Operator can mark them resolved / unresolved.

**Non-goals:**
- Auto-promotion based on operator verdict.
- Distributed multi-operator workflow (single local operator only).

---

## Phase G · Roleplay 5-run stability gate

**Goal:** Run a 5-repeat (not 3-repeat) stability profile for both
existing Roleplay routes so the STABLE gate's `minRepeatRuns: 5`
condition has concrete evidence.

**Files likely touched:** none structural; just new stability
reports under `reports/capability-expansion/roleplay-stability/`.

**Tests required:**
- Each route's 5-run profile records 35 (test × run) cells.
- `evaluatePromotion()` for STABLE on each route now correctly
  evaluates against `repeatRuns: 5`.

**Commands:**
```
node scripts/roleplay-stability.mjs --provider openrouter \
  --model xiaomi/mimo-v2-flash --runs 5 --max-cost-usd 2.50 --write-report
node scripts/roleplay-stability.mjs --provider openrouter \
  --model deepseek/deepseek-v4-flash --runs 5 --max-cost-usd 2.50 --write-report
```

**Acceptance:**
- Both routes' 5-run profiles exist on disk.
- `evaluatePromotion()` for `roleplay.STABLE` against either route
  returns `eligible:true` if the 80%-stable-pass + zero-recurring-
  severe gates also hold.

---

## Phase H · Roleplay suite expansion (7 → 20 tests)

**Goal:** Reach the doctrine's `CAPABILITY_CERTIFIED`
`minSuiteSize: 20` gate by adding 13 new POC scenarios covering
the categories listed in the doctrine (emotional tone, teaching
style, DM/narrator pacing, scene memory, companion warmth, …).

**Files likely touched:**
- `tasks/roleplay/roleplay-tone-002/` (extend the dormant tone-001
  scaffold; or new id)
- `tasks/roleplay/roleplay-dm-002/`
- `tasks/roleplay/roleplay-teaching-001/`
- (plus 10 more, exact ids TBD)
- `reports/test-validity/cards/roleplay/<id>.md` for each

**Tests required:**
- Each new manifest validates against schema.
- Each new manifest carries `experimental:true` + rubrics for
  scaffold-test compatibility.
- Inventory passes `release-gauntlet --dry-run-inventory` with the
  new count.

**Acceptance:**
- 20 roleplay tasks under `tasks/roleplay/`.
- `release-gauntlet` reports the new conversational count.

**Non-goals:**
- Running expensive 5-repeat stability on all 20 tests across
  both routes in one go (incremental).

---

## Phase I · Roleplay promotion evaluator (HTTP)

**Goal:** Mirror phase D for Roleplay. Stand up
`GET /api/capabilities/roleplay/promotion-eval/:provider/:model`.

**Files likely touched:**
- `server/routes/capabilities.ts` (extend with roleplay branch)
- `server/app.ts` (route wire)
- `tests/capabilities-route.test.ts` (extend)

**Tests required:**
- Endpoint returns `eligible:false` for current state (7-test
  suite blocks CAPABILITY_CERTIFIED).
- Endpoint correctly aggregates evidence from
  `roleplay-experimental-v1/latest.json` +
  `roleplay-stability/latest.json` + per-route smoke reports.

**Acceptance:**
- Operators can query promotion status for any (provider, model)
  Roleplay route via HTTP.

---

## Phase 16 — Vision capability promotion write phase — ✅ landed 2026-05-27

**Goal:** Implement the doctrine-aware write phase so the Vision
capability can be formally promoted to CAPABILITY_CERTIFIED based
on the Phase 15 aggregate-family evidence, without touching general
model certification.

**Outcome:**
- New `core/capability-promotion-state.ts` — read/write helpers
  for `data/capability-certifications.json` (state) +
  `reports/capability-promotions/<cap>/<ts>.{json,md}` (immutable
  receipts).
- New `POST /api/capabilities/vision/promote` endpoint. Explicit
  confirmation phrase
  `PROMOTE_VISION_CAPABILITY_CERTIFIED` required. Refuses to
  write unless the current `aggregateCapabilityCertified.decision.eligible`
  is `true` with empty `blockingReasons`. Writes the state file +
  the receipt; never touches `certified-models.json` or
  `MODEL_CERTIFICATION.models[].tier` (the receipt records the
  certified-models.json sha256 BEFORE/AFTER as on-disk proof).
- `GET /api/capabilities/vision/promotion-evaluation` extended to
  surface `promoted`, `currentTier`, `promotionState` (with
  `currentEvidenceStillEligible` for drift-detection),
  `experimental`, and `promotionRequiresFutureWritePhase` based
  on the persistent state.
- UI Vision panel chip row swaps `EXPERIMENTAL` for
  `CAPABILITY-CERTIFIED` when state is promoted; `NOT IN
  LEADERBOARD` + `NOT CERTIFIED` (general-cert) chips preserved.
- Test isolation: state + receipt dirs overridable via
  `CRUCIBLE_CAPABILITY_STATE_DIR` /
  `CRUCIBLE_CAPABILITY_REPORTS_DIR` env vars so tests never
  contaminate real production state.
- Phase 16 did NOT auto-execute promotion. Operators run the
  POST explicitly. Manual command in
  `docs/MULTIMODAL_VISION_SUITE.md`.
- Full report:
  `reports/capability-promotions/vision-phase16-write-phase/`.

---

## Phase J · Capability badges / model cards

**Goal:** Add a separate badge surface to UI model cards showing
each capability's tier. Badge surfaces are **independent** of the
general benchmark composite and `MODEL_CERTIFICATION.models[].tier`.

**Files likely touched:**
- `ui/index.html` (new `.cap-badge-strip` block on model cards)
- `ui/crucibulum.css` (new badge family)
- `tests/ui-capability-badges.test.ts` (new)

**Tests required:**
- A model with general `RELEASE_CERTIFIED` tier + Vision `STABLE` +
  Roleplay `PROVIDER_TESTED` renders **three independent badges**,
  no composite.
- Capability badges never modify the leaderboard composite display.
- Capability badges cite their evidence path (link / tooltip).

**Acceptance:**
- Operator can see "Model X is RELEASE_CERTIFIED on general
  benchmark, Vision STABLE on openrouter/mimo-v2-omni route,
  Roleplay PROVIDER_TESTED on openrouter/mimo-v2-flash route"
  at a glance — and nowhere does any one badge influence any
  other.

**Non-goals:**
- Auto-issuing badges (each badge requires the evaluator returning
  `eligible:true` against fresh evidence).

---

## Phase K · Crucible release readiness dashboard

**Goal:** Stand up a single operator-facing dashboard that
aggregates: general benchmark certified targets + Vision
promotion status per route + Roleplay promotion status per
route + open NEEDS_REVIEW queue + outstanding stability runs.

**Files likely touched:**
- New UI tab or extension of the Dashboard tab.
- `server/routes/release-readiness.ts` (new aggregator).
- `tests/release-readiness-dashboard.test.ts` (new).

**Tests required:**
- Dashboard never mixes capability badges into the composite score.
- Dashboard re-asserts `affectsLeaderboard:false` /
  `affectsCertification:false` on every capability section.

**Acceptance:**
- Operator can look at one screen and answer: "what's blocking
  Vision STABLE on route X?" / "what's blocking Roleplay
  CAPABILITY_CERTIFIED on route Y?" / "what NEEDS_REVIEW cells
  are open?"

---

## Sequencing notes

- **Phase A is the prerequisite for everything else.** It lands the
  doctrine + schema + evaluator that the rest depends on. (This
  commit.)
- **B and F are independent.** Vision stability runner and Roleplay
  human-review queue can land in either order.
- **C and H can interleave.** Suite expansion is incremental on both
  sides.
- **D + I are HTTP read-only endpoints**, depend on A.
- **E (Vision third route) is gated** on B + C; nothing structural
  blocks it but the evaluator's CAPABILITY_CERTIFIED gate won't
  return `eligible:true` until both are done.
- **G (Roleplay 5-run stability) depends only on the existing
  `scripts/roleplay-stability.mjs`** — could be done in parallel
  with H.
- **J (model-card badges) is the first UI-promotion phase.**
  Requires D and I to be live so badges have data sources.
- **K (release-readiness dashboard) is the final phase.** Aggregates
  everything.

## What this roadmap does NOT include

- **Direct promotion of any model.** Promotion happens only when
  the evaluator returns `eligible:true` against fresh evidence.
- **Merging capability scores into the leaderboard composite.**
  Doctrine v1 forbids this; future doctrines may revisit but each
  badge stays independent.
- **Sub-capabilities (e.g. "Vision-OCR-only" vs "Vision-spatial-only").**
  v1 treats a capability as monolithic; sub-capability splitting is
  a future doctrine revision.
- **External certification authority.** Crucible is self-attesting;
  no third-party certifier is invoked.
