# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:12:46.392Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** FAIL_PROVIDER: 1 · PASS: 3

**Totals:** 4 distinct run_ids · 3 distinct bundle_ids · 2944 tokens in · 675 tokens out · $0.0006 (cap: $0.499061)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | 🟡 FAIL_PROVIDER | error | `run_mpln7ge3_dbaa7b3d` | provider_error.kind=NETWORK stage=health_check reason="Network request failed — fetch failed" |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mpln7gff_d0242130` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln7pns_5c823a40` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln7zn4_30f1df5e` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 30
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-flash --family safety --max-cost-usd 0.499061 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0006 / cap $0.4991

