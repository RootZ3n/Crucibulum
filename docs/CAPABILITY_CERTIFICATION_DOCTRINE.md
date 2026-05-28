# Luak — Capability Certification Doctrine

**Date:** 2026-05-26
**Status:** Doctrine v1. Defines promotion gates for Vision and Roleplay
(and the schema for future capability lanes). **Does not promote any
capability** — Vision and Roleplay both remain Experimental until
explicit gate evaluation against this doctrine is performed in future
implementation phases.

## Why this doctrine exists

Luak already certifies models on its general benchmark composite
(see `docs/MODEL_CERTIFICATION.md` + `docs/RELEASE_READINESS.md`).
That composite measures truthfulness, code quality, safety,
operational trust, etc. — capabilities every text-capable cloud model
is expected to attempt.

Vision and Roleplay are different. They are:

- **opt-in** — many text-only models cannot run them at all (SKIPPED,
  not failed)
- **adversarially shaped** — fixture/scorer calibration is harder
- **variance-prone** — repeated runs produce meaningfully different
  results (especially Roleplay; sometimes Vision)
- **subjectively bordered** — "good Roleplay" or "good Vision
  reasoning" has nuance the deterministic pipeline cannot fully
  capture today

Mixing these into the main composite would either dilute the
benchmark score or pretend the capability is more certain than it
is. Doctrine v1 keeps capability tiers **strictly separate** from
the general benchmark composite and model-certification tier.

A model card may eventually carry **multiple independent badges**:

- **General Benchmark Certified** (existing — driven by
  `MODEL_CERTIFICATION.models[].tier`)
- **Vision Provider-Tested / Stable / Capability-Certified**
- **Roleplay Provider-Tested / Stable / Capability-Certified**

Each badge has its own evidence trail. No badge contributes to any
other.

## Tier definitions

Five tiers, ordered by promotion direction (low → high) plus one
disqualification tier:

### EXPERIMENTAL

**Meaning:** Live path may exist, suite may be incomplete, scorers
may still be calibrating. Results are visible but non-promotional.

| May | May not |
|---|---|
| Run in UI tabs | Affect leaderboard composite |
| Persist evidence reports | Affect model-certification tier |
| Show "EXPERIMENTAL" chip | Affect release-gate state |
| Be referenced in audit/calibration history | Confer any public capability badge |
| Be hot-reloaded in stability profiles | Be cited as "this model can do X" |

Current state: **Vision** and **Roleplay** are both EXPERIMENTAL.

### PROVIDER_TESTED

**Meaning:** Capability was successfully exercised against a specific
provider/model route. Transport is proven. Failures are attributed.
Performance is not claimed.

| May | May not |
|---|---|
| Show "Provider-Tested" badge on capability panel | Affect leaderboard composite |
| Surface in capability-specific reports | Affect model-certification tier |
| Be claimed as "route works end-to-end" | Affect release gate |
| Inform operator decisions about which routes to use | Be cited as "this model is good at X" |
| Be a prerequisite for STABLE | Be combined into a single capability score |

### STABLE

**Meaning:** Repeated runs meet stability thresholds. Failures are
mostly model-attributed and understood. Eligible for a public
capability badge.

| May | May not |
|---|---|
| Show "Stable" capability badge publicly | Affect leaderboard composite |
| Be cited as "this route reliably handles X" | Affect model-certification tier |
| Be a prerequisite for CAPABILITY_CERTIFIED | Affect release gate |
| Be referenced from external model cards | Force any composite score change |

### CAPABILITY_CERTIFIED

**Meaning:** Broader suite coverage met. Stability validated across
multiple model families. Evidence bundle complete. UI/browser
validation complete. Capability badge can be shown publicly.

| May | May not |
|---|---|
| Show "Capability-Certified" badge publicly | Affect leaderboard composite |
| Be a release-eligible capability | Affect model-certification tier (general) |
| Confer capability-specific release scope | Force any composite score change |
| Cause `certified-capabilities.json` (future) entry | Be added to `certified-models.json` general tier |
| Drive capability-specific release notes | Be confused with general-benchmark certification |

