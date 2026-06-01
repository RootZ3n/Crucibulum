> # ⛔ INVALID_RUN — not a model-quality verdict
>
> This report came from a **provider-error-only run**: 0 tokens, **\$0.0000** spend, 0 completed
> provider calls. Every task failed at the OpenRouter provider layer (auth/credit), so the
> original **REJECT** was a bug — a pass-rate computed from provider-failed cells, not a measurement
> of MiniMax-M3. **Do not cite this for MiniMax-M3 vs MiMo v2.5 / v2.5-Pro quality.**
> The run-validity gate added on `experiment/minimax-m3-benchmark` now classifies such runs as
> `PROVIDER_FAILURE` / `INVALID_RUN` and refuses the MiMo comparison.

# MiniMax-M3 experimental benchmark

- **Timestamp (UTC):** 2026-06-01T02-57-56Z
- **Commit:** aff89e98c5af90b98c3e61763b222a8fe2eb8d88
- **Target:** minimax-m3 → `minimax/minimax-m3` (tier EXPERIMENTAL)
- **Affects leaderboard:** false · **Affects certification:** false
- **Cost cap:** $2 · **actual:** $0.0000
- **Max output:** 1024 tokens/call · **runs/task:** 1
- **Batch:** yes (compares 3 models; runs 11 tasks (> 4))

## Per-model results

| Model | Pass | Pass rate | Latency | Tool/JSON | Cost | Cost/useful |
|---|---|---:|---:|---:|---:|---:|
| minimax/minimax-m3 | 1/11 | 9% | 32 ms | 33% | $0.0000 | $0.0000 |
| xiaomi/mimo-v2.5 | 1/11 | 9% | 29 ms | 33% | $0.0000 | $0.0000 |
| xiaomi/mimo-v2.5-pro | 1/11 | 9% | 29 ms | 33% | $0.0000 | $0.0000 |

## Verdict — REJECT

Below reliability floor (pass 9%, tool/JSON 33%).

- **Quality vs MiMo v2.5:** MiMo v2.5: 9% vs 9% (comparable, Δ 0pts)
- **Quality vs MiMo v2.5 Pro:** MiMo v2.5 Pro: 9% vs 9% (comparable, Δ 0pts)
- **Latency:** 32 ms/task avg
- **Tool/JSON reliability:** 33% pass on tool-call + JSON categories (3 tasks)
- **Failure modes:** provider_error
- **Cost per useful result:** $0.0000

## Categories not evaluated

- `prompt-refinement-luna` — No Luak task covers Luna asset-prompt refinement; not evaluated.

## Cost estimate vs actual

- **Pre-flight estimate (rough, nominal):** ~409,020 tokens, $0.1722
- **Actual:** 0 tokens, $0.0000 across 33 cell(s)
