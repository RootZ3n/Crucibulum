# Proposed first empirical campaign

Not authorised, not started, and deliberately specified before any number is
chosen. The purpose of the first campaign is **not** to qualify a model. It is
to produce the distributions from which thresholds can honestly be picked, and
to find out which of the lanes above discriminate at all on real local hardware.

## Preconditions

None of these are optional, and all are operator actions:

1. Mushin reachable, with the operator able to recover it physically. The
   campaign restarts `llama-server` repeatedly by design.
2. A second artifact installed alongside the current `qwen3.5-35b-a3b.q2-k` —
   either a stronger quantisation of the same weights or a different model.
   A single-artifact campaign cannot separate "this model is weak here" from
   "this lane is hard for everyone", which is the question thresholds turn on.
3. `nvidia_uvm` loaded before the runtime starts, and GPU placement confirmed
   by observation rather than by flag. A CPU-only campaign would measure a
   deployment nobody intends to run.
4. An adapter that reports token counts from the runtime's own tokenizer.
   Without it every context tier is a character count wearing a token label,
   and the exporter will refuse the result.

## Matrix

| Axis | Values | Count |
|---|---|---|
| Artifact | Q2_K, plus one stronger quant or model | 2 |
| Lane | L1 schema+grounding, L2 repo reconnaissance | 2 |
| Fixtures | 10 triage, 9 recon (held-out included) | 19 |
| Context tier | control, 8K, 16K, 32K | 4 |
| Repeats | 5 per cell, fixed seeds | 5 |

Sequential, one active request, matching the deployment's `--parallel 1`.

```
2 artifacts × 19 fixtures × 4 tiers × 5 repeats = 760 attempts
```

Plus an L0 pass per artifact per tier — cold load, warm readiness, TTFT,
prefill, decode, VRAM, placement confirmation — at 8 attempts each: **+64**.

**Total ≈ 824 attempts.**

## Estimated duration

From the measured Phase 1 numbers on Mushin (TTFT ~130–360 ms, decode ~62 tok/s
GPU-served, cold load ~2.4 s, full-stack cold start ~13.5 s):

| Tier | Prompt (nominal) | Est. prefill | Est. decode (≤512 tok) | Per attempt |
|---|---|---|---|---|
| control | 0.5K | ~1 s | ~8 s | ~10 s |
| 8K | 8K | ~14 s | ~8 s | ~25 s |
| 16K | 16K | ~28 s | ~8 s | ~40 s |
| 32K | 32K | ~56 s | ~8 s | ~70 s |

Mean ≈ 36 s/attempt across tiers → 760 × 36 s ≈ **7.6 hours**, plus L0 and
per-artifact reloads ≈ **8–9 hours** of wall clock for the full matrix.

Prefill dominates, so the estimate is sensitive to the measured prefill rate.
The Phase 1 sustained figure was 550–580 tok/s; if the second artifact prefills
materially slower, the 32K tier is where the campaign will run long. Two
mitigations, in order of preference: drop the 32K tier for the second artifact
on the first run, or reduce repeats from 5 to 3 (at the cost of a much weaker
variance estimate — 3 is thin for a distribution anybody will set a threshold
from).

Suggested split: **two sessions**, one artifact each, so a failure in the second
does not cost the first artifact's data.

## What the campaign must record

Per attempt, and refused by the exporter if absent: artifact digest,
quantisation, runtime build, hardware profile, prompt-template identity, sampler
and seed, requested **and observed** GPU layers, VRAM held, configured and
effective context, and token counts from the runtime tokenizer.

## What comes out

Not a verdict. The regime emits, per lane and per position and per tier: mean,
worst case, standard deviation, p05/p50/p95; the outcome and attribution splits;
repeatability disagreement across seeds; and latency distributions.

Thresholds are chosen **after** looking at those, by an operator, and recorded
as a versioned policy on the Bokahli side. Until then every export carries
`verdict: "DISQUALIFIED"`, which is not a judgement about the model — it is an
accurate statement that nothing has yet been measured against a standard.

## Explicitly out of scope for the first campaign

L3 coding, native tool use, mutation of any repository, and any run against the
live Bokahli deployment while the operator is away from the machine.
