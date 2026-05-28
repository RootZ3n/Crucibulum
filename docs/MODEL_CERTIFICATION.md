# Model Certification

Luak's leaderboard is only as honest as its claims about which
model is **really** ready for which kind of use. This document defines
the certification tiers, how to earn (and re-earn) each one, and how
the UI surfaces them.

## Tiers

The registry lives at `reports/model-certification/certified-models.json`
and is updated by `scripts/model-certify.mjs`. Five tiers (worst → best):

| Tier | Meaning | UI label |
| --- | --- | --- |
| `EXPERIMENTAL` | Visible in the picker but unproven, or recently failed at least one tier check. Operator may explore; warnings remain harsh. | Uncertified visible / experimental |
| `BLOCKED_CONFIG` | Provider/model cannot be tested due to missing credentials, missing local pull, or model-access denial. Fix config before re-running. | Blocked config |
| `UNSUPPORTED_CAPABILITY` | Model does not support the requested test type (text-only model on a tool/vision task). | Unsupported capability |
| `PROVIDER_TESTED` | Passed the minimum provider-tested profile (personality + truthfulness + safety). Confidence-of-use OK but **not** approved for release-scope claims. | Provider-tested |
| `RELEASE_CERTIFIED` | Passed the full release-certified profile (personality + truthfulness + safety + operational-trust + role-stress, optional tool-calling / orchestration). Approved for release-scoped claims. | Certified release target |

## Profiles

A "profile" is the family list a model must pass to earn that tier.

### `provider-tested`
- `personality`
- `truthfulness`
- `safety`

### `release-certified`
- `personality`
- `truthfulness`
- `safety`
- `operational-trust`
- `role-stress`
- `tool-calling` (optional via `--include-tools`)
- `orchestration` (optional via `--include-repo`)

## What invalidates certification

A model's tier is recalculated every time `scripts/model-certify.mjs`
runs against it. The wrapper does not silently downgrade on a
transient retest (only `EXPERIMENTAL`, `BLOCKED_CONFIG`, and
`UNSUPPORTED_CAPABILITY` overwrite a higher previously-earned tier).
However the following always invalidate:

- **`FAIL_PRODUCT`** — model gave a genuinely wrong answer. Tier drops
  to `EXPERIMENTAL` immediately.
- **`FAIL_MODEL_CAPABILITY`** — model refused the family shape. Tier
  becomes `UNSUPPORTED_CAPABILITY`.
- **`FAIL_CONFIG`** — provider/model isn't configured. Tier becomes
  `BLOCKED_CONFIG`.
- **`FAIL_PROVIDER`** — transient infra failure. Tier is capped at
  `PROVIDER_TESTED` even on a `release-certified` profile run (a
  provider can't be a release-certified target while it's flapping).
- **Code changes that affect scoring, adapters, or evidence** — re-run
  the relevant profile after a release.

## Cost controls

- **Local (Ollama)** providers have no cost; the wrapper rejects
  `--max-cost-usd 0` only for non-`ollama` providers.
- **Cloud providers** (OpenRouter, Anthropic, OpenAI, MiniMax,
  ModelStudio, ZAI) require `--max-cost-usd` on every invocation.
  Recommended caps:
  - Provider-tested probe: $0.50
  - Release-certified probe: $1.00
- The wrapper checks `totalCostUsd` after each family and skips the
  remaining families with classification `BLOCKED_COST_CAP` if the cap
  has been reached.

## How to certify a new model

```bash
# Inventory check first — see what's already registered.
node scripts/model-certify.mjs --inventory

# Fast smoke (provider-tested tier) on a cloud model with $0.50 cap.
node scripts/model-certify.mjs \
  --provider openrouter \
  --model deepseek/deepseek-v4-flash \
  --profile provider-tested \
  --max-cost-usd 0.50 \
  --write-report

# Full release-certified profile on a local model.
node scripts/model-certify.mjs \
  --provider ollama \
  --model qwen3.5:9b \
  --profile release-certified \
  --write-report

# Batch from a file of "provider model" lines.
node scripts/model-certify.mjs \
  --from-file reports/model-certification/operator-model-list.txt \
  --profile provider-tested \
  --max-cost-usd 0.50 \
  --write-report
```

Every run with `--write-report`:

1. Writes `reports/model-certification/<provider>/<model-slug>/<ts>.{json,md}`.
2. Updates `reports/model-certification/latest.{json,md}` to point at
   the most recent run.
3. Inserts or updates the model's entry in `certified-models.json`
   (with `commit`, `dirtyTree`, evidence path, tier, total cost).

## How to recertify after code changes

If a release ships changes to:

- adapter code under `adapters/`
- scoring code under `core/` / `scorers/`
- task definitions under `tasks/`
- evidence/bundle hydration

…then every release-certified model should be re-run on the
`release-certified` profile. The wrapper will preserve tier if the
re-run passes; demotes to `EXPERIMENTAL` if it doesn't.

```bash
for model in $(jq -r '.models[] | select(.tier=="RELEASE_CERTIFIED") | "\(.provider) \(.modelId)"' reports/model-certification/certified-models.json); do
  node scripts/model-certify.mjs --provider ${model%% *} --model ${model##* } --profile release-certified --max-cost-usd 1.00 --write-report
done
```

## How often to refresh

- **Release-certified**: at minimum before every release, plus weekly
  smoke. The cost is small ($0.02-$0.10 per model).
- **Provider-tested**: monthly is fine for cloud, weekly for local.
- **Experimental**: not on a schedule; the operator promotes when ready.

## UI consequences

The picker and Provider Bay surface tier labels:

- `RELEASE_CERTIFIED` → `Certified release target` (teal/cyan)
- `PROVIDER_TESTED` → `Provider-tested` (cyan)
- `EXPERIMENTAL` → `Uncertified visible / experimental` (amber)
- `BLOCKED_CONFIG` → `Blocked config` (red)
- `UNSUPPORTED_CAPABILITY` → `Unsupported capability` (dim)

The release-certification banner buckets the operator's selection by
tier, so they see "3 release-certified · 4 provider-tested · 2
experimental selected" instead of a single binary "certified /
uncertified" split. The harsh "Uncertified target" warning is reserved
for truly experimental models — provider-tested models get a softer
"confidence-of-use OK" note.