### BLOCKED_UNSUPPORTED

**Meaning:** Provider/model cannot run the capability. Transport
unsupported, config missing, adapter rejects, or model itself
declares no support.

| May | May not |
|---|---|
| Mark capability metadata as unsupported | Claim partial / latent support |
| Show "skipped — not failed" chip | Be hidden from the operator |
| Be a stable state (no implicit promotion) | Be aggregated into model failure rate |

A route in BLOCKED_UNSUPPORTED **cannot** silently move to
PROVIDER_TESTED — explicit re-test required after the blocking
condition is resolved.

## Vision promotion gates

### Vision · EXPERIMENTAL (current)

Current state of Vision per `reports/capability-expansion/`:
- 5-test POC suite (`vision-ocr-001`, `vision-ui-001`,
  `vision-chart-001`, `vision-object-count-001`,
  `vision-uncertainty-001`)
- 2 tested routes (`openrouter / xiaomi/mimo-v2-omni`,
  `openai / gpt-5.4-mini`)
- Synthetic sha256-pinned fixtures
- Calibrated scorers (regex / numeric_fact_match / uncertainty_honesty / text_match)
- Attribution wired (MODEL / FIXTURE / SCORER / PROVIDER / CONFIG / NEEDS_REVIEW)
- UI panel + browser validation done

### Vision · PROVIDER_TESTED (gates)

A specific (provider, model) route is eligible for PROVIDER_TESTED
once **all** of the following hold:

1. At least one successful full-suite run for the exact route.
2. Image transport proven — adapter accepts and forwards `image_url`
   content parts; `imageSent:true` on every image test in the run.
3. Fixture hashes verified — all 5 fixtures pass sha256 preflight.
4. No unresolved CONFIG or PROVIDER transport ambiguity (i.e. no
   `SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED`, `FAIL_CONFIG`, or
   `FAIL_PROVIDER` in the report).
5. Written report under
   `reports/capability-expansion/vision-smoke/<ts>.{json,md}`
   carries `affectsLeaderboard:false` and `affectsCertification:false`.

### Vision · STABLE (gates)

PROVIDER_TESTED + **all** of:

1. At least 3 repeat runs for the exact route via a stability
   runner (to be built — see roadmap phase B).
2. No unresolved `FIXTURE` or `SCORER` attribution-suspect results
   across repeats.
3. At least **80%** pass rate across repeats (≥ 12 PASS out of
   15 cells for a 5-test × 3-repeat profile).
4. Zero image-transport failures across repeats.
5. Zero OCR-sanity transport failures across repeats.
6. Failures attributed strictly as `MODEL` or `NEEDS_REVIEW`.
7. Cost / tokens captured in the stability report.
8. Latest stability report exists at
   `reports/capability-expansion/vision-stability/latest.{json,md}`.

### Vision · CAPABILITY_CERTIFIED (gates)

STABLE + **all** of:

1. Suite expanded beyond current 5-test POC.
2. Minimum **15 tests** in the live profile.
3. Coverage must include each of:
   - OCR
   - object count
   - chart reading
   - UI screenshot reasoning
   - uncertainty honesty
   - spatial reasoning
   - small text / noisy text
   - visual contradiction
   - multi-object comparison
   - hallucination resistance
4. At least **3 independent model/provider families** tested
   during suite validation (e.g. `openrouter/*` mimo + `openai/*` +
   one of {`anthropic/*` direct, `google/*`, local `ollama/*-vl`}).
5. Exact route hits the STABLE stability threshold defined above.
6. No unresolved scorer / fixture / prompt issues across the
   expanded suite.
7. Browser/UI report validation complete (mirroring Vision Phase 8
   pattern).
8. Certification report generated at
   `reports/capability-certification/vision/<route>/<ts>.{json,md}`.
9. Capability badge shown separately from leaderboard — never
   inside the composite.

## Roleplay promotion gates

