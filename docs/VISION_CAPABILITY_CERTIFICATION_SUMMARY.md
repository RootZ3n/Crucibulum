# Luak — Vision Capability-Certified (operator audit summary)

| Field | Value |
|---|---|
| Capability | Vision |
| Status | **CAPABILITY-CERTIFIED** (promoted 2026-05-27 10:28:36 UTC by Jeff Miller) |
| Receipt | `reports/capability-promotions/vision/2026-05-27T10-28-36Z.{json,md}` |
| Doctrine source | `docs/CAPABILITY_CERTIFICATION_DOCTRINE.md` |
| Affects leaderboard | **No** |
| Affects general model certification | **No** |
| Reading audience | future operators · portfolio reviewers · beta testers |

This document is the short, plain-English version of how Luak
arrived at `Vision: CAPABILITY-CERTIFIED` and exactly what that
badge does and does not mean. The long-form evidence trail lives
under `reports/capability-expansion/vision-*` and
`reports/capability-promotions/vision/`.

## 1. What "Vision Capability-Certified" means

Luak's doctrine
(`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`) defines a
capability-specific certification tier that is **independent of**
the general model leaderboard and the general model-certification
registry. Vision reaching `CAPABILITY_CERTIFIED` means:

- **The Vision test suite is large enough.** Luak's Vision
  suite is **15 tests** covering the doctrine's 10 required
  categories (OCR, object count, chart reading, UI screenshot
  reasoning, uncertainty honesty, spatial reasoning, small / noisy
  text, visual contradiction, multi-object comparison, hallucination
  resistance).
- **Multiple independent model families have passed at scale.**
  Three independent model/provider families ran 3-repeat
  stability profiles on the full 15-test suite, with aggregate
  per-route pass rate ≥ 80% and no recurring
  scorer/fixture/provider/config attribution. The doctrine
  requires 3; Luak has 3.
- **Promotion happened through an operator-explicit,
  doctrine-gated write path.** The promotion endpoint refused to
  write until the doctrine evaluator confirmed every gate was
  clear; the operator typed the explicit confirmation phrase
  `PROMOTE_VISION_CAPABILITY_CERTIFIED` and signed the receipt.
- **Every artifact carries non-negotiable literal-`false`
  doctrine flags.** `affectsLeaderboard:false`,
  `affectsCertification:false`, `promoted:true` (on the receipt)
  /`false` (on the dry-run evaluator), `noMutationGuarantee` for
  the GET endpoint.

In short: **Luak has rigorous, reproducible, multi-family
evidence that the Vision evaluation pipeline works correctly and
that real models pass it.**

## 2. What it does **not** mean

This is the part that matters most for honest communication. The
Vision capability badge is **narrow on purpose**:

- ❌ **Not general model certification.** A specific model
  (e.g. `gpt-5.4-mini`) is **not** elevated to general
  RELEASE_CERTIFIED by Vision certification. That model's main-
  suite tier in `MODEL_CERTIFICATION.models[]` is unchanged
  (Vision-only routes stay at `EXPERIMENTAL` or `PROVIDER_TESTED`
  as set by the prior main-suite campaign).
  `reports/model-certification/certified-models.json` is
  byte-identical (sha256 unchanged since the 2026-05-25
  main-suite campaign).
- ❌ **Not leaderboard inclusion.** Vision scores do not
  contribute to the leaderboard composite.
  `TAB_CONFIG.vision.scoreFamilies = []` and stays that way.
  Vision is rendered as its own tab with its own permanent
  `NOT IN LEADERBOARD` chip.
- ❌ **Not a universal claim that every model is
  Vision-certified.** The badge attests that the **capability
  itself** has been proven on three model families across a
  15-test deterministic suite. A model NOT tested under that
  suite has NOT earned this evidence. Operators evaluating a
  new model should rerun the smoke + stability before claiming
  Vision support.
- ❌ **Not a guarantee providers will never regress.** Provider
  changes (pricing, model swaps, capability changes) can
  invalidate evidence. The endpoint exposes
  `promotionState.currentEvidenceStillEligible` so the UI can
  surface drift; the doctrine never auto-revokes a promotion,
  but operators are expected to revalidate periodically.
- ❌ **Not portable to other capabilities.** Roleplay,
  tool-calling, agent loops etc. each have their own doctrine
  tracks and their own evidence requirements. Vision being
  CAPABILITY_CERTIFIED says nothing about them.

## 3. Evidence summary

The promotion was backed by Phase 14 (suite expansion to 15
tests) + Phase 15 (independent-family validation). Receipt-time
evidence:

| Family | Route | Smoke (15 cells) | Stability (45 cells) | Recurring attribution |
|---|---|---:|---:|---|
| **MiMo** | `openrouter / xiaomi/mimo-v2.5` | 15/15 PASS @ $0.0006 | **45/45 STABLE_PASS** @ $0.0011 | none |
| **GPT-5** | `openai / gpt-5.4-mini` | 14/15 PASS @ $0.0007 | 14/15 STABLE_PASS · 1 RECURRING_FAIL **MODEL** on `vision-object-count-001` (42/45 cells) @ $0.0021 | MODEL (doctrine-allowed performance signal — model genuinely miscounts 7 dots as 6) |
| **Anthropic** | `openrouter / anthropic/claude-haiku-4-5` | 15/15 PASS @ $0.0054 | **45/45 STABLE_PASS** @ $0.0163 | none |

- Aggregate per-route pass rate ≥ 80% — gate clears.
- Three independent model families — gate clears.
- Only recurring attribution is **MODEL** (gpt-5.4-mini's
  object-count weakness); MODEL is doctrine-allowed because it
  is honest model failure rather than measurement instability.
  CONFIG / PROVIDER / FIXTURE / SCORER (the disallowed set)
  appear zero times across all 135 cells.

Combined Phase 14 + Phase 15 live spend: **$0.0262**. Suite
expansion + cross-family validation cost roughly the price of a
single OpenRouter API ping.

Receipt: `reports/capability-promotions/vision/2026-05-27T10-28-36Z.{json,md}`.

## 4. Promotion path (how the badge was earned)

1. **Roadmap Phase A — Doctrine.** The doctrine
   (`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`) defined the
   gates: suite size, repeat runs, pass rate, independent
   routes, disallowed recurring attributions. Compile-time
   literal-`false` types on `affectsLeaderboard` /
   `affectsCertification` made it structurally impossible for
   the capability tier to bleed into the general tier.
2. **Roadmap Phase B — Stability runner.**
   `scripts/vision-stability.mjs` produces N-repeat profiles
   with a deterministic 10-label classifier.
3. **Phase 12 — Uncertainty scorer calibration.** Marker-based
   `uncertainty_honesty` scorer prioritises honesty over
   concision; the `max_chars` cap became a style warning, not a
   hard fail. Phase B mimo evidence drove this fix.
4. **Roadmap Phase C / Phase 14 — Suite expansion 5 → 15.** 10
   new deterministic synthetic fixtures + manifests + test-
   validity cards. New `absence_honesty` scorer for
   hallucination resistance.
5. **Roadmap Phase D / Phase 13-C — Read-only evaluator.**
   `GET /api/capabilities/vision/promotion-evaluation` returns
   per-route + aggregate dry-run decisions without mutating
   anything.
6. **Roadmap Phase E / Phase 15 — Independent-route validation.**
   Three families validated: MiMo + GPT-5 + Anthropic.
7. **Phase 16 — Explicit write phase.**
   `POST /api/capabilities/vision/promote` requires
   `PROMOTE_VISION_CAPABILITY_CERTIFIED` confirmation and
   refuses unless the dry-run aggregate is eligible. Writes
   only `data/capability-certifications.json` + an immutable
   receipt under `reports/capability-promotions/vision/`.
8. **Phase 16-B — Operator-initiated promotion + restart
   hygiene.** Operator (Jeff Miller) ran the POST manually with
   a signed operator note. New `scripts/crux-restart.sh`
   verifies pid + uptime change before printing "restarted".

State file: `data/capability-certifications.json` (operator-
written, gitignored — the receipt is the committed audit
trail).

## 5. Exclusion guarantees

The promotion is structurally isolated from general model
certification and from the leaderboard composite. Concrete proofs:

- **`reports/model-certification/certified-models.json`** —
  sha256 `7c88e1b5da0e9edf1d1d726a37a3b7ed432dc9101aeddb06583e91df38a6a172`,
  unchanged since the 2026-05-25 main-suite certification
  campaign (commit `9481ee5`). The Phase 16 receipt records this
  hash as both `certifiedModelsJsonSha256Before` and `…After`.
- **`MODEL_CERTIFICATION.models[].tier`** — unchanged for every
  Vision-tested route:
  - `openrouter / xiaomi/mimo-v2.5` → `PROVIDER_TESTED` (main-suite)
  - `openrouter / xiaomi/mimo-v2-omni` → `PROVIDER_TESTED` (main-suite)
  - `openai / gpt-5.4-mini` → `EXPERIMENTAL` (main-suite)
  - `openrouter / anthropic/claude-haiku-4-5` → `EXPERIMENTAL` (main-suite)
