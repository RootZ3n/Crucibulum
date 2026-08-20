# The local qualification ladder

Local models fail in ways hosted models do not, and most of those ways are
invisible to a benchmark built for hosted APIs. The ladder exists so that a
verdict about a local deployment says *which* thing was measured — because
"the model scored 0.6" is not a fact about a model unless you also know it ran
on the GPU it was supposed to, at the context it was supposed to, with the
prompt template it was supposed to.

Each level is an **independent lane**. They are not stages to pass through in
order, and a level is never a prerequisite for reporting another — a model can
be excellent at grounded extraction and unusable at long context, and a ladder
that collapsed those into one number would hide exactly the thing an operator
needs to know.

---

## Level 0 — Operational

**Question:** is the thing under test what it claims to be, running where it was
meant to run?

Nothing here is a capability measurement, and L0 issues no verdict about the
model at all. It exists because every measurement above it is void without it.
The 2026-08-20 Mushin reboot is the standing example: a runtime that lost CUDA
served the correct artifact, attested correctly, passed every acceptance check,
and ran at roughly a third of the expected rate. Any capability number taken
that day would have been a real measurement of a deployment nobody intended.

| Measurement | Why it is here |
|---|---|
| Exact served identity, artifact digest, runtime build | Evidence that cannot name its subject is evidence about nothing |
| Device placement: requested vs **observed** GPU layers, VRAM held | A flag is a request; only the observation is a fact |
| Prompt template identity and who applied it | A template mismatch is indistinguishable from incapacity after the fact |
| Cold load time, warm readiness | Operational, and the first thing to regress on a driver change |
| TTFT, prefill rate, decode rate | Throughput is a placement signal as much as a speed one |
| Configured vs **effective** context | Two different numbers that are routinely conflated |
| RAM / VRAM under load | Where the OOM tier boundary actually sits |
| Crash and timeout attribution | Load, prefill and decode timeouts have different operator fixes |
| Repeated-request stability | Variance is a property of the deployment, not noise to average away |

**Outcome:** a measurement set, plus `local_unintended_device_placement` or
`local_wrong_served_artifact` where placement or identity disagree with intent.
Both are `NC` and neither counts against the model.

---

## Level 1 — Schema and grounding

**Question:** can the model produce exactly the shape it was asked for, and
support every claim it makes from the text it was given?

This is where local models break first and most consequentially. Aggressive
quantisation produces code-shaped text and JSON-shaped text far more readily
than correct code or valid JSON, and a fluent ungrounded answer is more
dangerous than an obviously wrong one because it survives review.

- Strict JSON / schema compliance — with truncation, malformation and
  degeneration scored **separately**, since they have different causes
- Extraction with exact source spans
- Classification with an explicit abstention option, and credit for using it
- Conflicting-evidence handling: surface the contradiction, do not average it
- Missing-information refusal
- Citation faithfulness — every span checked against the supplied text
- Resistance to instructions embedded **inside the evidence**

That last one differs from the existing `safety` family in a way that matters.
There, the injection arrives in the user turn, where refusing is the expected
move. Here it arrives inside the material the model was asked to analyse, where
the correct behaviour is to treat it as data and carry on working — a strictly
harder test, and the one that reflects how a log or a source comment actually
reaches a model.

**Fixtures:** `local-test-log-triage@1.0.0`, ten authored cases covering a root
cause with a downstream tail, genuinely independent failures, flakes,
infrastructure versus assertion, truncation, contradiction, stack-trace
citation, an unanswerable case, an injection case, and a clean-run negative
control.

---

## Level 2 — Bounded repository reconnaissance

**Question:** given a bounded evidence packet, can the model find what is
relevant, cite it exactly, and say plainly what it was not given?

The packet is the model's entire world: files, line-numbered excerpts, an
explicit allowlist, and a record of what was withheld. No filesystem, no shell,
no repository to explore. That bound is what makes the lane both scoreable — a
citation either lands in supplied text or it does not — and runnable against a
chat-only inference server, which the existing agentic families are not.

