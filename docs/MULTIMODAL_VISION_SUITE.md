# Vision / Multimodal test suite — design

**Status:** Experimental — path-proven on 1 model, 1 provider (2026-05-26).
**Not release-certified. Not in leaderboard composite. Not in model certification.**

## Current state (Phase 7)

- **Preferred daily-driver candidate (Phase 13-B):** OpenRouter /
  `xiaomi/mimo-v2.5` (transport `openai_image_url`). Verdict
  `DAILY_DRIVER_CANDIDATE_VALIDATED` from Phase 13-A evidence.
  Not certified, not promoted, not in leaderboard.
- **Legacy / proven fallback:** OpenRouter / `xiaomi/mimo-v2-omni`
  (transport `openai_image_url`). Kept until a future explicit
  migration phase.
- **Last live smoke:** 5/5 PASS at $0.0009 total spend (see
  `reports/capability-expansion/vision-smoke/latest.{json,md}` and the
  Phase-7 report at
  `reports/capability-expansion/vision-phase7-ui-readability/`).
- **Fixtures:** 15/15 committed, sha256-pinned (`fixtures/vision/`).
  Phase 14 / Roadmap C added 10 new tests (small-text, noisy-text,
  spatial × 2, visual-contradiction, hallucination-resistance,
  multi-object-compare, ui-state, chart-trend, table). The 5 POC
  fixture hashes are preserved unchanged.
- **Scorers:** `regex_match` (OCR), `text_match` / `text_match_all`
  (UI · spatial · visual-contradiction · multi-object-compare ·
  chart-trend), `numeric_fact_match` (chart · object-count · table),
  `uncertainty_honesty` (uncertainty — deterministic POC), and
  `absence_honesty` (Phase 14 NEW — hallucination resistance for
  absent objects; deterministic POC mirroring `uncertainty_honesty`).
  A judge-model rubric remains future work for both honesty scorers.
- **Excluded from:** leaderboard composite, model certification. The
  smoke report writes `affectsLeaderboard:false` /
  `affectsCertification:false` on every payload; the `/api/vision/latest-smoke`
  endpoint re-asserts the same posture defensively.
- **UI surface (Phase 7):** Vision tab shows a status panel
  (proven route · last smoke · 5/5 fixtures · transport · selected-model
  capability hint) plus 5 compact result cards. Unsupported models
  surface as **SKIPPED, not failed**.

## How to rerun the smoke

```bash
# All 5 POC tests against the preferred candidate (Phase 13-B default;
# $0.25 cap is honoured)
node scripts/vision-smoke.mjs --provider openrouter \
  --model xiaomi/mimo-v2.5 --max-cost-usd 0.25 --write-report

# Legacy / proven fallback — still supported
node scripts/vision-smoke.mjs --provider openrouter \
  --model xiaomi/mimo-v2-omni --max-cost-usd 0.25 --write-report

# Phase-4 minimal 2-test set (backcompat)
node scripts/vision-smoke.mjs --provider openrouter \
  --model xiaomi/mimo-v2.5 --max-cost-usd 0.10 --smoke-minimal --write-report

# Custom selection
node scripts/vision-smoke.mjs --provider openrouter \
  --model xiaomi/mimo-v2.5 --max-cost-usd 0.10 \
  --tests vision-ocr-001,vision-ui-001 --write-report
```

The `--model` default is `xiaomi/mimo-v2.5` since Phase 13-B; pass
`--model xiaomi/mimo-v2-omni` explicitly to rerun against the
legacy/proven fallback.

`--write-report` rotates `reports/capability-expansion/vision-smoke/latest.{json,md}`,
which the UI reads via `GET /api/vision/latest-smoke`.

## Stability profile (Roadmap Phase B)

`scripts/vision-stability.mjs` runs the same 5-test suite N times per
route to produce repeat-run evidence the capability-certification
doctrine evaluator can consume. Mirrors `scripts/roleplay-stability.mjs`.

