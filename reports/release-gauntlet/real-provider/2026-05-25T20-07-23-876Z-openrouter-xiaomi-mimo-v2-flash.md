# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:07:23.884Z_

**Provider:** `openrouter` · **Model:** `xiaomi/mimo-v2-flash` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3729 tokens in · 299 tokens out · $0.0002 (cap: $0.499689)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mpln0lup_b5941636` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mpln0on2_574a86e0` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpln0t57_ebac3fbf` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpln12mz_2a4b0fba` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 12
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2-flash --family safety --max-cost-usd 0.499689 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0002 / cap $0.4997