- Relevant-file and relevant-symbol recall
- Hallucinated-path rate, measured against traps that are deliberately plausible
- Dependency relationship accuracy, with `OBSERVED` and `INFERRED` kept apart
- Citations into the packet
- Correct reporting of omitted context

**Fixtures:** `local-repo-reconnaissance@1.0.0`, nine authored packets.

---

## Level 3 — Narrow coding — **design only**

Not implemented. No mutation execution is added in this phase, and nothing in
this repository grants a local model the ability to edit a file.

The design, for when it is authorised:

- Single-file patch generation against a fixture repository
- Exact diff scope — an edit outside the named file is an integrity failure,
  not a lower score
- Compilation / typecheck as a gate before any test runs
- Visible tests the model may run; hidden tests it may not see
- No unrelated edits, checked by diff rule rather than by judgement
- Bounded repair convergence: a fixed retry budget, with the number of attempts
  recorded rather than hidden

The existing `orchestration`, `poison_localization` and `spec_discipline`
families already have the right oracle shape for this — hidden tests plus
forbidden-path integrity checks — and L3 should reuse that design rather than
invent a parallel one. What it must **not** reuse is the free-text command
extraction those families depend on; see below.

---

## Native tool use — **design only, and deliberately separate**

The existing `tool_calling` family measures whether the harness's free-text
parser recognised something the model emitted, and then reports the result as a
model score. That is the product of two systems presented as a property of one.
A model that emits a perfectly valid tool call in a format the extractor does
not recognise scores zero; a model that emits something malformed the extractor
happens to accept scores one.

So native tool capability is **not** certifiable through those tasks, and the
taxonomy enforces it: `local_harness_extraction_failure` is attributed
`COMPOSITE`, and the exporter refuses to emit any COMPOSITE attempt as a model
score.

A future native-tool lane needs an execution contract that isolates the two:

1. The runtime exposes structured tool calls natively (an OpenAI-style
   `tool_calls` array), so the call is read from a typed field rather than
   scraped from prose.
2. Scoring observes the **emitted call** — name, arity, argument schema — and
   never the filesystem effect, so no sandbox sits between the model and the
   measurement.
3. Extraction failures are impossible by construction: if the field is absent,
   the result is `UNSUPPORTED_CAPABILITY`, not a failure.
4. Only then may a tool lane produce a MODEL-attributed score.

Until a runtime provides (1), the honest answer for a local chat-only
deployment is `NOT_APPLICABLE`.

---

## Cross-cutting stress dimensions

Applied across L1 and L2 rather than being lanes of their own, because they
modulate every measurement above:

| Dimension | How it is varied |
|---|---|
| Context length | `control` / 8K / 16K / 32K, and 64K where the adapter supports it |
| Distractor density | Planted near-misses per tier |
| Evidence position | Required facts at the beginning, middle and end — reported separately, never averaged |
| Repeated identifiers | Names differing by one character |
| CRLF and Unicode | Line endings and multibyte text in fixtures |
| Ambiguity | Answerable and unanswerable variants of the same shape |
| Quantisation sensitivity | Same suite across quants; the comparison is the measurement |
| Repeatability | Repeated seeds and repeated runs; disagreement is `null` when nothing was repeated, never `0` |

Context tiers are *named* for token budgets and *built* to character targets.
The character count is fixture-generation metadata. The token count is whatever
the model's own tokenizer reports at execution time, recorded then with
`tokenCountSource: "runtime_tokenizer"` — and the exporter refuses any bundle
whose tier was not measured that way.

---

## What the ladder does not do

It does not set thresholds. Not one number in `suites/local-l*.json` says what
is good enough, and `pass_threshold` is `0` with `thresholds: null` throughout.
No campaign has run, so any threshold chosen now would be invented, and an
invented threshold that happens to be met is indistinguishable from a real one
that was. The regime emits distributions — mean, worst case, variance, per
position, per tier — and choosing from them is an operator's act.
