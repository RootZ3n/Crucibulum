# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:16:01.090Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2.5-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 4517 tokens in · 1494 tokens out · $0.0070 (cap: $0.5)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplnaazz_5149a66a` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnan9e_b80e3162` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplnb7uz_0d3700ea` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnc3p7_aa494514` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 38
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5-pro --family personality --max-cost-usd 0.5 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0070 / cap $0.5000

