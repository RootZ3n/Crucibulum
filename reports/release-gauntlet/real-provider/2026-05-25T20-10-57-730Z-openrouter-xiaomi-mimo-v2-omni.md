# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:10:57.739Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2-omni` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3805 tokens in · 443 tokens out · $0.0015 (cap: $0.49556)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mpln57e3_d21197e7` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mpln59rv_013d7c5b` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln5es2_7e981790` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln5ozp_e9ee396d` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 24
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2-omni --family safety --max-cost-usd 0.49556 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0015 / cap $0.4956

