# The Bokahli responder

Executes Luak qualification attempts against Bokahli's authenticated local API.
It imports nothing from Bokahli and bypasses none of its checks — the network
boundary *is* the contract, and a responder that reached around it would be
measuring a Bokahli no real caller ever sees.

```bash
luak local-qualify --suite local-l1-schema-grounding \
                   --split evaluation \
                   --responder bokahli \
                   --responder-config campaign.json
```

The credential is never a flag. It is named in the config as an environment
variable or a 0600 file and read at request time, so it never reaches argv,
`ps`, or shell history.

## What Bokahli actually exposes

Read from source at `00f15086435844628217590d79130593c55d2f11` and confirmed by
bounded metadata calls against the live deployment. Nothing below is inferred.

**Authentication** — `Authorization: Bearer <token>`, constant-time compared. A
`bokahli_token` cookie and `?token=` on a GET also work; the responder uses the
header only. Every failure is a bare 401 with no detail.

**Request** — `POST /v1/bokahli/chat`:

```json
{ "route": { "mode": "EXACT", "modelId": "…", "artifactDigest": "sha256:…",
             "requireQualified": false },
  "messages": [...], "maxTokens": 256, "temperature": 0, "topP": 1, "stream": false }
```

`requireQualified` and `taskClass` are parsed strictly — a non-boolean is a 400,
not a silent false.

**Served identity** — `result.servedIdentity`: `modelId`, `digest`,
`runtime{engine,build,executableDigest,cuda,driver}`, `servedContextTokens`,
`qualification`, `attested`, `attestationMethod`.

**Telemetry** — `telemetry`: `timeToFirstTokenMs`, `totalMs`, `promptTokens`,
`completionTokens`, `promptTokensPerSecond` (prefill), `completionTokensPerSecond`
(decode), `servedContextTokens`, `contextUtilisation`, `runtimeBuild`,
`queueWaitMs`, `queueDepthAtAdmission`, `routeMs`, and
`gpu{totalMiB,usedMiB,freeMiB,utilisationPct,temperatureC}`.

**Streaming** — SSE: `bokahli.identity`, `bokahli.delta`, `bokahli.done`. The
terminal event carries `outcome: "ROUTED" | "ESCALATE"` and, on escalation,
`partialTextDiscarded`.

**Typed outcomes** — `ESCALATE` (200), `REFUSED` (409), `CAPACITY_UNAVAILABLE`
(503, with `Retry-After`), plus `x-bokahli-outcome` on every non-routed
response, and the error envelope `{error:{code,message,requestId}}`.

## What Bokahli does not expose

Five gaps. The first is the one that currently blocks qualification export.

| # | Missing | Consequence | What would close it |
|---|---|---|---|
| 1 | **Tokenizer provenance** | Counts are returned but nothing says which tokenizer produced them. The responder reports `runtime_reported_unknown_tokenizer` and the exporter refuses qualification export with `TOKEN_COUNTS_NOT_MEASURED`. | One field on `RequestTelemetry`, e.g. `tokenCountSource: "runtime_tokenizer"`, set where llama.cpp's `usage` block is read. |
| 2 | **Prompt-template identity** | No template id or hash anywhere, so `local_prompt_template_mismatch` is undiagnosable and template identity cannot be bound to evidence. | Expose llama.cpp's `chat_template` name and a digest of its text from `/props`. |
| 3 | **Sampler echo** | `temperature`/`topP` are accepted but never echoed, and there is no `seed` parameter at all. Repeatability cannot be distinguished from sampling noise. | Echo the applied sampler in `servedIdentity`, and accept a seed. |
| 4 | **Per-process device placement** | `gpuLease.snapshot` is the whole GPU. It cannot confirm that *our* backend holds VRAM — the exact CPU-fallback condition of 2026-08-20. Bokahli knows this internally via `gpu.ownPids`; it just is not in a response. | Add the backend's own VRAM to `/health/ready`. |
| 5 | **`executableDigest`, `cuda`, `driver`** | Declared on `RuntimeIdentity` and hardcoded `null`. Present in the type, absent in fact. | Populate from the runtime probe. |

