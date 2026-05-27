# Crucible — Portfolio / Demo Walkthrough

A 5–10 minute walkthrough for a portfolio reviewer, hiring
manager, or beta tester. The structure scales: start with the
30-second pitch, drop into the 5-minute path for a typical
interview, expand to 10 minutes for a deeper technical review.

## 30-second summary

Crucible is an evaluation harness that **refuses to overclaim**.
It runs model trials, scores them deterministically, and writes
**immutable evidence receipts** that anyone can re-verify. Its
most recently-shipped piece is a **doctrine-gated capability
promotion path**: Vision is now formally `CAPABILITY-CERTIFIED`
based on 15 tests run across three independent model families
(MiMo, GPT-5, Anthropic), and the promotion is structurally
separated from the leaderboard and from general model
certification. If you read the receipt under
`reports/capability-promotions/vision/`, you can rederive every
claim the badge makes from the underlying evidence.

## The core trust problem Crucible solves

Most evaluation tools fail one of these tests:

- **Overclaim by silence.** "Vision works" is invisibly different
  from "we tested vision on three models and saw 100% on test
  fixtures we wrote ourselves." The first sounds general; the
  second is what we actually have. Crucible always shows the
  second.
- **Leaderboards that hide weak evidence.** A single-shot smoke
  on one model can produce a number that gets averaged into a
  leaderboard. Crucible quarantines untrusted bundles by default
  and ships a doctrine that defines what evidence justifies what
  claim.
- **"Certified" drift.** The word "certified" gets reused for
  product-marketing claims, regulatory claims, and benchmark
  claims, and operators can't tell which is which. Crucible
  scopes "certified" precisely (release-certified, capability-
  certified, provider-tested) and the UI chips spell out what
  each one does and does not mean.
- **Provider drift.** Model behavior moves silently — pricing,
  capability flags, even the model weights behind a name. Crucible
  surfaces evidence drift (`currentEvidenceStillEligible`) without
  auto-revoking, so the operator decides what to do.

The Vision Capability-Certified track is the worked example: it
is the first capability promoted through the full doctrine, and
its receipt is the audit-trail format every future capability
will use.

## 5-minute demo path

Assumes Crucible is running locally on `127.0.0.1:18795`
(`npm run serve` or the `crux-restart` alias).

### Step 1 (1 min): show that the test suite is green and the
inventory is steady

```bash
npm test
node scripts/release-gauntlet.mjs --dry-run-inventory \
  | grep -E "families|tasks total|conversational"
```

Expected: **1545 / 1545 pass** and **23 families / 87 tasks / 62
conversational**. This is the baseline operators should see
before trusting any claim downstream.

### Step 2 (1 min): inspect the live promotion-evaluator endpoint

```bash
curl -s http://127.0.0.1:18795/api/capabilities/vision/promotion-evaluation \
  | jq '{ promoted, currentTier, experimental,
          promotionRequiresFutureWritePhase,
          affectsLeaderboard, affectsCertification,
          aggregate: {
            count: .aggregateCapabilityCertified.independentFamilyCount,
            target: .aggregateCapabilityCertified.independentFamilyTarget,
            families: .aggregateCapabilityCertified.independentFamiliesQualifying,
            eligible: .aggregateCapabilityCertified.decision.eligible
          },
          state: {
            tier: .promotionState.tier,
            promotedBy: .promotionState.promotedBy,
            currentEvidenceStillEligible: .promotionState.currentEvidenceStillEligible
          } }'
```

Talking points to read off the JSON:

- `promoted: true`, `currentTier: "CAPABILITY_CERTIFIED"`,
  `experimental: false` — Vision is formally promoted.
- `affectsLeaderboard: false`, `affectsCertification: false` —
  capability promotion is structurally isolated.
- `aggregate.count / target: 3 / 3` with three named families
  (`Anthropic`, `GPT-5`, `MiMo`).
- `aggregate.eligible: true` — the doctrine evaluator would
  re-grant this promotion today against the same evidence.
- `state.currentEvidenceStillEligible: true` — no provider
  drift since promotion.

### Step 3 (1 min): open the Vision tab in the UI

In the browser at `http://127.0.0.1:18795/`, click the **Vision**
tab. Talking points:

- Chip row shows **CAPABILITY-CERTIFIED** (teal) instead of
  EXPERIMENTAL — that's the post-promotion render.
