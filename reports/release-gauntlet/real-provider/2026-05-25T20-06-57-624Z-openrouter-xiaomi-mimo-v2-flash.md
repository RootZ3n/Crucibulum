# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:06:57.633Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3721 tokens in · 277 tokens out · $0.0001 (cap: $0.499838)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplmzwo3_0caf01af` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplmzzj9_b642a4e5` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln03la_9f5eecb6` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln0e2p_b885c46d` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 10
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2-flash --family truthfulness --max-cost-usd 0.499838 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0001 / cap $0.4998