### Roleplay · EXPERIMENTAL (current)

Current state of Roleplay per `reports/capability-expansion/roleplay-experimental-v1/`:
- 7-test live POC profile
- 2 tested routes (`openrouter / xiaomi/mimo-v2-flash`,
  `openrouter / deepseek/deepseek-v4-flash`)
- 5 calibrated scorers (HARD_BANNED + context classifier, refusal
  intent, persona voice, continuity fact match, stability classifier)
- 3-repeat stability profiling via `scripts/roleplay-stability.mjs`
- UI panel + failed-turn sub-cards + Experimental v1 baseline doc

### Roleplay · PROVIDER_TESTED (gates)

A specific (provider, model) route is eligible for PROVIDER_TESTED
once **all** of:

1. Full 7-test suite run for the exact route.
2. Evidence bundles include per-turn transcripts (the per-turn
   `question` + `responsePreview` + `failureReason` fields
   introduced in Phase 4).
3. Failure attribution wired (MODEL / PROMPT / SCORER / FIXTURE /
   PROVIDER / CONFIG / NEEDS_REVIEW).
4. No PROVIDER or CONFIG failure in the run.
5. No UNSAFE_COMPLIANCE pass anywhere in the run.
6. Report at `reports/capability-expansion/roleplay-smoke/<ts>.{json,md}`
   carries `affectsLeaderboard:false` and `affectsCertification:false`.

### Roleplay · STABLE (gates)

PROVIDER_TESTED + **all** of:

1. At least **5 repeat runs** for the exact route via
   `scripts/roleplay-stability.mjs --runs 5+`.
2. No unresolved `SCORER_SUSPECT` / `PROMPT_SUSPECT` / `FIXTURE`
   classification in the stability report.
3. At least **80%** stable-pass rate across repeats
   (e.g. ≥ 28 PASS out of 35 cells for 7 × 5).
4. **Zero recurring severe persona-break** (no
   `[SEVERITY=SEVERE drift]` recurring on any persona-break turn).
5. **Zero recurring unsafe compliance**.
6. **Zero recurring hard contradiction** (no
   `[SEVERITY=HARD contradiction]` recurring on any continuity /
   contradiction turn).
7. `NEEDS_REVIEW` rate below **15%** of total cells (or
   explicitly documented if higher).
8. Human-review queue cleared or explicitly documented per turn.
9. Failures attributed cleanly — no `UNKNOWN` / generic attribution.

### Roleplay · CAPABILITY_CERTIFIED (gates)

STABLE + **all** of:

1. Suite expanded beyond current 7-test POC.
2. Minimum **20 roleplay scenarios** in the live profile.
3. Coverage must include each of:
   - character consistency
   - long-form drift
   - continuity (across multiple sessions if applicable)
   - distractor resistance
   - contradiction handling
   - in-character refusal
   - persona-break resistance
   - emotional tone (warmth / sternness / sorrow / wonder)
   - teaching / tutoring style
   - DM / narrator pacing
   - scene memory
   - companion warmth / helpfulness
   - refusal without generic boilerplate
4. Deterministic scorers used where possible (extending
   `classifyPersonaVoice`, `classifyRoleplayRefusalIntent`,
   `scoreRoleplayContinuityFactMatch`, `classifyForbiddenPhraseContext`).
5. Judge-assisted or human-review layer used **only** for
   subjective quality (prose / wit / tone nuance). Judge rubric
   must itself be separately validated (consistent across N runs;
   no leakage of model identity into rubric).
6. Repeated stability profile complete at ≥ 5 repeats.
7. No unresolved severe recurring failures.
8. Public UI badge remains separate from general leaderboard.
9. Certification report at
   `reports/capability-certification/roleplay/<route>/<ts>.{json,md}`.

## Evidence requirements

Any capability promotion request must reference evidence covering
**all** of:

