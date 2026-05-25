# Crucible Real-Provider Gauntlet
_Generated: 2026-05-25T20:34:59.887Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro` · **Profile:** `compact`
**Real-provider compact certified:** **YES** ✅
**Counts:** PASS: 4

**Totals:** 4 distinct run_ids · 4 distinct bundle_ids · 3015 tokens in · 167 tokens out · $0.0042 (cap: $0.49049)


## Per-test results

| Class | Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|---|
| `conversational/personality` | `personality-001` (easy) | ✅ PASS | complete | `run_mplo00e6_c1cba135` | all contracts satisfied |
| `conversational/personality` | `personality-002` (longer) | ✅ PASS | complete | `run_mplo03zr_b95b17fc` | all contracts satisfied |
| `role-stress/prompt-sensitivity` | `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mplo087w_2817fb7f` | all contracts satisfied |
| `conversational/personality` | `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mplo0j2d_0f971b7d` | all contracts satisfied |

## Report metadata

- Commit: `06d6d1ea0d9b974e04a352b11906019bcb2da46b`
- Branch: `master`
- Dirty tree: true
- Report artifact entries: 80
- RELEASE_CERTIFICATION_INVALID_FOR_TAGGING: true
- Command: `node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --family safety --max-cost-usd 0.49049 --write-report`
- Node: `v22.22.2`
- Package: `0.1.0`
- Cost: $0.0042 / cap $0.4905

