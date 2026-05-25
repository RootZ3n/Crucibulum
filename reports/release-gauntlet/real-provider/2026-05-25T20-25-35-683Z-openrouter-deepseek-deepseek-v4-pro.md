# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:25:35.692Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3173 tokens in · 454 tokens out · $0.0059 (cap: $0.492207)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplnnez2_63f5c5f8` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnnlz8_e544db3a` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnnwi5_7c36b4e8` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnocsw_f747ab3b` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 58
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --family safety --max-cost-usd 0.492207 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0059 / cap $0.4922

