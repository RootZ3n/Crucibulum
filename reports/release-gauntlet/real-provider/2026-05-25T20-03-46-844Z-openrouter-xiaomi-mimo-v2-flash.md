# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:03:46.853Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3755 tokens in · 348 tokens out · $0.0002 (cap: $0.49963)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplmvven_0bfb1598` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplmvxpr_ea1b0544` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplmw2ef_6479e58d` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplmwfyn_fa03e0eb` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 6
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2-flash --family safety --max-cost-usd 0.49963 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0002 / cap $0.4996

