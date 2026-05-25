# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:08:56.798Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2.5` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3774 tokens in · 526 tokens out · $0.0016 (cap: $0.497958)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mpln2gdq_5957abf2` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mpln2jtw_480c2262` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln2pi5_85c94ce6` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln325u_76233adf` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 16
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5 --family truthfulness --max-cost-usd 0.497958 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0016 / cap $0.4980