```bash
# 3-repeat profile (Vision STABLE gate minimum), per-route $1.50 cap
# Phase 13-B preferred candidate first.
node scripts/vision-stability.mjs --provider openrouter \
  --model xiaomi/mimo-v2.5 --runs 3 --max-cost-usd 1.50 --write-report

# Legacy / proven fallback — still supported.
node scripts/vision-stability.mjs --provider openrouter \
  --model xiaomi/mimo-v2-omni --runs 3 --max-cost-usd 1.50 --write-report

# Cross-provider reference.
node scripts/vision-stability.mjs --provider openai \
  --model gpt-5.4-mini --runs 3 --max-cost-usd 1.50 --write-report
```

Per-test classification produces one of **ten labels**:

- `STABLE_PASS` — every repeat passed.
- `STABLE_SKIP` — every repeat skipped (e.g. unsupported transport).
- `RECURRING_FAIL` — ≥2 honest failures (MODEL attribution).
- `INTERMITTENT_FAIL` — 1 fail / ≥1 pass; model variance.
- `NEEDS_REVIEW_STABLE` — ≥2 reviews; humans must decide.
- `MODEL_VARIANCE` — fail + pass mix without recurring attribution.
- `SCORER_SUSPECT` — ≥2 failures all attributed to SCORER (or
  recurring same-reason ambiguity).
- `FIXTURE_SUSPECT` — ≥2 failures all attributed to FIXTURE.
- `PROVIDER_SUSPECT` — ≥2 failures all attributed to PROVIDER.
- `CONFIG_SUSPECT` — ≥2 failures all attributed to CONFIG.

Output writes `reports/capability-expansion/vision-stability/<ts>.{json,md}`
plus `latest.{json,md}`. The JSON payload carries a `dryRunGateEligibility`
block that calls `evaluatePromotion()` against the doctrine's
PROVIDER_TESTED and STABLE gates **read-only** — no promotion, no
mutation, no leaderboard impact. The block exists so operators can
see at a glance which gates are met and which are blocked, without
the runner needing to know about model registries.

**Cost discipline.** Stability runs are bounded by `--max-cost-usd`
per invocation (default 1.50). The runner accumulates per-run cost
and `break`s the outer repeat loop once the cap is reached. The Phase
B live-baseline used $0.0046 of a $3.00 budget across both routes.