- Right next to it: **NOT IN LEADERBOARD** and **NOT CERTIFIED**
  chips remain. Hover them — tooltips spell out exactly what
  each chip means (Vision scores are excluded from the
  leaderboard composite; Vision does not affect general model
  certification).
- Scroll to the **PROMOTION DRY RUN (READ-ONLY)** block. The
  per-route table shows each model family's PROVIDER_TESTED /
  STABLE / CAPABILITY_CERTIFIED dry-run status. Beneath the
  table, the **Aggregate Capability-Certified (cross-route,
  read-only)** sub-block shows `3 / 3 qualifying families` and
  `Promoted: yes (at <timestamp> by <operator>)` with a link to
  the receipt path.

### Step 4 (1 min): show the immutable receipt

```bash
ls reports/capability-promotions/vision/
cat reports/capability-promotions/vision/2026-05-27T10-28-36Z.md | head -30
```

Talking points:

- Receipt records **`certifiedModelsJsonSha256Before` ===
  `certifiedModelsJsonSha256After`** — on-disk proof that the
  promotion write did NOT mutate `certified-models.json`.
- Lists the qualifying families, the qualifying routes, the
  source evidence paths (stability reports), and the operator
  who signed the promotion.
- Receipts are committed to git as audit evidence. They are
  never edited; future re-promotions write NEW receipts.

### Step 5 (1 min): show the open question

```bash
# Show the doctrine itself.
sed -n '120,140p' docs/CAPABILITY_CERTIFICATION_DOCTRINE.md
```

Talking points:

- Every gate threshold is in source: `core/capability-certification.ts`
  with compile-time `literal false` types on the doctrine flags.
- Promotion can never accidentally mutate the leaderboard or
  general model cert at the TYPE LEVEL.
- Roleplay and other capabilities have the same doctrine track
  defined but are not yet promoted — they require the same
  multi-family evidence Vision has.

## 10-minute demo path (deeper technical review)

Everything above, plus:

### Step 6 (2 min): show the doctrine + the evaluator

```bash
# The doctrine gates per capability per tier.
sed -n '30,60p' core/capability-certification.ts

# The pure-function evaluator the GET endpoint calls.
sed -n '149,220p' core/capability-certification.ts

# The write-phase handler (POST /api/capabilities/vision/promote).
sed -n '410,460p' server/routes/capabilities-vision.ts
```

Talking points:

- `VISION_GATES.CAPABILITY_CERTIFIED` requires `minSuiteSize: 15`,
  `minRepeatRuns: 3`, `minStablePassRate: 0.80`,
  `minIndependentRoutes: 3`, and disallows recurring
  `CONFIG/PROVIDER/FIXTURE/SCORER` attributions. Numeric, not
  vibes.
- `evaluatePromotion()` is pure: it returns a
  `CapabilityPromotionDecision` payload; it never mutates
  anything. Both the read-only GET endpoint and the write
  endpoint use it.
- The write handler refuses with `422` unless the aggregate is
  eligible, and refuses with `400` if the confirmation phrase
  is missing or wrong.

### Step 7 (2 min): explain the composite-vs-correctness story

The 2026-05-27 scoring-integrity audit
(`reports/scoring-integrity/context-degradation-001/`) is a good
worked example. Hermes flagged that `context-degradation-001`
reported the score `43` across many model families and argued it
was mathematically impossible.

Open the report:

```bash
sed -n '1,60p' reports/scoring-integrity/context-degradation-001/2026-05-27T01-24-28Z.md
```

Talking points:

- The audit concluded `VALID_HISTORICAL_SCORING_CONTRACT` — 43
  is the legitimate composite, but operators were reading
  `score.total_percent` while expecting
  `score.breakdown_percent.correctness`.
- Crucible's conversational composite formula is
  `round((correctness*0.85 + efficiency*0.15)*100)/100`. For
  1-of-3 PASS at efficiency ≈ 1, that's exactly 0.43.
- Phase 18 relabeled the UI big-number `OVERALL → COMPOSITE`,
  added a breakdown sub-line (`correctness X% · efficiency Y%
  · formula: …`), and added `docs/SCORING_FIELDS.md`.
- A `core/scoring-invariant.ts` module enumerates the legal
  anchor sets per binary manifest and can flag any future
  pipeline bug that produces an actually-impossible score.

The takeaway: Crucible took a false alarm seriously, traced it to
field confusion (not a scoring bug), and added permanent
guard-rails so the next reviewer doesn't get tripped up the same
way.

