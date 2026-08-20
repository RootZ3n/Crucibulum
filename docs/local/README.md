# Local model qualification

Luak's existing benchmarks measure hosted models. This is an **additional
evidence lane** for locally served ones. It changes nothing about how historical
hosted evidence is read or scored: every local field is optional, hosted bundles
stay schema-valid, and a hosted bundle never becomes local qualification
evidence by accident.

## Why a separate lane

A hosted model is identified by `adapter:provider:model`, and that is enough
there — the provider owns the weights, the runtime and the machine. Locally,
none of that holds. The same logical model is four different artifacts at four
quantisations, served by two runtime builds with different samplers, on hardware
that decides whether half the tensors live on the GPU at all.

So local models fail in ways the existing vocabulary cannot express: a CPU
fallback that serves the right artifact at a third of the rate, a chat-template
mismatch that looks exactly like incapacity, JSON that degrades at 8K and not at
1K. Bolting two fixtures onto the hosted suites would have produced numbers that
looked like model quality and were partly runtime and partly harness.

## What is here

| Path | What it is |
|---|---|
| `CENSUS.md` / `CENSUS.json` | Generated census of all 87 existing tasks: what each family measures, whether it applies locally, and what it confounds |
| `census-annotations.json` | The authored judgements the census joins against. A family with no annotation is an error |
| `LADDER.md` | The qualification ladder: L0 operational, L1 schema and grounding, L2 bounded repo reconnaissance, L3 and native tools as design only |
| `../../types/local-verdict.ts` | Failure taxonomy and the attribution model |
| `../../types/local-identity.ts` | What local evidence must name to be about anything |
| `../../core/local/` | Generator, fixtures, scorers, regime, exporter |
| `fixtures/` | Materialised fixtures with recorded hashes. Kept out of `tasks/`, which is owned by the existing corpus validator and inventory pins |
| `../../suites/local-l*.json` | Versioned suite definitions, thresholds deliberately `null` |

Regenerate with `node scripts/local-census.mjs` and
`node scripts/local-fixtures.mjs`; both take `--check` to prove the committed
artefacts are current.

## The three ideas worth knowing

**Attribution.** Every result is placed on an axis the hosted scoreboard lacks:
`MODEL`, `RUNTIME_PROVIDER`, `HARNESS_PARSER`, `TOOL_SANDBOX`, or `COMPOSITE`. A
measurement that cannot be placed on it is not admissible as qualification
evidence, and a `COMPOSITE` result can be compared and inspected but never
exported as a model score. This is what stops "our regex successfully
interpreted something that looked vaguely like a shell command" from becoming
"this model can use tools".

**Applicability is not failure.** A chat-only endpoint did not *fail* the
agentic lane and a text-only model did not *fail* the vision lane. Those are
`NOT_APPLICABLE` and `UNSUPPORTED_CAPABILITY`, which produce no score — scoring
either as zero would manufacture a deficiency out of an interface mismatch.

**Unknown is not zero.** Every unmeasured value stays `null`. A missing TTFT is
not a TTFT of zero; a fixture never repeated has a repeatability disagreement
rate of `null`, not `0`, because `0` would assert a stability nothing measured.

## No thresholds

Nothing here says what is good enough. `pass_threshold` is `0` and `thresholds`
is `null` in every local suite, and the regime emits distributions rather than
verdicts. Choosing thresholds is an operator act that has to follow the first
empirical campaign, because a threshold invented beforehand that happens to be
met is indistinguishable from one that was earned.

## Not in this phase

No campaign has run. No model is qualified. Nothing here invokes a live
inference service — the fixtures are data and the scorers are pure functions,
and a test asserts that no module in the lane so much as imports a transport.
