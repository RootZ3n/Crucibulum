# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:26:19.430Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** FAIL_PROVIDER: 1 · PASS: 3

**Totals:** 4 distinct run_ids · 3 distinct bundle_ids · 2678 tokens in · 207 tokens out · $0.0043 (cap: $0.48628)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | 🟡 FAIL_PROVIDER | error | `run_mplnokjw_ccb0890b` | provider_error.kind=NETWORK stage=health_check reason="Network request failed — fetch failed" |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnokl6_0a53ea89` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnopra_a5de7ba7` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnpbou_75fd539b` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 60
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --family operational-trust --max-cost-usd 0.48628 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0043 / cap $0.4863