### Step 8 (1 min): show the README's honest framing

```bash
sed -n '18,35p' README.md
```

Talking points:

- README explicitly says Crucible is NOT a universal model
  benchmark, NOT a safety certification, NOT proof that a model
  is safe, NOT a guarantee of local or cloud isolation.
- The Vision Capability-Certified subsection spells out what
  certification covers vs what it does not.

## UI talking points (memorize these — they go fast)

When the reviewer is looking at the Vision tab:

- **CAPABILITY-CERTIFIED chip (teal)** — "This is a
  capability-specific badge. It says the Vision evaluation
  pipeline works correctly and that real models pass it. It
  does not certify any one model."
- **NOT IN LEADERBOARD chip** — "Vision scores are excluded
  from the leaderboard composite. Hover for the tooltip —
  `TAB_CONFIG.vision.scoreFamilies = []`."
- **NOT CERTIFIED chip** — "This is the general model
  certification status (`certified-models.json` +
  `MODEL_CERTIFICATION.models[].tier`). Capability-certified is
  separate."
- **PROMOTION DRY RUN block** — "This is the read-only doctrine
  evaluator. Per route: PROVIDER_TESTED, STABLE,
  CAPABILITY_CERTIFIED dry-run eligibility. Aggregate sub-block:
  cross-route family count + the doctrine decision."
- **COMPOSITE big number in the focused-run inspector** — "This
  is `score.total_percent`, a blend of correctness and
  efficiency credit. Hover for the formula. The CORRECTNESS
  glyph below shows the raw per-question rollup."

## "What I would say in an interview"

### Short plain-English version (60 seconds)

"Crucible is an evaluation harness that refuses to overclaim.
The newest piece is a capability promotion path that requires
multi-family evidence before a capability badge can flip on.
Vision is the first capability to clear it — 15 tests across
three independent model families, with the promotion gated by a
confirmation phrase and recorded as an immutable receipt that
anyone can re-verify. The promotion is structurally isolated from
the leaderboard and from general model certification at the type
level, so a future edit cannot accidentally bleed capability
claims into release claims."

### Technical version (2 minutes)

"The doctrine
(`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`) defines per-
capability per-tier gates with numeric thresholds. The
`evaluatePromotion()` function in
`core/capability-certification.ts` is pure — it walks every gate
clause and returns a `CapabilityPromotionDecision` payload with
`affectsLeaderboard: false` and `affectsCertification: false` as
literal types. A read-only GET endpoint at
`/api/capabilities/vision/promotion-evaluation` returns per-
route + aggregate decisions; a separate POST endpoint at
`/promote` requires a confirmation phrase
(`PROMOTE_VISION_CAPABILITY_CERTIFIED`) and refuses unless the
aggregate is eligible. The write touches only `data/capability-
certifications.json` (operator-owned, gitignored) and an
immutable receipt under `reports/capability-promotions/`. The
receipt records the certified-models.json sha256 before and
after the write — they must match, and a P14 test asserts this
end-to-end."

### Trust / safety version (90 seconds)

"The hardest problem in evaluation is honesty under pressure.
When you're certifying something, you want to flip the switch.
Crucible designs against that pressure: the promotion endpoint
is a separate route from the read-only evaluator; it requires an
operator to type a confirmation phrase; it writes an immutable
receipt before the state mutation that anyone can audit; and it
preserves a `currentEvidenceStillEligible` flag on the read
endpoint so drift surfaces without auto-revocation. The receipt
records the certified-models.json sha256 before and after the
write as on-disk proof the file was not touched. Plus there's a
scoring-invariant module that catches the converse problem —
impossible scores — by enumerating the legal anchor set per
binary manifest. The Hermes audit of `context-degradation-001`
is a worked example of catching a false alarm, tracing it to
field confusion rather than a bug, and adding permanent
guardrails."

## Known limitations (state these openly)

- **Local-only / no built-in auth.** Crucible binds to
  `127.0.0.1:18795` by default and has no authentication.
  Operators exposing it beyond loopback must add network-layer
  access control (Tailscale, VPN, firewall, reverse-proxy
  auth) per `SECURITY.md`. The `/promote` endpoint will refuse
  without the confirmation phrase, but the broader API surface
  needs network-layer protection.
- **Synthetic Vision fixtures.** All 15 Vision tests use
  deterministic synthetic PNGs rendered by
  `scripts/generate-vision-fixtures.py`. Reproducible and
  copyright-safe, but a narrower slice of real-world image
  diversity than (e.g.) a held-out test set drawn from real
  photographs. Operators evaluating Vision for production should
  add their own domain-specific evidence on top.