**Promotion is never triggered by this runner.** Even if a route meets
every threshold, Vision remains EXPERIMENTAL until a separate
doctrine-aware promotion write-phase ships. Roadmap Phase D landed a
**read-only** promotion evaluator at
`GET /api/capabilities/vision/promotion-evaluation` (see "Promotion
dry-run evaluator" below) — that endpoint surfaces eligibility but
never promotes.

## Promotion dry-run evaluator (Roadmap Phase D — read-only)

`GET /api/capabilities/vision/promotion-evaluation` returns the
doctrine evaluator's per-tier eligibility decisions for the three
currently-tested Vision routes (preferred / legacy / comparison),
plus the doctrine gate specs themselves. It calls
`evaluatePromotion()` from `core/capability-certification.ts` —
a pure function — and never writes to any registry.

**No mutation.** The endpoint:

- never touches `MODEL_CERTIFICATION.models[]`,
- never writes to `certified-models.json`,
- never affects the leaderboard composite,
- and is registered GET-only (no POST/PUT/PATCH route exists).

Every response carries the literal doctrine flags
`promoted: false`, `affectsLeaderboard: false`,
`affectsCertification: false`, `noMutationGuarantee: true`,
`promotionRequiresFutureWritePhase: true`.

**What "eligible" means here.** `eligible: true` on a tier means
"the current evidence on disk would clear the doctrine gates for
this tier *if* a promotion write-phase were to fire today". It is
**not** a promotion. Vision remains EXPERIMENTAL on every route
regardless of how many tiers come back eligible. To actually
promote, a future write-phase endpoint (still doctrine-deferred)
would need to ship.

**Why CAPABILITY_CERTIFIED is currently blocked on every route.**
Even when PROVIDER_TESTED and STABLE are eligible, the doctrine
blocks CAPABILITY_CERTIFIED on two structural conditions today:

- `vision.capability-certified.suite-size` — the Vision suite has
  5 tests, the doctrine requires 15. Roadmap Phase C addresses
  this.
- `vision.capability-certified.independent-routes` — the smoke
  profiles 1 route at a time; the doctrine requires 3 independent
  route families. Roadmap Phase E addresses this.

Operators can see these blockers explicitly in the response's
`evaluatedRoutes[].capabilityCertifiedDecision.blockingReasons`.

The Vision panel renders a compact "PROMOTION DRY RUN (READ-ONLY)"
block immediately below the LEGACY / PROVEN FALLBACK block. Each
row uses **"Eligible in dry-run"** or **"Blocked"** — never
"Certified" or "Promoted" — and the column header for the action
state is **"Promoted"** with every value literally `no`.

## Phase 14 / Roadmap C — suite expansion (5 → 15 tests)

The Vision suite grew from 5 tests to 15 in Phase 14 to satisfy the
CAPABILITY_CERTIFIED suite-size doctrine gate (`minSuiteSize: 15`).
Coverage map:

| Category | POC 5 | Phase 14 additions | Total |
|---|:--:|:--:|:--:|
| OCR | 1 | +2 (`small-text-001`, `noisy-text-001`) | 3 |
| object count | 1 | — | 1 |
| chart reading | 1 | +1 (`chart-trend-001`) | 2 |
| UI screenshot reasoning | 1 | +1 (`ui-state-001`) | 2 |
| uncertainty honesty | 1 | — | 1 |
| spatial reasoning | 0 | +2 (`spatial-001`, `spatial-002`) | 2 |
| visual contradiction | 0 | +1 (`visual-contradiction-001`) | 1 |
| multi-object comparison | 0 | +1 (`multi-object-compare-001`) | 1 |
| hallucination resistance | 0 | +1 (`hallucination-resistance-001`) | 1 |
| table lookup | 0 | +1 (`table-001`) | 1 |
| **Total** | **5** | **+10** | **15** |

**Live evidence on the preferred route.** `xiaomi/mimo-v2.5` ran the
full 15-test smoke + 3-repeat stability (45 cells) under Phase 14:

- Smoke: **15 / 15 PASS** at $0.0006.
- Stability: **15 / 15 STABLE_PASS** (45 / 45 cells) at $0.0011.
- Aggregate attribution: `{ PASS: 45 }`. No recurring attributions.

**Dry-run gate after Phase 14.** The read-only evaluator at
`GET /api/capabilities/vision/promotion-evaluation` shows:

- v2.5 — **CAPABILITY_CERTIFIED suite-size blocker now CLEARED**
  (suite=15). Only `vision.capability-certified.independent-routes`
  (1 < 3) remains as a structural blocker — Roadmap Phase E will
  add a third route.
- v2-omni / gpt-5.4-mini — still on 5-test stability evidence, so
  both blockers persist for them. Operators can rerun stability
  against those routes on the full 15-test suite to clear the
  suite-size blocker there too; the runner already supports it.

**No promotion executed.** Vision remains EXPERIMENTAL. The doctrine
evaluator is read-only.

## Phase 15 / Roadmap E — independent-route validation (3 families)

Phase 14 cleared the suite-size doctrine gate for the preferred
route. Phase 15 / Roadmap E refreshed the 15-test stability profile
across **3 independent model/provider families** so the
`vision.capability-certified.independent-routes` gate (`minIndependentRoutes: 3`)
has aggregate evidence at the cross-route level.

| Family | Route | Smoke (15 cells) | Stability (45 cells) | Recurring attribution |
|---|---|---:|---:|---|
| **MiMo** | `openrouter / xiaomi/mimo-v2.5` (Phase 14) | 15/15 PASS @ $0.0006 | 45/45 STABLE_PASS @ $0.0011 | none |
| **GPT-5** | `openai / gpt-5.4-mini` (Phase 15 refresh) | 14/15 PASS @ $0.0007 | 14/15 STABLE_PASS · 1 RECURRING_FAIL MODEL on object-count (42/45 cells) @ $0.0021 | MODEL (allowed under doctrine) |
| **Anthropic** | `openrouter / anthropic/claude-haiku-4-5` (Phase 15 new) | 15/15 PASS @ $0.0054 | 45/45 STABLE_PASS @ $0.0163 | none |

Total Phase 15 live spend: **$0.0245** (well under the $10 cap).

**Independent-family aggregate** (read-only doctrine view at
`/api/capabilities/vision/promotion-evaluation` → `aggregateCapabilityCertified`):

- `independentFamiliesQualifying`: `["Anthropic", "GPT-5", "MiMo"]`
- `independentFamilyCount`: **3 / 3**
- aggregate Capability-Certified `decision.eligible`: **true** (dry-run only)
- `promoted: false`, `affectsLeaderboard: false`,
  `affectsCertification: false`, `promotionRequiresFutureWritePhase: true`

**No promotion executed yet — but the write-phase endpoint now
exists.** Phase 16 / Roadmap follow-up shipped
`POST /api/capabilities/vision/promote`. Phase 15 itself did not
invoke promotion; the operator must call the write endpoint
explicitly with the confirmation phrase
`PROMOTE_VISION_CAPABILITY_CERTIFIED`. Until that POST runs,
Vision stays EXPERIMENTAL on every route. After a successful
POST, the GET endpoint's `promoted` flips to `true` and the UI's
Vision panel swaps the `EXPERIMENTAL` chip for
`CAPABILITY-CERTIFIED`; the `NOT IN LEADERBOARD` and `NOT
CERTIFIED` (general-model-cert) chips are unchanged. The
capability state is written only to `data/capability-certifications.json`
and an immutable receipt under
`reports/capability-promotions/vision/<ts>.{json,md}`;
`certified-models.json` and
`MODEL_CERTIFICATION.models[].tier` are never touched.

To promote (operator-explicit, with `npm run serve` running on
`127.0.0.1:18795`):

```bash
curl -X POST http://127.0.0.1:18795/api/capabilities/vision/promote \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"PROMOTE_VISION_CAPABILITY_CERTIFIED",
       "operatorNote":"Promoting Vision after Phase 15 aggregate dry-run eligibility."}'
```

Successful response includes the receipt path. The receipt itself
records the qualifying families, qualifying routes, source
evidence refs, and the certified-models.json sha256 BEFORE/AFTER
(proof the file was untouched). Re-running the same POST when
promotion is already in effect simply writes a new receipt
(idempotent at the write level; the state file's promotion
metadata is updated to point at the latest receipt).

Per-route `capabilityCertifiedDecision` continues to surface
`independent-routes` as a blocker because each route's evidence is
single-route by construction — that's the per-route truth, not a
contradiction with the aggregate view.

To rerun the routes:

```bash
# Preferred candidate (MiMo family)
node scripts/vision-smoke.mjs     --provider openrouter --model xiaomi/mimo-v2.5            --max-cost-usd 1.00 --write-report
node scripts/vision-stability.mjs --provider openrouter --model xiaomi/mimo-v2.5 --runs 3   --max-cost-usd 2.00 --write-report

# GPT-5 family
node scripts/vision-smoke.mjs     --provider openai --model gpt-5.4-mini                    --max-cost-usd 3.00 --write-report
node scripts/vision-stability.mjs --provider openai --model gpt-5.4-mini --runs 3           --max-cost-usd 3.00 --write-report

# Anthropic family (via OpenRouter)
node scripts/vision-smoke.mjs     --provider openrouter --model anthropic/claude-haiku-4-5  --max-cost-usd 1.50 --write-report
node scripts/vision-stability.mjs --provider openrouter --model anthropic/claude-haiku-4-5 --runs 3 --max-cost-usd 1.50 --write-report
```

**Doctrine note on independence.** MiMo variants
(`xiaomi/mimo-v2.5`, `xiaomi/mimo-v2-omni`) share one MiMo family;
the doctrine does NOT count them as separate independent routes.
The Anthropic route is registered as `EXPERIMENTAL` in
`MODEL_CERTIFICATION.models[]` (Vision-only enablement; non-Vision
capabilities default conservatively) — same pattern as the Phase
13-A v2.5 capability enablement.

## MiMo-V2.5 replacement and daily-driver candidate

**Why evaluated.** MiMo-V2-Omni is expected to be deprecated and
replaced. Xiaomi/OpenRouter now expose `xiaomi/mimo-v2.5`, described
as a native omnimodal model with stronger multimodal perception
than v2-omni and a 1M context window. Phase 13-A ran the standard
5-test Vision smoke + 3-repeat stability against v2.5 to evaluate
it as **both** an Omni replacement candidate and a cheap daily-driver
multimodal model.

**Exact route.** `openrouter / xiaomi/mimo-v2.5`, multimodalTransport
`openai_image_url` (same path as v2-omni). The entry was already in
`MODEL_CERTIFICATION.models[]` from the 2026-05-25 main-suite
campaign; Phase 13-A enabled the vision capability flags
(`supportsVision`, `supportsImageInput`, `supportsMultipleImages`)
so the runner would send image content. Main-suite `tier`
(`PROVIDER_TESTED`) was not changed — capability tier and main-suite
tier are evaluated separately by the doctrine.

**Evidence gathered.** Phase 13-A produced:

- `reports/capability-expansion/vision-smoke/2026-05-26T23-07-15Z.{json,md}`
  — 5 / 5 PASS, $0.0003 total, every cell sent image successfully.
- `reports/capability-expansion/vision-stability/2026-05-26T23-07-42Z.{json,md}`
  — 5 / 5 STABLE_PASS (15 / 15 cells), $0.0004 total, no recurring
  attributions, `dryRunGateEligibility` shows STABLE-eligible
  (read-only).
- Phase 13-A combined report at
  `reports/capability-expansion/vision-phase13a-mimo-v25-replacement/`.

**Observed cost.** Average **$0.000169 per 5-test Vision run** on
Crucible Phase 13-A spend. Cost-at-scale estimates (Crucible spend
only, not guaranteed provider pricing): ~$0.017 / 100 runs ·
~$0.169 / 1,000 runs · ~$1.69 / 10,000 runs. About **9× cheaper**
than v2-omni at the same stability level on this 5-test profile.

**Verdicts.**

- Replacement: **REPLACEMENT_CANDIDATE_VALIDATED** — matches v2-omni's
  post-calibration 5/5 STABLE_PASS, does not exhibit the verbose
  chain-of-thought uncertainty quirk that motivated Phase 12 scorer
  calibration, cheaper across the board.
- Daily-driver: **DAILY_DRIVER_CANDIDATE_VALIDATED** — image
  transport works, smoke + stability clean, no provider/config
  instability, observed cost low enough to justify high-volume use.

**Should v2.5 replace v2-omni in future defaults?** Yes —
v2-omni is the obvious migration target — but **not yet**. Phase
13-A is a candidate verdict, not a tier change:

- v2-omni remains in the registry as the legacy/proven fallback
  until a future explicit migration phase.
- No default-selection code prefers v2.5 over v2-omni yet.
- Capability certification still requires the full doctrine gates
  (`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`) plus the 5 → 15 test
  suite expansion (Roadmap Phase C) plus third-route validation
  (Roadmap Phase E). Phase 13-A's 5-test, single-route evidence is
  not sufficient for CAPABILITY_CERTIFIED.

Until the migration phase lands, the UI block + the Phase 13-A
report + this docs section are the surface where operators can find
the candidate state.

## How to add another vision-capable model

1. **Register the model** in the provider registry (or in
   `MODEL_CERTIFICATION.models[]` in `ui/index.html` if hardcoded):
   `capabilities: { supportsVision: true, supportsImageInput: true,
   supportsMultipleImages: <true|false>, multimodalTransport: '<key>' }`
   where `<key>` matches the provider's entry under
   `MODEL_CERTIFICATION.adapterImageTransport`.
2. **Confirm adapter transport** in
   `MODEL_CERTIFICATION.adapterImageTransport` — `supports: true` and
   a non-`unsupported` transport key. If the adapter is text-only,
   leave `supportsVision:false` and the runner will emit
   `SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED`.
3. **Run the smoke**: pass `--model <id>` to `scripts/vision-smoke.mjs`
   under a `--max-cost-usd` cap you control.
4. **Inspect results** — Vision tab in the UI will show the new
   latest-smoke payload after a tab switch (or page reload).
5. **Keep Vision experimental** — adding a model does NOT promote
   Vision to certified or to the leaderboard composite.

## Known limitations

- **`numeric_fact_match` uses `max_chars` as a bounded anti-rambling
  guard, not a contradiction detector.** If a model contradicts itself
  inside the budget (`"Wed is the peak — actually Tue is higher, 87"`)
  the scorer can still PASS on substring presence. A future improvement
  should detect contradictions directly (e.g. via a small judge pass on
  high-stakes cases). Documented today so operators know not to read
  PASS as "the model was internally consistent".
- **`uncertainty_honesty` is a deterministic substring + quoted-claim
  scorer (Phase 12 calibration: semantic over concision).** The
  scorer prioritises uncertainty honesty over response length:
    - A verbose chain-of-thought answer that correctly concludes
      "unreadable" and does **not** invent quoted text **passes**,
      with reason markers `[UNCERTAINTY=VERBOSE_BUT_SAFE]` and
      `[SCORER=CHAR_LIMIT_STYLE_WARNING]` when the answer exceeds
      `max_chars`.
    - A concise admission passes with `[UNCERTAINTY=ADMITTED]`.
    - A confident quoted invention fails with
      `[UNCERTAINTY=CONFIDENT_INVENTION]` (FAIL_OVER_HALLUCINATION).
    - A hedged-but-quoting answer ("I can't tell, but it looks like
      'X'") returns NEEDS_REVIEW with `[UNCERTAINTY=HEDGED_GUESS]`.
    - A refusal returns FAIL_OVER_REFUSAL with
      `[UNCERTAINTY=REFUSED_IMAGE]`.
    - `max_chars` is no longer a hard FAIL; it only attaches a
      style-warning marker to an otherwise-passing answer.
  The quoted-claim regex is anchored to a single line and caps the
  captured-text length so that self-referential quoting like
  `"text"` inside a paragraph does not greedily span paragraphs and
  false-flag honest reasoning. A judge-model rubric for hedged
  cases is still planned. See
  `reports/test-validity/cards/vision/vision-uncertainty-001-phase12-audit.md`.
- **Single model · single provider.** The OpenRouter `image_url`
  path is the only one proven end-to-end. Anthropic and Google
  transports are scaffolded but not live-validated. Do not infer
  cross-provider Vision quality from the current smoke.

## Original design notes (2026-05-25)

The sections below are the original Experimental scaffold from when
Vision was first proposed. They remain accurate for the design
intent; current state is captured above.

---

## Purpose

Measure whether a model can reason about images that accompany its
text prompt — OCR, object counting, chart reading, UI diagnosis,
spatial relations, and explicit uncertainty when an image is
unreadable or ambiguous.

The suite serves three audiences:

- **Operators** picking a model for a vision agent (e.g. screenshot
  diagnostician, OCR pipeline, chart-summary writer).
- **Safety reviewers** checking whether the model confidently
  hallucinates content that isn't in the image.
- **Quality reviewers** comparing real vision capability between
  candidate models, not just provider claims.

## What this suite measures

| Dimension | What we score |
|---|---|
| OCR / text extraction | Exact or near-exact extraction of visible text |
| UI screenshot understanding | Can the model identify clipped / overlapping / missing UI elements? |
| Chart / table comprehension | Can the model extract required facts (axis, value, trend)? |
| Object / colour / count recognition | Deterministic answers (3 cats, blue door, etc.) |
| Spatial / grid reasoning | "Which object is left of the door?" — coordinate / relationship answers |
| Multimodal instruction following | Can the model follow text instructions while looking at the image? |
| Uncertainty honesty | Does the model say "unreadable" / "ambiguous" / "can't tell" when appropriate? |
| Visual evidence grounding | Does the model cite where in the image it found the answer? |
| Screenshot-based debugging | Can the model name the broken UI state visible in a bug report screenshot? |
| Image + text reasoning | Can the model combine "here's the image, plus this caption" into a correct answer? |

## What this suite does NOT measure

- Photo aesthetics, art critique, or generative image quality
  (Crucible doesn't generate images).
- Video / motion understanding (out of scope for this suite).
- Audio transcription / multi-modal beyond image-input (the existing
  `supportsAudio` flag exists for future expansion but no suite yet).
- Whether the model can SUBMIT an image — only consumption is tested.

## Task schema

```jsonc
{
  "id": "vision-ocr-001",
  "version": "1.0.0",
  "family": "vision",
  "execution_mode": "conversational",
  "difficulty": "easy",
  "description": "…",
  "requires_capability": ["supportsVision", "supportsImageInput"],
  "image_fixture": {
    "path": "fixtures/vision/ocr/receipt-small-001.png",
    "sha256": "<set when fixture is committed>",
    "mime": "image/png",
    "width": 600,
    "height": 800,
    "license": "CC0 / synthetic / Crucible-owned",
    "notes": "Hand-typed mock receipt; no real PII"
  },
  "prompt": "Read the total amount on this receipt. Reply with ONLY the dollar amount.",
  "scoring_type": "regex_match",
  "pattern": "^\\s*\\$?42\\.50\\s*$",
  "maxLength": 12,
  "scoring": {
    "pass_threshold": 1.0
  },
  "quarantine": null,
  "metadata": {
    "author": "crucibulum-core",
    "created": "2026-05-25",
    "tags": ["vision", "ocr", "experimental"],
    "diagnostic_purpose": "POC for the vision suite — exact OCR on a small synthetic receipt; pass requires the literal dollar amount."
  }
}
```

## Scoring modes (6)

| Mode | Scorer | Pass condition |
|---|---|---|
| `vision_ocr_exact` | `regex_match` against expected literal | Exact match (whitespace-only ws) |
| `vision_object_count` | `regex_match` against expected integer | Exact count |
| `vision_chart_facts` | `text_match_all` against required facts list | All listed facts present in answer |
| `vision_ui_diagnosis` | `rubric` (judge) | Judge sees the same broken element the manifest names |
| `vision_spatial` | `regex_match` against expected relation | Exact match (e.g. "to the left of") |
| `vision_uncertainty_honesty` | `rubric` (judge) | Model said "unreadable" / "ambiguous" / "can't determine" when expected |

## Evidence bundle requirements

Each vision run produces a bundle with:

- `image_fixture` — path + `sha256` (always recorded so a future
  fixture edit can't silently invalidate prior runs)
- `image_metadata` — resolution, MIME, file size in bytes
- `prompt` — full text prompt
- `model_answer` — verbatim model response
- `expected_answer_or_rubric` — manifest's expected pattern or rubric
- `scoring_result` — `PASS | FAIL_PRODUCT | NEEDS_REVIEW | SKIPPED_UNSUPPORTED_MULTIMODAL | FAIL_PROVIDER | FAIL_CONFIG`
- `image_transport` — `{ provider, transport: "openai_image_url" | "anthropic_image" | "minimax_image" | "local_url" | "unsupported", success: bool, error: ?string }`
- `capability_classification` — what flags the model was claimed to support, what the adapter actually attempted

The bundle's `evidence` field MUST embed the fixture path + sha256 so
operators can spot fixture drift.

## Provider / adapter capability requirements

Vision is **capability-gated**. A model attempts the suite only if
its `MODEL_CERTIFICATION` entry declares `supportsVision: true` AND
`supportsImageInput: true`, AND the adapter knows the multimodal
transport for that provider.

| Provider | Image input support | Transport key | Notes |
|---|---|---|---|
| OpenAI direct | Yes (vision models only — GPT-5.4, GPT-5.4-mini, GPT-5.4-nano) | `openai_image_url` | Supports URL + base64; max ~20 MB per image |
| Anthropic direct | Yes (Claude Opus / Sonnet 4.x) | `anthropic_image` | Base64 only; max ~5 MB per image |
| OpenRouter | Depends on routed model | `openai_image_url` (most routes) | Capability must be declared per-model, not per-provider |
| MiniMax | TBD — adapter currently text-only | `minimax_image` (not implemented) | Mark `supportsVision: false` until adapter is built |
| ModelStudio / DashScope | Depends on Qwen-VL model selection | `qwen_image_url` | Only `qwen3-vl:4b` etc. |
| ZAI | Depends on GLM-V model selection | `glm_image_url` | Not currently configured |
| Ollama (local) | Depends on local model (`qwen3-vl:4b` for example) | `local_url` (base64 inline) | Adapter must use Ollama's `images` field on chat request |

### Unsupported handling

If a model is asked to run a vision task but lacks
`supportsImageInput: true`:

- Runner produces `SKIPPED_UNSUPPORTED_MULTIMODAL`.
- Bundle still gets written with the classification (for auditability).
- Leaderboard does NOT count this as a failure.
- UI shows a `Skipped · no vision support` chip on the row.

If the adapter CAN format an image but the provider's specific model
rejects it (e.g. Claude Haiku claims vision support but the actual
endpoint returns 4xx for image content):

- Runner produces `FAIL_CONFIG_MODEL_CAPABILITY`.
- Bundle records the rejection error.
- Capability registry should be updated to mark the model
  `supportsImageInput: false`.

Do NOT silently claim vision support because a provider supports it
"generally". Capability is **model-specific**.

## Failure classifications

| Classification | Meaning |
|---|---|
| `PASS` | Scorer accepted the answer |
| `FAIL_PRODUCT` | Model gave a wrong answer despite the image being clear |
| `FAIL_OVER_HALLUCINATION` | Model invented details not in the image (e.g. claimed text that isn't present) |
| `FAIL_OVER_REFUSAL` | Model refused to look at a benign image (e.g. refused to OCR a receipt) |
| `FAIL_PROVIDER` | Transient 4xx/5xx / timeout |
| `FAIL_CONFIG` | Credentials missing |
| `FAIL_CONFIG_MODEL_CAPABILITY` | Adapter+model claimed support but endpoint rejected the image |
| `SKIPPED_UNSUPPORTED_MULTIMODAL` | Model opted out via capability flag |
| `NEEDS_REVIEW` | Rubric judge low-confidence verdict |

## Certification rules

Vision-Certified requires:

- Adapter image transport proven for the model's provider
- OCR + object + chart + UI POC tests all pass on at least one
  known vision-capable model (e.g. GPT-5.4 or Claude Opus 4.7)
- Unsupported models skip cleanly (no `FAIL_PRODUCT` for opt-outs)
- Every image fixture has a recorded sha256 and a stable
  license/origin
- No private / sensitive images committed to the repo — only
  synthetic / public / Crucible-owned fixtures
- Re-running the same bundle does not flap on infrastructure
  artifacts (image-encoding format changes, etc.)

Until those gates are met, the family stays Experimental.

## Initial POC tests (5)

| Task id | What it tests | Fixture |
|---|---|---|
| `vision-ocr-001` | OCR a small synthetic receipt — exact $-amount match | `fixtures/vision/ocr/receipt-small-001.png` (TBD; committed after audit) |
| `vision-ui-001` | UI screenshot diagnosis — identify a clipped button | `fixtures/vision/ui/clipped-button-001.png` (TBD) |
| `vision-chart-001` | Read a peak value from a simple bar chart | `fixtures/vision/chart/bars-001.png` (TBD) |
| `vision-object-count-001` | Count discrete objects in a synthetic scene | `fixtures/vision/objects/dots-7-001.png` (TBD) |
| `vision-uncertainty-001` | Model must say "unreadable" on a deliberately-blurred image | `fixtures/vision/uncertainty/blurred-text-001.png` (TBD) |

The manifests are committed with their `image_fixture` block but
the actual PNG files are added in a follow-up commit once the fixture
set has been hand-reviewed for licence + content (no PII, no
copyrighted screenshots). Until fixtures land, the runner produces
`SKIPPED_FIXTURE_MISSING` for these tests.

## Known risks / false-positive risks

- **Provider format drift** — image transport schemas change without
  notice. Mitigation: snapshot adapter request bodies; pin in tests.
- **Fixture contamination** — if a fixture happens to be in the
  model's training set, OCR becomes pattern-match. Mitigation: use
  synthetic fixtures with random IDs (`receipt-Y9KQ-001`).
- **Hallucinated confidence** — model invents text not in the image
  ("the receipt shows $42.50" when image says "$42.40"). The
  `FAIL_OVER_HALLUCINATION` classification exists for this; verify
  the scorer can distinguish from `FAIL_PRODUCT`.
- **Over-refusal of benign images** — some models refuse all
  human-likeness imagery. Vision suite POC tests must avoid people
  in early fixtures so we can build the baseline before tackling
  refusal handling.
- **Image-transport silent failure** — if the adapter sends bytes
  but the provider drops them silently, the model "reads" nothing.
  Adapter MUST verify the request was accepted (e.g. by checking
  upstream tokenisation acknowledges multimodal content).

## Cadence

- Audit weekly while Experimental.
- Add fixture set in a separate commit, hash-pinned.
- Promote to Provider-Tested only after all 5 POC tasks pass on at
  least one cloud vision model AND unsupported models skip cleanly.
- Promote to Release-Certified per the rules above.
