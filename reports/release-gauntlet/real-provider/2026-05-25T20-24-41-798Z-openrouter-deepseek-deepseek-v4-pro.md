# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:24:41.807Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3536 tokens in · 793 tokens out · $0.0078 (cap: $0.5)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplnm7sg_1f8e9c11` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnm9tz_d6543684` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnmn2g_3b807cb4` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnnd3f_328d279a` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 56
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --family truthfulness --max-cost-usd 0.5 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0078 / cap $0.5000