- **`TAB_CONFIG.vision.scoreFamilies`** — `[]`. Vision is
  rendered as its own tab and its scores never enter the
  leaderboard composite.
- **Permanent UI chips** — Vision panel keeps `NOT IN
  LEADERBOARD` and `NOT CERTIFIED` (general-model-cert) chips
  even while showing `CAPABILITY-CERTIFIED`.
- **`affectsLeaderboard:false` + `affectsCertification:false`**
  on every artifact: GET response top-level + per-route +
  aggregate + promotion-state; POST success response; state
  file per-capability entry; receipt JSON + Markdown.

## 6. How to verify

These commands work today against the running server on
`127.0.0.1:18795` (after `npm run serve` or `crux-restart`).

```bash
# Full promotion-evaluation response.
curl -s http://127.0.0.1:18795/api/capabilities/vision/promotion-evaluation \
  | jq '{ promoted, currentTier, experimental, promotionRequiresFutureWritePhase,
          affectsLeaderboard, affectsCertification,
          promotionState: {
            tier: .promotionState.tier,
            promotedBy: .promotionState.promotedBy,
            promotedAt: .promotionState.promotedAt,
            currentEvidenceStillEligible: .promotionState.currentEvidenceStillEligible,
            affectsLeaderboard: .promotionState.affectsLeaderboard,
            affectsCertification: .promotionState.affectsCertification
          },
          aggregate: {
            count: .aggregateCapabilityCertified.independentFamilyCount,
            target: .aggregateCapabilityCertified.independentFamilyTarget,
            families: .aggregateCapabilityCertified.independentFamiliesQualifying,
            eligible: .aggregateCapabilityCertified.decision.eligible
          } }'

# Expected (post-promotion, current evidence):
#   promoted: true
#   currentTier: "CAPABILITY_CERTIFIED"
#   experimental: false
#   promotionRequiresFutureWritePhase: false
#   affectsLeaderboard: false
#   affectsCertification: false
#   promotionState.currentEvidenceStillEligible: true
#   aggregate.count / target: 3 / 3
#   aggregate.eligible: true
```

```bash
# Full deterministic test suite — should be 1517/1517 pass.
npm test
```

```bash
# Inventory shape — should be 23 families / 87 tasks / 62 conversational.
node scripts/release-gauntlet.mjs --dry-run-inventory \
  | grep -E "families|tasks total|conversational:"
```

```bash
# Exclusion proofs.
sha256sum reports/model-certification/certified-models.json
#   → 7c88e1b5da0e9edf1d1d726a37a3b7ed432dc9101aeddb06583e91df38a6a172
git log -1 --format='%H %s' -- reports/model-certification/certified-models.json
#   → 9481ee57… expand luak model certification registry  (pre-Phase-16, unchanged)

grep -n "vision:{key:'vision'" ui/index.html | grep "scoreFamilies:\[\]"
#   → confirms scoreFamilies=[]
```

## 7. How to revalidate later

If a provider regresses, a model is swapped, or it's just been a
while, rerun the suite. The doctrine never auto-revokes a
promotion, but `promotionState.currentEvidenceStillEligible` will
flip `false` if the aggregate dry-run no longer clears the gates,
and the UI surfaces that as a drift badge.

```bash
# Refresh preferred route's 15-test stability profile (cheapest).
node scripts/vision-stability.mjs \
  --provider openrouter --model xiaomi/mimo-v2.5 \
  --runs 3 --max-cost-usd 2.00 --write-report

# Refresh the two other family routes when warranted.
node scripts/vision-stability.mjs \
  --provider openai --model gpt-5.4-mini \
  --runs 3 --max-cost-usd 3.00 --write-report

node scripts/vision-stability.mjs \
  --provider openrouter --model anthropic/claude-haiku-4-5 \
  --runs 3 --max-cost-usd 1.50 --write-report

# Then check the aggregate at the live endpoint:
curl -s http://127.0.0.1:18795/api/capabilities/vision/promotion-evaluation \
  | jq '.aggregateCapabilityCertified.decision.eligible,
        .promotionState.currentEvidenceStillEligible'
```

If `currentEvidenceStillEligible` flips to `false`, investigate
the per-route `evidenceSummary.recurringAttributions` — any
`CONFIG`, `PROVIDER`, `FIXTURE`, or `SCORER` recurrence at the
aggregate level means the doctrine is unhappy. Revoke and
re-promote only after the underlying issue is fixed and a fresh
stability profile shows the recurrence cleared.

To formally revoke, edit `data/capability-certifications.json`
to remove the `vision` entry (or set `promoted:false` and adjust
`tier`). A revocation receipt path is intentionally not built
into the system yet — the doctrine deferred it as a manual
operator action until there is real demand. Any future
re-promotion goes through the same explicit POST + confirmation
flow.

