# Crucible Real-Provider Gauntlet
_Generated: 2026-05-23T23:40:40.685Z_

**Provider:** `openrouter` · **Model:** `deepseek/deepseek-v4-pro`
**Real-provider release-certified:** **YES** ✅
**Counts:** FAIL_PROVIDER: 1 · PASS: 3

**Totals:** 4 distinct run_ids · 3 distinct bundle_ids · 2773 tokens in · 321 tokens out · $0.0048 (cap: $1)


## Per-test results

| Task | Result | Terminal | run_id | Notes |
|---|---|---|---|---|
| `personality-001` (easy) | 🟡 FAIL_PROVIDER | error | `run_mpizr3zh_a9ce3702` | provider_error.kind=NETWORK stage=health_check reason="Network request failed — fetch failed" |
| `personality-002` (longer) | ✅ PASS | complete | `run_mpizr40w_f3ab789d` | all contracts satisfied |
| `role-stress-001` (multi-question) | ✅ PASS | complete | `run_mpizraya_d7554c7b` | all contracts satisfied |
| `personality-001` (repeat-easy) | ✅ PASS | complete | `run_mpizro8x_b9f3399c` | all contracts satisfied |
