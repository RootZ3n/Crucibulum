> **⚠️ LAB-ONLY PRODUCT — AUTHENTICATION IS YOUR RESPONSIBILITY**
>
> This tool is designed for **local/lab use only**. It binds to localhost by default
> and is meant to run behind Tailscale, a VPN, or on a private network.
>
> **If you expose any service to the public internet, YOU are responsible for
> securing it.** No authentication, rate-limiting, or access control will be added
> to this product. That is not a bug — it is a design decision.
>
> Expose at your own risk.

# Luak

**Scoreboard & evidence viewer for AI agent trials** — turns model/agent trial outputs into auditable scoreboards, receipts, and comparison views.

```bash
npm install luak
```

## What is this?

Luak helps you inspect what your AI actually did. When you run an AI model or agent through a trial — a coding task, a conversation test, a benchmark — Luak takes the raw output and turns it into:

- **Scoreboards** — ranked comparisons across models, providers, and adapters
- **Receipts** — signed, hash-verified evidence bundles you can audit later
- **Comparison views** — side-by-side inspections of what changed, what passed, and why

It doesn't trust the model's own story about what happened. It looks at observable state — files changed, tests passed, integrity rules followed — and judges from evidence. If you've ever wondered "did my AI actually do the thing, or just say it did?", Luak answers that with receipts.

## What is Peh?

Luak is part of **Peh**, an open-source AI ecosystem for building, testing, and inspecting AI systems with transparency and accountability. Peh tools are designed to work together but each one stands on its own.

Sibling projects:

| Tool | What it does | Repo |
|------|-------------|------|
| **Velum** | Security and defense layer | [RootZ3n/velum](https://github.com/RootZ3n/velum) |
| **Ikbi** | Knowledge and information management | [RootZ3n/ikbi](https://github.com/RootZ3n/ikbi) |
| **Kokuli** | Language and translation tooling | [RootZ3n/kokuli](https://github.com/RootZ3n/kokuli) |
| **Howa** | Truthfulness and lie detection | [RootZ3n/howa](https://github.com/RootZ3n/howa) |

---

## How Luak Fits With The Other Tools

- **Colosseum** generates trial runs and receipts. Use it as the proving ground when you need to create fresh trial evidence.
- **Luak** views, compares, scores, and explains run evidence. Use it to inspect receipts, compare models/providers/adapters, and understand why a run is or is not ranked.
- **Verum** is adversarial and probing-oriented. Its outputs can be normalized into Luak score/evidence views when the integration path is used.
- **Aedis** is governed build orchestration. It can drive controlled workflows that later produce evidence for inspection.
- **Peh Public** is the broader user-facing AI control surface. Luak is one evidence and scoreboard layer inside that wider release path.
- **Crucibulum** appears in environment variables, schemas, and API names as the older/internal protocol name for Luak-compatible run and score exchange. Public docs should treat it as compatibility naming, not a separate public product unless the project is split later.

## What Luak Is / Is Not

Luak is:

- a local scoreboard and evidence viewer
- a lane-scoped comparison UI
- a provenance and receipt inspection layer
- an observed-behavior comparison tool
- a way to preserve adapter/provider/model identity while reviewing results

Luak is not:

- a universal model benchmark
- a safety certification
- proof that a model is safe
- a replacement for external audits
- a guarantee of local or cloud isolation
- the primary trial-generation harness when Colosseum owns that role

## Public Leaderboard Trust

Default public leaderboard views rank only verified eligible evidence bundles.

Tampered, forged, legacy, unsigned, unauthenticated, mock/demo, malformed, or otherwise unverified bundles are quarantined and are not ranked. Quarantined evidence may be inspected through safe metadata views such as `/api/leaderboard/quarantine`, but it is labeled `NOT RANKED` and does not influence default scores.

Local historical runs may exist in `runs/`. They are local state, ignored by git, and not treated as public leaderboard evidence unless they pass the current eligibility gate.

## First-Run Mental Model

A fresh checkout does not ship with public ranking data. The offline harness path uses the mock adapter for pipeline validation only; those results are deliberately quarantined from public rankings as mock/demo evidence. Live or imported evidence must be verified before it can appear in the default public leaderboard.

Current desktop and mobile screenshots are in `docs/screenshots/`. Additional GIFs are planned before the final public announcement.

## Evidence Model

Luak is built around a narrow question: what did this model or agent do under a defined task, adapter, provider, and scoring policy, and what evidence supports that observation?

Luak does not grade based on style, self-report, chain-of-thought, or polished explanations. It grades based on observable state:

- what files changed
- what tests passed or failed
- what integrity rules were violated
- how much time and step budget were used
- what the deterministic judge can verify from the workspace

The core trust model is simple:

- the agent never sees the oracle
- the deterministic judge is authoritative
- hidden checks and integrity checks drive scoring
- review models are advisory only
- bundles are signed and auditable

## What Luak Does

Luak ingests or creates model/agent run evidence, applies deterministic scoring where configured, and turns that evidence into local scoreboards, receipts, and comparison views.

In practice, that means it can:

- inspect run bundles and receipts
- compare models across task families and lanes
- show why evidence is eligible or quarantined
- run local smoke tasks against a model when needed
- run a local suite for development and regression checks
- compare multiple models across repeated runs
- score outcomes using hidden and public checks
- enforce integrity constraints like forbidden-path edits and anti-cheat patterns
- produce replayable, hash-verified evidence bundles
- expose results through a local API and UI
- add optional advisory review layers without weakening deterministic authority

## What Problem It Solves

A lot of model evaluation still collapses into one of these failure modes:

- benchmarks that reward explanation instead of execution
- public-only tasks that are easy to overfit
- systems that trust the agent's own story about what happened
- leaderboards that show scores without evidence
- review layers that quietly blur interpretation with authority

Luak is designed against that.

It treats evaluation as an evidence problem. The key question is not "did the model say the right thing?" It is "what behavior was observed, under what conditions, and can the evidence be inspected independently?"

## How It Works

At a high level, Luak follows this pipeline:

1. Load a task manifest.
2. Filter the manifest for the agent so the rubric and oracle stay hidden.
3. Create an isolated workspace from the task repo.
4. Execute the selected adapter/model in that workspace.
5. Record timeline and filesystem evidence.
6. Collect the diff.
7. Run integrity and security checks.
8. Judge the outcome deterministically with oracle-backed checks.
9. Build a signed evidence bundle.
10. Optionally run advisory review layers on sanitized evidence only.

The implementation is centered on a three-box model:

- `Runner`: orchestration, workspace setup, adapter execution, bundle assembly
- `Observer`: timeline and file activity capture
- `Judge`: deterministic scoring from evidence, oracle checks, and integrity rules

The principle behind the system is explicit in the code:

- score is based on observable state transitions
- narration is not trusted
- the deterministic judge is the authoritative scoring source for configured checks

## Benchmark Coverage

The current repo contains both repo-execution tasks and conversational tasks.

Repo task families:

- `poison_localization`
- `spec_discipline`
- `orchestration`

Conversational task families currently present in the corpus:

- `identity`
- `truthfulness`
- `classification`
- `code`
- `workflow`
- `instruction-obedience`
- `personality`
- `prompt-sensitivity`
- `role-stress`
- `context-degradation`
- `reasoning`
- `summarization`
- `thinking-mode`
- `token-efficiency`

This means Luak can inspect both execution behavior and chat behavior. The current taxonomy is release-candidate level and versioned, but it should still be cited with the repository commit, task IDs, and scoring policy used for a given comparison. The test corpus is lightweight by design (intentional minimum for bootstrap); use `npm run oracle:hash -- --write` after adding oracles to register them in the corpus.

### Experimental targets

Some models are wired up for **experimental benchmarking only** — never as a
default, the judge, or a normal routing target, and always excluded from the
leaderboard and capability certification. OpenRouter **MiniMax-M3** is the first
such target: run `npm run bench:minimax-m3 -- --model minimax-m3 --smoke-only`
to gate it, or see [`docs/MINIMAX_M3_EXPERIMENTAL.md`](docs/MINIMAX_M3_EXPERIMENTAL.md)
for the full cost-capped comparison against the MiMo v2.5 family.

## Scoring Model

Luak judges runs in a fixed order:

1. Integrity
2. Correctness
3. Regression
4. Efficiency

This ordering matters.

Integrity runs first because some failures should hard-fail the run regardless of downstream test outcomes. Examples include:

- forbidden path edits
- anti-cheat patterns
- integrity-rule violations from the oracle

Correctness and regression are then judged using hidden and public checks. Efficiency measures how expensive the run was relative to the task budget.

The result is a structured score with:

- total score
- score breakdown
- pass/fail
- pass threshold
- integrity violation count
- failure taxonomy

Public API and leaderboard scores are expressed as `0-100` percentages.

Internal bundles currently retain `0-1` fractional totals for backward compatibility, but they now also include explicit percent mirrors and a score-scale marker. That distinction is temporary and documented in [docs/scoring.md](docs/scoring.md).

## Evidence and Bundles

Every run produces an evidence bundle. The bundle is the core artifact of the system.

A bundle contains:

- task identity and manifest hash
- target model, provider, and adapter
- environment metadata
- timeline of observed actions
- diff evidence
- security metadata
- verification results
- deterministic score
- usage and cost estimates
- trust metadata
- diagnosis metadata
- optional advisory review results

Bundles are hash-signed so the result can be verified later. The API also produces structured summaries for downstream consumers.

This is important because Luak is not just trying to emit a score. It is trying to emit a score with an audit trail.

## Bundle Immutability and Scoring Honesty

Luak separates "what happened on this run" from "what the current leaderboard says about a model." Both are honest, but they answer different questions, and reading one as the other is the most common way to misinterpret a Luak result.

**Signed bundles are immutable evidence.** Once a run is written to `runs/<bundle_id>.json` and hash-signed, the file is not rewritten — not when scoring rules change, not when judges are upgraded, not when bugs are fixed. The bundle records what the run produced *at the moment it produced it*. Tampering breaks the hash check; the trust layer marks tampered bundles as not ranked.

**Some older bundles carry historical stored scores.** Luak's scoring discipline tightened during the May 2026 trust audit (see `tests/safety-scoring.test.ts`, `tests/lane-scoring.test.ts`). Bundles written before that audit may show a stored `score.total` that included regression / integrity / efficiency credit even when correctness was zero. Those numbers are correct as a record of what the *pre-audit* formula produced. They are not current trust claims.

**The leaderboard, UI warnings, recommendation cards, diagnostics, and exports all use the current trust rules.** Specifically:

- The backend leaderboard composite excludes NC bundles (provider / network / judge / test outages) via `verdict.countsTowardModelScore`. A model that never actually ran does not get a capability score.
- The repo-mode and conversational score formulas gate secondary credit on non-zero correctness. A run that produced no correct output cannot float to 15–60% on R/I/E defaults.
- The UI's lane scope banner surfaces `PROVISIONAL · n=<x>`, `ALL NOT-COMPLETE`, `<x>% NC`, `ALL RUNS FAILED`, `<x>% INFRA`, and `<n> HISTORICAL` chips when the conditions are met.
- The bundle detail panel shows a `STORED HISTORICAL SCORE` banner when a bundle predates current scoring discipline, and a `NOT COUNTED TOWARD LEADERBOARD` banner when the verdict excludes it from the composite.
- Recommendation cards (Best Overall, Best Value, Fastest Usable) refuse to crown a model with zero composite or zero pass rate. Risky / Avoid is intentionally the opposite — it surfaces failed or invalid models so users see them.

**NC, provider, judge, and test failures stay visible as evidence.** They are not deleted, they are not hidden, and they do not vanish from the run history. They are excluded from *capability averages* because they did not measure the model. They remain counted in `nc_rate`, `failed_provider`, `failed_judge`, and the failure taxonomy.

**Raw `score.total` is historical stored data.** A bundle's `score.total` is what the scoring formula produced when the bundle was written. For a current-discipline interpretation, read the leaderboard endpoint or the UI — both recompute against current rules and exclude bundles that should not count. Do not treat `score.total` from a raw bundle file as the current Luak trust claim for a model.

**JSON and CSV exports carry honesty metadata.** Lane leaderboard exports (`luak.lane.leaderboard.v2` schema) include:

- `counts_in_leaderboard` — true only if the row contributed to the current composite
- `nc_rate`, `model_failure_rate`, `completion_rate` — so you can tell "model never ran" from "model failed"
- `reliability_score`, `confidence`, `sample_adequate`, `provisional` — sample-quality signals
- a `note` field summarizing data quality (e.g. "zero composite — no scoring-eligible runs counted", "75% NC (provider/network/judge outages)")
- top-level `honesty_notes` explaining what was filtered and what is provisional

Drilldown exports add `counts_toward_leaderboard`, `is_pre_fix_historical`, and `exclusion_reasons` per run so a consumer can route each bundle to the right interpretation.

**Read order for current trust.** If you want the current Luak verdict for a model:

1. Use the UI (lane tab) or the `/api/leaderboard?task_families=<lane>` endpoint.
2. Use the lane diagnostic: `node scripts/lane-diagnostic.mjs <lane>` — it prints leaderboard-equivalent averages with NC excluded and flags pre-fix bundles still in scope.
3. Use the lane export (JSON/CSV) — the `note` and `counts_in_leaderboard` columns tell you exactly what each row means.

Reading raw signed bundle files directly is fine for audit (verifying what a run produced) but is not the right surface for "what does Luak currently say about this model."

## Security and Trust Model

Luak assumes prompt injection is a system problem, not just a model problem.

That means:

- task text can be malicious
- repo files can be malicious
- diffs and logs can be malicious
- model outputs can be malicious
- review-layer outputs can be malicious

The system therefore maintains explicit trust boundaries:

Trusted:

- deterministic judge results
- hidden oracle data
- benchmark provenance: source, public/private status, oracle visibility, gold-solution visibility, contamination risk, and known scoring limitations
- integrity checks
- system metadata

Untrusted:

- task repo files
- diffs
- logs
- test output
- agent output
- review model output

Recent hardening added a Velum-style review defense layer:

- review input sanitization before any model-assisted review call
- prompt hardening that tells review models they are not authoritative
- strict JSON-only output validation
- advisory-only review status and disagreement signals
- review security telemetry in bundles, summaries, and receipts

Review models may summarize, flag concerns, or recommend reruns. They may not override scoring, mutate pass/fail, or rewrite authoritative evidence.

## Review Layer

Luak supports optional review layers such as:

- Second Opinion
- QC Review
- Howa Truthfulness Review (advisory)

These are intentionally non-authoritative.

Their role is to help surface:

- suspicious patterns
- possible false passes or false fails
- flaky-looking outcomes
- reasons a human may want to inspect a run

They do not change:

- deterministic pass/fail
- score breakdown
- hidden/public test outcomes
- integrity verdicts
- bundle evidence

Review inputs are sanitized and structured before model calls. Review outputs are schema-validated and fail closed on malformed output.

### Howa Truthfulness Review

Howa is the ecosystem's truthfulness / lie-detection product. It is wired into
Luak as a **third advisory review channel** that runs the *same sanitized
evidence summary* through a truthfulness-focused reviewer — looking for silent
failures, fabricated success, and self-verification claims the timeline/diff
don't support. It is advisory only: like Second Opinion and QC Review it never
changes the deterministic verdict, and it runs on the injection-scanned,
redacted evidence (blocked entirely if that evidence carries prompt-injection
indicators).

Enable it globally without threading a flag through every call site:

- `LUAK_HOWA_REVIEW=1` — turn the channel on (legacy alias `CRUCIBLE_HOWA_REVIEW`)
- `LUAK_HOWA_REVIEW_PROVIDER` / `LUAK_HOWA_REVIEW_MODEL` — override the reviewer
  (defaults to the configured judge model)

The result appears on each run as `review.howaReview` and is surfaced by
`/api/runs` as `howa_review_status` plus a `howa_disagreement` advisory signal
(also folded into the aggregate `disagreement` flag).

### Default Judge Model

The advisory model judge defaults to **OpenRouter `xiaomi/mimo-v2.5-pro`**. Configure via `OPENROUTER_API_KEY`. Override with:

- `LUAK_JUDGE_PROVIDER` — provider id (default `openrouter`)
- `LUAK_JUDGE_MODEL` — model id (default `xiaomi/mimo-v2.5-pro`)

Legacy aliases `CRUCIBLE_JUDGE_PROVIDER` / `CRUCIBLE_JUDGE_MODEL` are still honored; prefer the `LUAK_*` names for new setups.

Fallback: when the configured judge provider is unreachable, only the deterministic scorer runs and the model judge is recorded as `judge_usage.kind = "skipped"`. The run is never silently re-routed to a different model.

Each bundle records both costs separately:

- `usage` — tested-model token / cost spend
- `judge_usage` — judge-model token / cost spend, with `kind: "deterministic" | "model" | "skipped"`

## QA Harness

The QA harness walks every tab/lane, runs every test through the full pipeline, and emits a machine-readable report agents like Ricky and Ptah can consume.

```bash
npm run harness                                # offline mock adapter, every lane
npm run harness -- --tab personality           # only the Personality lane
npm run harness -- --task personality-002      # one test by id
npm run harness -- --live                      # use the configured judge model
                                               # (OpenRouter MiMo by default;
                                               #  needs OPENROUTER_API_KEY)
npm run harness -- --enable-judge              # also run the model judge layer
```

Per-test it records: `manifest_loaded`, `request_sent`, `response_received`, `judge_ran`, `bundle_stored`, `ui_summary_well_formed`, `drilldown_evidence_present`, plus tested-model and judge-model token + cost split. The report is written to `runs/_harness_report_<timestamp>.json`.

Exit codes: `0` clean, `1` test failures only, `2` pipeline breakage, `3` conversational task incomplete (verdict neither PASS nor FAIL).

## Adapters and Providers

Luak is meant to evaluate models through adapters rather than binding itself to a single provider.

The repo already supports a provider-first flow through adapters and exposes provider/model metadata in the bundle and API. Supported adapters/providers currently include:

- `ollama`
- `anthropic`
- `openai`
- `openrouter`
- `openclaw`
- `claudecode`
- `peh`
- `grimoire-cc`
- `grimoire-codex`
- `minimax`
- `zai`
- `google`

That means you can compare:

- local setups
- hosted APIs
- agent wrappers
- different execution systems

without losing track of who actually ran the task and under what identity.

### Current Release Certification Scope

The current release candidate is not unqualified `FULL_RELEASE_READY`.
Certification is scoped to the evidence archived in `docs/RELEASE_READINESS.md`.

Certified release-target models:

- OpenRouter / `deepseek/deepseek-v4-pro`
- OpenRouter / `xiaomi/mimo-v2.5-pro`
- Ollama / `qwen3.5:9b`

Other providers and models may appear in the UI or adapter registry, but
visibility does not mean release certification. Those routes remain
uncertified unless a matching real-provider report is archived. Repo-mode
certification is representative smoke coverage only, not proof that every
repo task family has been live-certified. Automated UI-shape checks and the
manual browser UI checklist pass for the scoped target set, but this remains
`RELEASE_SCOPED_TO_CERTIFIED_TARGETS`, not `FULL_RELEASE_READY`.

### Vision Capability-Certified (separate from the release-certification scope above)

Vision is currently the one **capability** that has been formally
promoted under Luak's doctrine-gated capability-certification
track (`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`). This is
**separate from** the general release-certification scope above:

- Vision capability certification is based on Luak's 15-test
  Vision suite run across **three independent route families**
  (MiMo, GPT-5, Anthropic) with aggregate pass rate ≥ 80% and no
  disallowed recurring measurement attribution.
- It says the **capability evaluation pipeline** works correctly
  and that real models pass it. It does **not** certify any one
  model as universally release-ready.
- It does **not** affect the leaderboard composite
  (`TAB_CONFIG.vision.scoreFamilies = []`).
- It does **not** mutate `reports/model-certification/certified-models.json`
  or `MODEL_CERTIFICATION.models[].tier`. Those files remain
  byte-identical to their pre-promotion state. The release-
  certification scope above is unchanged by Vision promotion.
- Promotion is operator-explicit (signed confirmation phrase at
  `POST /api/capabilities/vision/promote`). An immutable receipt
  lives under `reports/capability-promotions/vision/`. Local
  state lives in `data/capability-certifications.json` and is
  gitignored — fresh checkouts have no capability-promoted state
  and render the chip as `EXPERIMENTAL` by default.
- Full plain-English summary, audit trail, and verification
  commands: [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md).

Capability badges other than Vision (Roleplay, tool-calling, etc.)
remain experimental until they reach the same level of
multi-family evidence under the same doctrine.

## Methodology and Trust Docs

Luak is being documented as a public audit and evidence-inspection system rather than only a codebase. Start here:

- [docs/methodology.md](docs/methodology.md)
- [docs/scoring.md](docs/scoring.md)
- [docs/SCORING_FIELDS.md](docs/SCORING_FIELDS.md) — composite vs correctness vs efficiency credit; what each `score.*` field means; why `total_percent` may not match the binary correctness anchors.
- [docs/versioning.md](docs/versioning.md)
- [docs/reproducibility.md](docs/reproducibility.md)
- [docs/CAPABILITY_CERTIFICATION_DOCTRINE.md](docs/CAPABILITY_CERTIFICATION_DOCTRINE.md) — capability-specific certification track (separate from general model certification).
- [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md) — plain-English audit summary for Vision Capability-Certified (the one currently-promoted capability).
- [docs/MULTIMODAL_VISION_SUITE.md](docs/MULTIMODAL_VISION_SUITE.md) — Vision suite design, 15-test list, scorers, fixture provenance.

## UI and API

Luak includes a local API and browser UI for inspecting runs, receipts, bundles, quarantined evidence, and comparisons.

The API exposes:

- tasks
- suites
- adapters
- providers
- runs
- summaries
- receipts
- stats
- compare views
- leaderboard quarantine metadata

The UI is there to make evidence inspection practical, but the trust model does not depend on the UI. The source of record remains the bundle and the deterministic judge output.

## Install

Requirements:

- Node.js 20 or newer
