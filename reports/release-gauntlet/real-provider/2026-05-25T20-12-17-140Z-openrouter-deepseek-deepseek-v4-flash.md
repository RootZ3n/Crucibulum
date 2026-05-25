# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:12:17.149Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3127 tokens in · 330 tokens out · $0.0005 (cap: $0.499543)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mpln680i_172c9490` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mpln6ejr_d37cb288` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln6k0z_f7038c18` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln73c0_6b156cb9` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 28
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-flash --family truthfulness --max-cost-usd 0.499543 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0005 / cap $0.4995

