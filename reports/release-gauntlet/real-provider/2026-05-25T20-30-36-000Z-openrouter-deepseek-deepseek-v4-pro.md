# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:30:36.008Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** FAIL_PROVIDER: 1 · PASS: 3

**Totals:** 4 distinct run_ids · 3 distinct bundle_ids · 3063 tokens in · 685 tokens out · $0.0067 (cap: $0.489109)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | 🟡 FAIL_PROVIDER | error | `run_mplnthgy_e1454de2` | provider_error.kind=NETWORK stage=health_check reason="Network request failed — fetch failed" |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplnthi7_8c9c5581` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplntw8g_7fc8f2ea` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplnug6v_84890e06` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 68
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --family safety --max-cost-usd 0.489109 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0067 / cap $0.4891

