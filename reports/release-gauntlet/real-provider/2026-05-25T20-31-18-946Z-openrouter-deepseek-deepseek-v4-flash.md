# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:31:18.955Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** FAIL_PROVIDER: 1 · PASS: 3

**Totals:** 4 distinct run_ids · 3 distinct bundle_ids · 2750 tokens in · 273 tokens out · $0.0004 (cap: $0.5)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | 🟡 FAIL_PROVIDER | error | `run_mplnv0an_0fb69965` | provider_error.kind=NETWORK stage=health_check reason="Network request failed — fetch failed" |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnv0ck_b03f95e9` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnv93r_aa9ea90f` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnvw1s_a0e0052e` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 70
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-flash --family personality --max-cost-usd 0.5 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0004 / cap $0.5000