- **Provider drift is possible at any time.** Crucible's
  evidence is a snapshot. Providers can change pricing, swap
  underlying models, or change image-input behaviour without
  notice. Rerun the smoke + stability if anything in the
  ecosystem changes; `currentEvidenceStillEligible` is the
  drift signal.
- **Only Vision is currently certified.** Other capabilities
  (Roleplay, tool-calling, etc.) have their own doctrine tracks
  defined but are explicitly still EXPERIMENTAL until they
  reach the same level of multi-family evidence.
- **Local capability state is operator-owned.** A fresh checkout
  has no `data/capability-certifications.json` and therefore
  reads as `promoted: false` / `currentTier: "EXPERIMENTAL"`.
  Operators who want to share promotion state across
  environments must either re-run the POST in each environment
  (recommended) or copy the state file + receipt out of band.
  The committed receipt is the canonical evidence; the local
  state file is the rendering hint.

## Do NOT claim

- ❌ "All models are vision-certified." Capability certification
  attests that the **capability evaluation pipeline** works —
  not that every Vision-capable model is universally certified.
  Only the three specific routes in the receipt have
  Phase-15-level evidence.
- ❌ "The leaderboard includes Vision." It does not.
  `TAB_CONFIG.vision.scoreFamilies = []` and stays that way.
  Vision is its own tab with its own permanent NOT IN
  LEADERBOARD chip.
- ❌ "Crucible is a production SaaS." It is a local
  evaluation harness with no built-in auth. Production hosting
  requires the operator to add their own access control.
- ❌ "Crucible guarantees provider behavior." Providers can
  regress at any time. Crucible surfaces drift; it does not
  prevent it.
- ❌ "Crucible's capability badge is the same as a safety
  certification." It is not. Capability certification is
  evidence-backed but narrowly scoped; safety is a separate
  doctrine track that Crucible explicitly does not claim to
  hold today.

## Audit trail (for a reviewer who wants to dig deeper)

| Phase | Commit | What landed |
|---|---|---|
| A | `2963628` | doctrine + types + 12 doctrine tests |
| B | `d6b2839` | Vision stability runner |
| 12 | `7a56d10` | uncertainty scorer calibration |
| 13-A | `8268488` | MiMo-V2.5 evaluated as replacement candidate |
| 13-B | `a7bdb51` | v2.5 preferred daily-driver candidate |
| 13-C / D | `626353c` | read-only promotion evaluator endpoint |
| 14 / C | `3ceb5d5` | Vision suite expansion 5 → 15 tests |
| (audit) | `2a9fb7d` | scoring-integrity: context-degradation-001 43 explained |
| 15 / E | `e190d47` | 3 independent families validated |
| 16 | `d8657d1` | doctrine-aware write phase |
| (op) | `ee01fe7` | operator-committed promotion receipt — Vision is now CAPABILITY_CERTIFIED |
| 16-B | `9f924a7` | post-promotion verification + crux-restart hygiene |
| 17 | `08332aa` | capability certification audit summary doc |
| 18-B | `965a4f7` | cross-file FS race fixed (test suite deterministic) |
| 18 | `02c2cac` | composite-vs-correctness display clarity |
| 19 | `23e018e` | public/portfolio readiness audit |
| 20 | _(this commit)_ | portfolio/demo walkthrough doc |

Each commit has a corresponding report under
`reports/capability-expansion/`,
`reports/capability-promotions/`,
`reports/scoring-integrity/`, or
`reports/readiness/`. Reports are immutable; future re-evaluations
write new files alongside the old ones.

## Cross-references

- Full audit summary: [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](VISION_CAPABILITY_CERTIFICATION_SUMMARY.md)
- Doctrine: [docs/CAPABILITY_CERTIFICATION_DOCTRINE.md](CAPABILITY_CERTIFICATION_DOCTRINE.md)
- Vision suite design: [docs/MULTIMODAL_VISION_SUITE.md](MULTIMODAL_VISION_SUITE.md)
- Composite vs correctness: [docs/SCORING_FIELDS.md](SCORING_FIELDS.md)
- Readiness audit: [reports/readiness/public-portfolio-readiness/](../reports/readiness/public-portfolio-readiness/)
- Security caveats: [SECURITY.md](../SECURITY.md)
