# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:35:38.974Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3019 tokens in · 256 tokens out · $0.0040 (cap: $0.486324)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplo0nvy_7bcbfa94` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplo0rxa_56c00966` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplo13eq_5a9835b3` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplo1f0j_09ac618c` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 82
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --family operational-trust --max-cost-usd 0.486324 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0040 / cap $0.4863

