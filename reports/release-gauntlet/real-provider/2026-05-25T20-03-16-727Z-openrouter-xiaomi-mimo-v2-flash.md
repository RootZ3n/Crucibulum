# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:03:16.736Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** FAIL_PROVIDER: 1 · PASS: 3

**Totals:** 4 distinct run_ids · 3 distinct bundle_ids · 3310 tokens in · 269 tokens out · $0.0001 (cap: $0.499766)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | 🟡 FAIL_PROVIDER | error | `run_mplmvaw1_d961a68a` | provider_error.kind=NETWORK stage=health_check reason="Network request failed — fetch failed" |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplmvaxe_7a3c0833` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplmveza_0b4f5ce0` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplmvr5i_036a54b3` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 4
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2-flash --family truthfulness --max-cost-usd 0.499766 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0001 / cap $0.4998

