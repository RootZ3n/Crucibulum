# Crucible — Vision Phase 15 / Roadmap E candidate inventory

| Field | Value |
|---|---|
| Phase | 15 / Roadmap E — independent-route validation for the expanded 15-test Vision suite |
| Doctrine target | `vision.capability-certified.independent-routes` (`minIndependentRoutes: 3`) |
| Affects leaderboard | **No** (Vision stays excluded) |
| Affects certification | **No** (no model/capability promotion) |

## Doctrine recap

`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md` requires
`independentRoutesTested ≥ 3` for Vision `CAPABILITY_CERTIFIED`.
Independent means **distinct model/provider families** —
`Mimo`, `GPT-5`, `DeepSeek`, `Anthropic`, etc. Two MiMo variants
(`mimo-v2.5`, `mimo-v2-omni`) **count as one family** because
they share Xiaomi's MiMo architecture.

## Currently-registered Vision-capable routes (pre-Phase-15)

| Provider | Model | Family | supportsVision | Transport | 15-test stability evidence? | Independent family |
|---|---|---|:--:|---|---|---|
| `openrouter` | `xiaomi/mimo-v2.5` | MiMo | ✓ | `openai_image_url` | ✅ Phase 14 (45/45 cells) | family A: **MiMo** |
| `openrouter` | `xiaomi/mimo-v2-omni` | MiMo | ✓ | `openai_image_url` | ❌ only 5-test (Phase 12) | family A: **MiMo** (same as v2.5) |
| `openai` | `gpt-5.4-mini` | GPT-5 | ✓ | `openai_image_url` | ❌ only 5-test (Phase 12, 12/15 cells with recurring MODEL fail on object-count) | family B: **GPT-5** |

So **before Phase 15** the independent-family-with-15-test-evidence
count is **1** (just MiMo via v2.5). The other two registered Vision
routes carry only 5-test evidence.

## Candidate routes for Phase 15

### Selected — route 2: `openai / gpt-5.4-mini` (15-test refresh)

- Already registered with vision capability flags.
- Phase 12 stability evidence existed on the 5-test profile (12/15
  cells, with one RECURRING_FAIL MODEL on `vision-object-count-001`).
- Refreshing on the 15-test suite will clear the
  `vision.capability-certified.suite-size` blocker for this route
  and lift the independent-family count from 1 → **2** (MiMo +
  GPT-5).
- Adapter transport (`openai_image_url`) already proven on this
  model across Phases 9 / 10 / 12.
- Estimated cost: ~$0.003 (45 cells at $0.0001/cell from prior
  evidence). Well under the per-route $3 cap.

**Selected** for the smoke + stability run.

### Selected — route 3: `anthropic/claude-haiku-4-5` via OpenRouter

- Independent model family (Anthropic Claude — not MiMo, not GPT).
- OpenRouter routes Anthropic Claude with `image_url` content
  parts, so the existing `openai_image_url` transport in the
  openrouter adapter should work end-to-end.
- Not yet in `MODEL_CERTIFICATION.models[]`; Phase 15 will add a
  provisional entry (mirroring the Phase 13-A pattern for v2.5:
  vision flags + a note explaining the operational enablement is
  Vision-scope only).
- Estimated cost: medium. Claude Haiku is the cheapest vision-
  capable Claude; smoke 15 cells likely $0.05-$0.15, stability 45
  cells likely $0.15-$0.50. Set a $1.50 cap per call to stay safe.
- Selection rationale: clearest path to a 3rd independent family
  with already-configured env (`ANTHROPIC_API_KEY` exists locally,
  but the `openrouter` route does not require it — OpenRouter
  proxies the call), no new adapter work.

**Selected** for the smoke run. If smoke succeeds, run stability;
if smoke fails on transport / provider, **document as blocked**
(per Phase 15 rules: "Do not invent route capability") and report
the independent-family count at 2/3 rather than 3/3.

### Considered but not selected this phase

- `openrouter / google/gemini-3.5-flash`: appeared in legacy
  `runs/` files (May 14 era). Image-capable on OpenRouter. Reserved
  as a fallback if claude-haiku-4-5 smoke fails — would add a
  Google family (independent from MiMo / GPT-5 / Anthropic).
- `openrouter / xiaomi/mimo-v2-omni`: same family as v2.5; doctrine
  does NOT permit it as an independent family slot. Excluded.
- `modelstudio / qwen-vl-*` (`qwen_image_url`): not currently
  configured beyond a scaffold; rejected for this phase to avoid
  adapter-work scope creep.
- `ollama / qwen3-vl:4b` (`local_url`): local-only; cannot serve
  as a Phase-15 independent route for parity with the cloud-route
  doctrine evidence.
- `minimax`, `zai`: declared `supports:false` in
  `MODEL_CERTIFICATION.adapterImageTransport`. Excluded.

## Cost ceiling discipline

Phase 15 budget is $10 (per the user-supplied rules). Worst-case
plan:

| Item | Cap | Realistic spend (from prior phases or estimates) |
|---|---:|---:|
| gpt-5.4-mini smoke (15 cells) | $3.00 | ~$0.001 |
| gpt-5.4-mini stability (45 cells) | $3.00 | ~$0.003 |
| claude-haiku-4-5 smoke (15 cells) | $1.50 | est ~$0.10-0.20 |
| claude-haiku-4-5 stability (45 cells) | $1.50 | est ~$0.30-0.60 |
| **Realistic total** | $9.00 | est < $1.00 |

If any single smoke trip exceeds expectation by >5×, stop and
re-plan with a smaller route.
