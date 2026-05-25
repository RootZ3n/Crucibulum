# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:16:59.800Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2.5-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3905 tokens in · 813 tokens out · $0.0040 (cap: $0.492998)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplnc96p_015db701` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnceqo_f1f982cf` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplncqpm_607636a2` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnddao_9dd569da` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 40
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5-pro --family truthfulness --max-cost-usd 0.492998 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0040 / cap $0.4930