- Exact `providerId`
- Exact `modelId`
- Adapter id and adapter image-transport path (for Vision)
- Capability metadata from `MODEL_CERTIFICATION.models[…].capabilities`
- Run ids
- Bundle ids
- Report paths (smoke + stability + audit cards if any)
- Fixture hashes (Vision; from each manifest `image_fixture.sha256`)
- Transcript excerpts (Roleplay; from `turnSummary[].question` +
  `responsePreview`)
- `imageSent` (Vision; per turn)
- Cost / tokens (per route, per stability run)
- Latency if available
- pass / fail / needs-review / skip counts
- Attribution counts (per stability run)
- Stability classification (per test)
- Known limitations (explicit list)
- Historical source reports (every prior phase report + audit card
  for that capability)
- Commit hashes

**Promotion without evidence is structurally impossible.** The
`evaluatePromotion()` helper rejects empty `evidenceRefs[]` arrays.

## Schema / API design

### Types (implemented in `core/capability-certification-types.ts`)

- `CapabilityId` — extensible discriminated union (currently
  `"vision" | "roleplay"`).
- `CapabilityTier` — `"EXPERIMENTAL" | "PROVIDER_TESTED" | "STABLE"
  | "CAPABILITY_CERTIFIED" | "BLOCKED_UNSUPPORTED"`.
- `CapabilityEvidenceRef` — `{ kind, path, commit?, generatedAt? }`
  pointing at the report / bundle / audit card that supports a
  claim.
- `CapabilityRouteCertification` — a route's current tier with
  evidence list. **Always carries `affectsLeaderboard: false` and
  `affectsCertification: false` as compile-time `false` literals.**
- `CapabilityGateFailure` — `{ gate, reason, evidenceRefs }` for
  each blocking condition.
- `CapabilityPromotionDecision` — `{ eligible, capability,
  providerId, modelId, currentTier, proposedTier, blockingReasons,
  evidenceRefs, generatedAt, affectsLeaderboard:false,
  affectsCertification:false }`.

### Evaluator (implemented in `core/capability-certification.ts`)

- `VISION_GATES`, `ROLEPLAY_GATES` — tier → `CapabilityGateSpec`
  maps with thresholds.
- `evaluatePromotion(input)` → `CapabilityPromotionDecision`.
  Returns `eligible: false` with an explicit `blockingReasons[]`
  list when any gate fails. The result is **read-only data**; this
  evaluator never writes to `certified-models.json` or any
  leaderboard registry.

### Future API surface (NOT yet built; in roadmap)

Future phases may add:

- `data/certified-capabilities.json` — committed registry of route-
  tier mappings (separate from `certified-models.json`).
- `GET /api/capabilities/<vision|roleplay>/routes` — read-only
  endpoint serving `CapabilityRouteCertification[]`.
- `GET /api/capabilities/<id>/promotion-eval/<provider>/<model>`
  — runs the evaluator and returns the decision JSON.

## UI requirements

A capability panel (Vision or Roleplay tab) must show:

- **Capability status** (EXPERIMENTAL chip today; STABLE / CAPABILITY-CERTIFIED
  chips when gates are met)
- **Tier**, with tooltip explaining what the tier permits
- **Tested routes** with their per-route tier
- **Latest stability profile** path
- **Promotion blockers** (if any — pulled from
  `evaluatePromotion().blockingReasons`)
- **Known limitations** (pulled from baseline doc)
- **Whether it affects leaderboard** — must explicitly render "No"
- **Whether it affects certification** — must explicitly render "No"
- **Evidence / report links**

Capability badges **must not** blend into the leaderboard score or
the general model-certification tier. A model card may eventually
show three independent badges side-by-side, but each renders from
its own data source.

## Tests required

`evaluatePromotion()` and the doctrine constants are exercised by
`tests/capability-certification-doctrine.test.ts`. The tests pin
the doctrine guarantees so future code edits cannot silently
weaken them:

1. EXPERIMENTAL cannot affect leaderboard (compile-time literal +
   runtime assertion).
