# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:21:37.940Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2.5-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3990 tokens in · 858 tokens out · $0.0043 (cap: $0.491299)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplni7tu_72dacb9a` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnida1_aad49d48` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnis0w_44546887` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnjcmv_c688221b` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 48
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5-pro --family safety --max-cost-usd 0.491299 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0043 / cap $0.4913

