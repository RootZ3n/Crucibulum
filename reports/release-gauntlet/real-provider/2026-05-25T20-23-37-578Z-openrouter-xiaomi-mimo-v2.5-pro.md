# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:23:37.587Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2.5-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 4091 tokens in · 1054 tokens out · $0.0049 (cap: $0.48287599999999997)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplnkhyt_2c8b808f` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnktln_a4efb423` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnla2v_544b975e` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnluq3_119f4606` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 52
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5-pro --family role-stress --max-cost-usd 0.48287599999999997 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0049 / cap $0.4829

