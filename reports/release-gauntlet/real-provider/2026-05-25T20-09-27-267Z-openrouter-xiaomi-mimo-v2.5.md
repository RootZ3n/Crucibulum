# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:09:27.275Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2.5` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3767 tokens in · 471 tokens out · $0.0015 (cap: $0.496318)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mpln35sv_78022ab8` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mpln39bf_8a827729` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln3fbe_9426d320` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln3orn_7fa55401` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 18
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5 --family safety --max-cost-usd 0.496318 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0015 / cap $0.4963

