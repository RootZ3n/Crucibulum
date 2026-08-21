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
| `../../suites/local/*.json` | Versioned local suites, loaded by `core/local/suite-registry.ts`. Kept out of `suites/` root, which the legacy loader enumerates |
| `../../cli/commands/local.ts` | `luak local-qualify` and `luak export-qualification` |

## How to run it

```bash
luak local-qualify --list                      # suites, adjudication state, coverage
luak local-qualify --suite local-l1-schema-grounding --split evaluation
luak export-qualification --suite <id> --identity <f.json> --records <f.json>
```

Both are offline. No responder ships in this phase, so `local-qualify` is a dry
run by construction rather than by flag: there is nothing to pass that reaches a
model.

Regenerate the derived artefacts with `node scripts/local-census.mjs` and
`node scripts/local-fixtures.mjs`; both take `--check`.

## The three ideas worth knowing

**Attribution.** Every result is placed on an axis the hosted scoreboard lacks:
`MODEL`, `RUNTIME_PROVIDER`, `HARNESS_PARSER`, `TOOL_SANDBOX`, or `COMPOSITE`. A
measurement that cannot be placed on it is not admissible as qualification
evidence, and a `COMPOSITE` result can be compared and inspected but never
exported as a model score. This is what stops "our regex successfully
interpreted something that looked vaguely like a shell command" from becoming
"this model can use tools".

Attribution has a direction, and it is not symmetric. Calling a model failure a
harness failure removes the attempt from the model's distribution and *raises*
its measured capability; calling a harness failure a model failure lowers it.
The first error is the dangerous one, because it looks like caution. Regime
1.2.0 exists because that error was made: a completion carrying `\u{3e}` inside
a JSON string — invalid JSON, delivered whole, read correctly — was recorded as
`local_harness_parse_failure`/HARNESS_PARSER and dropped from the score. The
rule now is narrow and checkable:

- A completion **arrived and violates its output contract** → MODEL, via
  `local_invalid_structured_output`, `local_truncated_completion`,
  `local_empty_completion` or `local_degeneration_repetition`. Whether the model
  produced something unusable is decidable the moment `JSON.parse` speaks.
- **The harness could not do its job** — the extractor threw, or no parser was
  configured for the fixture — → `local_harness_extraction_failure` (COMPOSITE)
  or `local_harness_parse_failure` (HARNESS_PARSER). Nothing was concluded about
  the model, because nothing reached its answer.

There is one structured-output boundary, `checkStructuredOutput`, and both the
parsers and the scorers go through it. Two implementations of the same decision
is how the wrong one came to be the one that ran.

**A quote is not a claim.** Adversarial fixtures list the attack's own sentences
as `forbiddenClaims`, and the citation contract requires quoting the lines a
model cites. Measured over the whole completion, a model that refused the
injection and reported it by citing it was indistinguishable from one that
carried it out — and the positive class was unreachable for any model obeying
the contract. Compliance is now measured over the model's own voice
(classifications, observations, stated needs) and never over `quote` fields;
`injection.detected` reports the quoting separately, because surfacing an attack
is the behaviour being asked for.

**Applicability is not failure.** A chat-only endpoint did not *fail* the
agentic lane and a text-only model did not *fail* the vision lane. Those are
`NOT_APPLICABLE` and `UNSUPPORTED_CAPABILITY`, which produce no score — scoring
either as zero would manufacture a deficiency out of an interface mismatch.

**Unknown is not zero.** Every unmeasured value stays `null`. A missing TTFT is
not a TTFT of zero; a fixture never repeated has a repeatability disagreement
rate of `null`, not `0`, because `0` would assert a stability nothing measured.

## No thresholds — as a state, not a number

Local suites carry an `adjudication` state, never a numeric `pass_threshold`.
The first draft used `pass_threshold: 0` to mean "measures rather than grades";
that was a live exploit, because `resolvePassThreshold` returned `0` and every
score satisfies `>= 0`. A state cannot be compared against a score, so it cannot
be satisfied by one.

| State | Meaning |
|---|---|
| `EVIDENCE_ONLY` | Measurements only. No pass/fail may be derived by anyone. |
| `THRESHOLD_UNSET` | Thresholds would apply; none has been configured. |
| `ADJUDICATED` | An operator configured versioned thresholds. |

Every suite shipped today is `EVIDENCE_ONLY` or `THRESHOLD_UNSET`, and
`canAdjudicate()` returns false for all of them. A suite claiming `ADJUDICATED`
without thresholds, or carrying thresholds while claiming otherwise, fails to
load.

## Fixture splits are public, not secret

The evaluation split is **committed to a public repository**. It is excluded
from development tuning by policy — a discipline about how we use it, not a
property of the fixtures. A model trained on public GitHub may have seen every
line. A verdict resting on it means "passed the evaluation split", never
"generalised to unseen inputs".

Genuinely hidden fixtures require an external private fixture pack with its own
pinned identity, loaded from outside this repository. That does not exist yet.

## Not in this phase

No campaign has run. No model is qualified. Nothing here invokes a live
inference service — the fixtures are data and the scorers are pure functions,
and a test asserts that no module in the lane so much as imports a transport.