2. EXPERIMENTAL cannot affect certification.
3. PROVIDER_TESTED requires evidence refs (empty array → ineligible).
4. STABLE requires stability summary (low repeat count → ineligible).
5. CAPABILITY_CERTIFIED requires expanded-suite threshold.
6. Vision cannot certify with only 5 tests (current state) →
   `eligible: false` with `suite-size` blocking reason.
7. Roleplay cannot certify with only 7 tests (current state) →
   `eligible: false` with `suite-size` blocking reason.
8. BLOCKED_UNSUPPORTED route cannot claim support.
9. Capability tiers remain separate from main leaderboard
   (`MODEL_CERTIFICATION.models[].tier` and capability tier are
   never the same field).
10. Existing Vision exclusion tests still pass.
11. Existing Roleplay exclusion tests still pass.
12. `certified-models.json` unchanged.

## Non-goals (this phase)

- ❌ Do not promote Vision or Roleplay.
- ❌ Do not add a real `data/certified-capabilities.json` registry
  yet (designed in the roadmap; deferred to phase J).
- ❌ Do not add a real `/api/capabilities/...` endpoint yet
  (roadmap phase J).
  - **2026-05-26 Phase D update:** a **read-only** Vision
    promotion-evaluator endpoint did ship at
    `GET /api/capabilities/vision/promotion-evaluation`. It calls
    `evaluatePromotion()` (pure function) for each currently-tested
    Vision route (preferred / legacy / comparison) and returns the
    per-tier dry-run decisions plus the doctrine gate specs. The
    endpoint **never** mutates `MODEL_CERTIFICATION.models[]`,
    `certified-models.json`, or the leaderboard composite — every
    response declares `affectsLeaderboard: false`,
    `affectsCertification: false`, `promoted: false`, and
    `noMutationGuarantee: true`. It is registered GET-only; no
    POST/PUT/PATCH promotion path exists. An actual promotion
    write-phase endpoint is still doctrine-deferred (the original
    phase-J scope).
  - **2026-05-27 Phase 16 update:** the doctrine-aware write phase
    did ship at `POST /api/capabilities/vision/promote`. The write
    is **operator-explicit** (requires the confirmation phrase
    `PROMOTE_VISION_CAPABILITY_CERTIFIED` in the request body) and
    **doctrine-gated** (refuses unless the current
    `aggregateCapabilityCertified.decision.eligible` is `true` with
    empty `blockingReasons`). The write affects exactly two
    locations:
      - `data/capability-certifications.json` (persistent
        capability-certification state — operator-written,
        gitignored).
      - `reports/capability-promotions/vision/<ts>.{json,md}`
        (immutable receipt — committed to the repo as audit
        evidence, never edited).
    The write **never** touches `MODEL_CERTIFICATION.models[]`,
    `certified-models.json`, or the leaderboard composite. The
    receipt records the certified-models.json sha256 BEFORE and
    AFTER the write so consumers can verify the file was untouched.
    A successful POST flips the GET endpoint's response shape:
    `promoted: true`, `currentTier: "CAPABILITY_CERTIFIED"`,
    `promotionState: {...}`, `promotionRequiresFutureWritePhase: false`.
    The capability-specific badge in the UI's Vision panel swaps
    from `EXPERIMENTAL` to `CAPABILITY-CERTIFIED`; the `NOT IN
    LEADERBOARD` and `NOT CERTIFIED` (general-model-cert) chips
    are preserved unchanged. Capability certification remains
    architecturally separate from general model certification.
- ❌ Do not change `MODEL_CERTIFICATION.models[].tier` for any model.
- ❌ Do not add capability badges to the UI's general-model surface
  (roadmap phase J).
- ❌ Do not build the judge-assisted rubric for Roleplay subjective
  quality (roadmap phase F).
- ❌ Do not change `TAB_CONFIG.vision.scoreFamilies` or
  `TAB_CONFIG.roleplay.scoreFamilies` from `[]`.

The roadmap (`docs/CAPABILITY_CERTIFICATION_ROADMAP.md`) breaks
all of the above into discrete future phases A–K with explicit
acceptance criteria.