## 8. Known limitations

- **Synthetic fixtures.** All 15 Vision tests use deterministic
  synthetic PNGs rendered by `scripts/generate-vision-fixtures.py`.
  This guarantees reproducibility and avoids copyright/PII risk,
  but it is by definition a narrower slice of real-world image
  diversity than (e.g.) a held-out test set drawn from real
  photographs. Operators evaluating Vision for production should
  add their own domain-specific evidence on top of this baseline.
- **Provider drift is possible at any time.** Luak's
  evidence is a snapshot of model behaviour at the time of the
  stability runs (May 26–27, 2026). Providers can change pricing,
  swap underlying models, or change image-input behaviour without
  notice. Rerun the smoke + stability if anything in the
  ecosystem changes; `promotionState.currentEvidenceStillEligible`
  is the operator's drift signal.
- **Capability certification is evidence-backed, not universal
  truth.** The badge attests that Luak's specific 15-test
  suite ran cleanly across three families. It does NOT prove
  that any Vision-capable model is universally correct, that
  every Vision-related failure mode is caught, or that the
  models' Vision behaviour is safe in adversarial settings (the
  hallucination-resistance test catches *one* shape of
  hallucination — naming an absent object — but does not
  exhaust the space).
- **Local state file is gitignored and operator-owned.** A fresh
  checkout has no `data/capability-certifications.json` and
  therefore reads as `promoted:false` /
  `currentTier:"EXPERIMENTAL"`. Operators who want to share the
  promotion state across environments must either re-run the
  POST in each environment (recommended) or copy the state file
  + receipt out of band. The committed receipt under
  `reports/capability-promotions/vision/` is the canonical
  evidence; the local state file is the rendering hint.
- **Vision is the only currently-certified capability.** Other
  capabilities (Roleplay, tool-calling, etc.) have their own
  doctrine tracks and are explicitly still EXPERIMENTAL until
  they reach the same level of independent-family evidence.
- **No external auth.** Luak has no built-in authentication;
  the `POST /api/capabilities/vision/promote` endpoint is only
  as safe as the network around the bound port (default
  `127.0.0.1:18795`). Operators exposing Luak beyond
  loopback must add their own access control.

## 9. Audit trail (for portfolio review)

| Commit | What landed |
|---|---|
| `2963628` | Phase A · capability certification doctrine (gates + types + 12 tests) |
| `d6b2839` | Phase B · Vision stability runner |
| `7a56d10` | Phase 12 · uncertainty scorer calibration |
| `8268488` | Phase 13-A · MiMo-V2.5 evaluated as replacement candidate |
| `a7bdb51` | Phase 13-B · v2.5 preferred daily-driver candidate |
| `626353c` | Phase 13-C / Roadmap D · read-only promotion evaluator endpoint |
| `3ceb5d5` | Phase 14 / Roadmap C · suite expansion 5 → 15 tests |
| `2a9fb7d` | scoring-integrity audit · context-degradation-001 score 43 explained |
| `e190d47` | Phase 15 / Roadmap E · three independent families validated |
| `d8657d1` | Phase 16 · doctrine-aware promotion write phase |
| `ee01fe7` | operator-committed promotion receipt (Vision now `CAPABILITY_CERTIFIED`) |
| `9f924a7` | Phase 16-B · post-promotion verification + crux-restart hygiene fix |
| `(this commit)` | Phase 17 · this audit summary |

Each commit has a corresponding report under
`reports/capability-expansion/` or
`reports/capability-promotions/` with the full evidence,
test list, and command transcripts.

## 10. Contact / extension

To add a new capability (Roleplay, tools, agent loops, etc.) to
the same certification track:

1. Define gates in `core/capability-certification.ts` and the
   doctrine doc.
2. Build a stability runner that emits per-test attribution.
3. Expand the test suite to satisfy the doctrine's
   `minSuiteSize`.
4. Validate across `minIndependentRoutes` independent model
   families.
5. Add a `POST /api/capabilities/<cap>/promote` endpoint with
   the same confirmation-phrase + aggregate-eligibility checks
   the Vision write phase uses.
6. Receipt under `reports/capability-promotions/<cap>/<ts>.{json,md}`.

The Vision implementation in `server/routes/capabilities-vision.ts`
+ `core/capability-promotion-state.ts` is the reference shape.
Doctrine constants in `core/capability-certification.ts`. UI
conditional rendering pattern in `ui/index.html`
(`renderVisionLanePanel` + the `chip teal hot` /
`chip amber hot` swap on `promoData.promoted===true`).