Gaps 2–5 degrade the *richness* of evidence. Gap 1 blocks export outright, and
that is deliberate: the rule is that a count may be called a runtime-tokenizer
measurement only when the runtime says so. Bokahli's counts almost certainly are
exact — they come from llama.cpp's own `usage`/`timings` — but "almost
certainly" is not provenance, and relabelling it would be precisely the
character-count-as-token-count error the contract forbids.

A live smoke test asserts each gap still exists. When Bokahli gains the field,
that test fails and the responder can be upgraded — the limitation is a test
fact, not a claim in a document nobody re-reads.

## Why EXACT with `requireQualified: false`

A campaign is about one artifact, so the route names it by identity **and**
digest and Bokahli refuses any substitution. But the campaign exists to
*produce* qualification evidence, so demanding existing qualification would be
circular — the first campaign could never run.

So `requireQualified: false`, and every attempt records
`authorizedQualificationAttempt: true` alongside `requireQualifiedSent: false`.
Both facts travel together, so nothing downstream can read the run as evidence
that the model was already qualified.

The responder additionally re-checks the served identity on arrival — digest,
model id, runtime build, and `attested: true` — even though Bokahli checks them
too. A substitution that somehow passed Bokahli's checks would attribute
evidence to the wrong weights, silently and permanently. Cheap here; impossible
to detect later.

## Failure attribution

`bokahli-failure-map.ts`, versioned, with every Bokahli outcome mapped
explicitly. A test walks each union member from Bokahli's source and fails if
any is unmapped, and another asserts that **nothing in the table is attributed
to the model**.

That is the governing rule: every outcome in that file is a routing, transport,
identity, capacity or harness event that happened *instead of* the model
answering. An expired token is not a wrong answer. A full queue is not a wrong
answer. Model quality is measurable only after a successful attested response,
and it is measured by the scorers.

An outcome the map does not recognise becomes a loud `HARNESS_PARSER` failure
rather than defaulting either way — defaulting to model failure would launder a
protocol change into a capability claim; defaulting to infrastructure would hide
one.

## Streaming

Partial text is never a completion. Bokahli discards partial output when the
runtime dies mid-generation and says so with `partialTextDiscarded`; the reader
discards it client-side too, so no scorer can see a fragment the server already
disowned. The same applies to a stream that ends without a terminal event, and
to one whose frames could not be parsed.

A second terminal event is refused rather than allowed to overwrite the first —
otherwise a stream could be made to end however it liked.

First-token and mid-generation timeouts are separate, because the operator fix
differs: the first is context size and batching, the second is throughput.

## Secret handling

- Never a CLI argument — there is no flag, and `readCredential` has no code path
  that accepts one.
- Never in a config — `validateBokahliConfig` refuses any config with a
  secret-bearing key. The check matches key *endings* after stripping
  underscores, so `api_key` is caught and `firstTokenTimeoutMs` is not; a guard
  that fires on ordinary field names gets loosened by the next person who trips
  over it, and then it protects nothing.
- Never in evidence — a test asserts the token appears nowhere in a full
  response object.
- Never in diagnostics — `redact()` covers headers, bearer strings, query
  parameters, cookies and JSON fields; `redactDeep()` walks structures.
- A credential file readable by group or other is refused, not warned about.

## Is the two-fixture pilot valid?

**Structurally yes, for export no.** The responder executes attempts, binds
exact identity, records runtime timings, and produces canonical attempt
records — so a pilot would produce real, analysable measurements today.

What it cannot do is produce a *qualification export*, because gap 1 makes the
exporter refuse with `TOKEN_COUNTS_NOT_MEASURED`. That is working as intended:
the pilot would prove the plumbing end to end and hand back a typed refusal at
the last step, which is a useful result and an honest one.

Closing gap 1 is a one-field change on Bokahli's side.
