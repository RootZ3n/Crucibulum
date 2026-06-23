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

1|# Luak
2|
3|Luak turns model and agent trial outputs into auditable scoreboards, receipts, and comparison views.
4|
5|It helps operators inspect observed behavior by task family, provider, model, adapter, and run evidence. Luak is not a safety certification, not a universal model ranking, and not a replacement for Colosseum-style trial generation.
6|
7|In the current release sequence, Luak is the benchmark, scoreboard, and evidence-viewer layer. It can still run local harness flows for smoke testing and development, but its public role is to make existing run evidence understandable without overstating what the evidence can support.
8|
9|## How Luak Fits With The Other Tools
10|
11|- **Colosseum** generates trial runs and receipts. Use it as the proving ground when you need to create fresh trial evidence.
12|- **Luak** views, compares, scores, and explains run evidence. Use it to inspect receipts, compare models/providers/adapters, and understand why a run is or is not ranked.
13|- **Verum** is adversarial and probing-oriented. Its outputs can be normalized into Luak score/evidence views when the integration path is used.
14|- **Aedis** is governed build orchestration. It can drive controlled workflows that later produce evidence for inspection.
15|- **Peh Public** is the broader user-facing AI control surface. Luak is one evidence and scoreboard layer inside that wider release path.
16|- **Crucibulum** appears in environment variables, schemas, and API names as the older/internal protocol name for Luak-compatible run and score exchange. Public docs should treat it as compatibility naming, not a separate public product unless the project is split later.
17|
18|## What Luak Is / Is Not
19|
20|Luak is:
21|
22|- a local scoreboard and evidence viewer
23|- a lane-scoped comparison UI
24|- a provenance and receipt inspection layer
25|- an observed-behavior comparison tool
26|- a way to preserve adapter/provider/model identity while reviewing results
27|
28|Luak is not:
29|
30|- a universal model benchmark
31|- a safety certification
32|- proof that a model is safe
33|- a replacement for external audits
34|- a guarantee of local or cloud isolation
35|- the primary trial-generation harness when Colosseum owns that role
36|
37|## Public Leaderboard Trust
38|
39|Default public leaderboard views rank only verified eligible evidence bundles.
40|
41|Tampered, forged, legacy, unsigned, unauthenticated, mock/demo, malformed, or otherwise unverified bundles are quarantined and are not ranked. Quarantined evidence may be inspected through safe metadata views such as `/api/leaderboard/quarantine`, but it is labeled `NOT RANKED` and does not influence default scores.
42|
43|Local historical runs may exist in `runs/`. They are local state, ignored by git, and not treated as public leaderboard evidence unless they pass the current eligibility gate.
44|
45|## First-Run Mental Model
46|
47|A fresh checkout does not ship with public ranking data. The offline harness path uses the mock adapter for pipeline validation only; those results are deliberately quarantined from public rankings as mock/demo evidence. Live or imported evidence must be verified before it can appear in the default public leaderboard.
48|
49|Current desktop and mobile screenshots are in `docs/screenshots/`. Additional GIFs are planned before the final public announcement.
50|
51|## Evidence Model
52|
53|Luak is built around a narrow question: what did this model or agent do under a defined task, adapter, provider, and scoring policy, and what evidence supports that observation?
54|
55|Luak does not grade based on style, self-report, chain-of-thought, or polished explanations. It grades based on observable state:
56|
57|- what files changed
58|- what tests passed or failed
59|- what integrity rules were violated
60|- how much time and step budget were used
61|- what the deterministic judge can verify from the workspace
62|
63|The core trust model is simple:
64|
65|- the agent never sees the oracle
66|- the deterministic judge is authoritative
67|- hidden checks and integrity checks drive scoring
68|- review models are advisory only
69|- bundles are signed and auditable
70|
71|## What Luak Does
72|
73|Luak ingests or creates model/agent run evidence, applies deterministic scoring where configured, and turns that evidence into local scoreboards, receipts, and comparison views.
74|
75|In practice, that means it can:
76|
77|- inspect run bundles and receipts
78|- compare models across task families and lanes
79|- show why evidence is eligible or quarantined
80|- run local smoke tasks against a model when needed
81|- run a local suite for development and regression checks
82|- compare multiple models across repeated runs
83|- score outcomes using hidden and public checks
84|- enforce integrity constraints like forbidden-path edits and anti-cheat patterns
85|- produce replayable, hash-verified evidence bundles
86|- expose results through a local API and UI
87|- add optional advisory review layers without weakening deterministic authority
88|
89|## What Problem It Solves
90|
91|A lot of model evaluation still collapses into one of these failure modes:
92|
93|- benchmarks that reward explanation instead of execution
94|- public-only tasks that are easy to overfit
95|- systems that trust the agent's own story about what happened
96|- leaderboards that show scores without evidence
97|- review layers that quietly blur interpretation with authority
98|
99|Luak is designed against that.
100|
101|It treats evaluation as an evidence problem. The key question is not "did the model say the right thing?" It is "what behavior was observed, under what conditions, and can the evidence be inspected independently?"
102|
103|## How It Works
104|
105|At a high level, Luak follows this pipeline:
106|
107|1. Load a task manifest.
108|2. Filter the manifest for the agent so the rubric and oracle stay hidden.
109|3. Create an isolated workspace from the task repo.
110|4. Execute the selected adapter/model in that workspace.
111|5. Record timeline and filesystem evidence.
112|6. Collect the diff.
113|7. Run integrity and security checks.
114|8. Judge the outcome deterministically with oracle-backed checks.
115|9. Build a signed evidence bundle.
116|10. Optionally run advisory review layers on sanitized evidence only.
117|
118|The implementation is centered on a three-box model:
119|
120|- `Runner`: orchestration, workspace setup, adapter execution, bundle assembly
121|- `Observer`: timeline and file activity capture
122|- `Judge`: deterministic scoring from evidence, oracle checks, and integrity rules
123|
124|The principle behind the system is explicit in the code:
125|
126|- score is based on observable state transitions
127|- narration is not trusted
128|- the deterministic judge is the authoritative scoring source for configured checks
129|
130|## Benchmark Coverage
131|
132|The current repo contains both repo-execution tasks and conversational tasks.
133|
134|Repo task families:
135|
136|- `poison_localization`
137|- `spec_discipline`
138|- `orchestration`
139|
140|Conversational task families currently present in the corpus:
141|
142|- `identity`
143|- `truthfulness`
144|- `classification`
145|- `code`
146|- `workflow`
147|- `instruction-obedience`
148|- `personality`
149|- `prompt-sensitivity`
150|- `role-stress`
151|- `context-degradation`
152|- `reasoning`
153|- `summarization`
154|- `thinking-mode`
155|- `token-efficiency`
156|
157|This means Luak can inspect both execution behavior and chat behavior. The current taxonomy is release-candidate level and versioned, but it should still be cited with the repository commit, task IDs, and scoring policy used for a given comparison. The test corpus is lightweight by design (intentional minimum for bootstrap); use `npm run oracle:hash -- --write` after adding oracles to register them in the corpus.
158|
159|### Experimental targets
160|
161|Some models are wired up for **experimental benchmarking only** — never as a
162|default, the judge, or a normal routing target, and always excluded from the
163|leaderboard and capability certification. OpenRouter **MiniMax-M3** is the first
164|such target: run `npm run bench:minimax-m3 -- --model minimax-m3 --smoke-only`
165|to gate it, or see [`docs/MINIMAX_M3_EXPERIMENTAL.md`](docs/MINIMAX_M3_EXPERIMENTAL.md)
166|for the full cost-capped comparison against the MiMo v2.5 family.
167|
168|## Scoring Model
169|
170|Luak judges runs in a fixed order:
171|
172|1. Integrity
173|2. Correctness
174|3. Regression
175|4. Efficiency
176|
177|This ordering matters.
178|
179|Integrity runs first because some failures should hard-fail the run regardless of downstream test outcomes. Examples include:
180|
181|- forbidden path edits
182|- anti-cheat patterns
183|- integrity-rule violations from the oracle
184|
185|Correctness and regression are then judged using hidden and public checks. Efficiency measures how expensive the run was relative to the task budget.
186|
187|The result is a structured score with:
188|
189|- total score
190|- score breakdown
191|- pass/fail
192|- pass threshold
193|- integrity violation count
194|- failure taxonomy
195|
196|Public API and leaderboard scores are expressed as `0-100` percentages.
197|
198|Internal bundles currently retain `0-1` fractional totals for backward compatibility, but they now also include explicit percent mirrors and a score-scale marker. That distinction is temporary and documented in [docs/scoring.md](docs/scoring.md).
199|
200|## Evidence and Bundles
201|
202|Every run produces an evidence bundle. The bundle is the core artifact of the system.
203|
204|A bundle contains:
205|
206|- task identity and manifest hash
207|- target model, provider, and adapter
208|- environment metadata
209|- timeline of observed actions
210|- diff evidence
211|- security metadata
212|- verification results
213|- deterministic score
214|- usage and cost estimates
215|- trust metadata
216|- diagnosis metadata
217|- optional advisory review results
218|
219|Bundles are hash-signed so the result can be verified later. The API also produces structured summaries for downstream consumers.
220|
221|This is important because Luak is not just trying to emit a score. It is trying to emit a score with an audit trail.
222|
223|## Bundle Immutability and Scoring Honesty
224|
225|Luak separates "what happened on this run" from "what the current leaderboard says about a model." Both are honest, but they answer different questions, and reading one as the other is the most common way to misinterpret a Luak result.
226|
227|**Signed bundles are immutable evidence.** Once a run is written to `runs/<bundle_id>.json` and hash-signed, the file is not rewritten — not when scoring rules change, not when judges are upgraded, not when bugs are fixed. The bundle records what the run produced *at the moment it produced it*. Tampering breaks the hash check; the trust layer marks tampered bundles as not ranked.
228|
229|**Some older bundles carry historical stored scores.** Luak's scoring discipline tightened during the May 2026 trust audit (see `tests/safety-scoring.test.ts`, `tests/lane-scoring.test.ts`). Bundles written before that audit may show a stored `score.total` that included regression / integrity / efficiency credit even when correctness was zero. Those numbers are correct as a record of what the *pre-audit* formula produced. They are not current trust claims.
230|
231|**The leaderboard, UI warnings, recommendation cards, diagnostics, and exports all use the current trust rules.** Specifically:
232|
233|- The backend leaderboard composite excludes NC bundles (provider / network / judge / test outages) via `verdict.countsTowardModelScore`. A model that never actually ran does not get a capability score.
234|- The repo-mode and conversational score formulas gate secondary credit on non-zero correctness. A run that produced no correct output cannot float to 15–60% on R/I/E defaults.
235|- The UI's lane scope banner surfaces `PROVISIONAL · n=<x>`, `ALL NOT-COMPLETE`, `<x>% NC`, `ALL RUNS FAILED`, `<x>% INFRA`, and `<n> HISTORICAL` chips when the conditions are met.
236|- The bundle detail panel shows a `STORED HISTORICAL SCORE` banner when a bundle predates current scoring discipline, and a `NOT COUNTED TOWARD LEADERBOARD` banner when the verdict excludes it from the composite.
237|- Recommendation cards (Best Overall, Best Value, Fastest Usable) refuse to crown a model with zero composite or zero pass rate. Risky / Avoid is intentionally the opposite — it surfaces failed or invalid models so users see them.
238|
239|**NC, provider, judge, and test failures stay visible as evidence.** They are not deleted, they are not hidden, and they do not vanish from the run history. They are excluded from *capability averages* because they did not measure the model. They remain counted in `nc_rate`, `failed_provider`, `failed_judge`, and the failure taxonomy.
240|
241|**Raw `score.total` is historical stored data.** A bundle's `score.total` is what the scoring formula produced when the bundle was written. For a current-discipline interpretation, read the leaderboard endpoint or the UI — both recompute against current rules and exclude bundles that should not count. Do not treat `score.total` from a raw bundle file as the current Luak trust claim for a model.
242|
243|**JSON and CSV exports carry honesty metadata.** Lane leaderboard exports (`luak.lane.leaderboard.v2` schema) include:
244|
245|- `counts_in_leaderboard` — true only if the row contributed to the current composite
246|- `nc_rate`, `model_failure_rate`, `completion_rate` — so you can tell "model never ran" from "model failed"
247|- `reliability_score`, `confidence`, `sample_adequate`, `provisional` — sample-quality signals
248|- a `note` field summarizing data quality (e.g. "zero composite — no scoring-eligible runs counted", "75% NC (provider/network/judge outages)")
249|- top-level `honesty_notes` explaining what was filtered and what is provisional
250|
251|Drilldown exports add `counts_toward_leaderboard`, `is_pre_fix_historical`, and `exclusion_reasons` per run so a consumer can route each bundle to the right interpretation.
252|
253|**Read order for current trust.** If you want the current Luak verdict for a model:
254|
255|1. Use the UI (lane tab) or the `/api/leaderboard?task_families=<lane>` endpoint.
256|2. Use the lane diagnostic: `node scripts/lane-diagnostic.mjs <lane>` — it prints leaderboard-equivalent averages with NC excluded and flags pre-fix bundles still in scope.
257|3. Use the lane export (JSON/CSV) — the `note` and `counts_in_leaderboard` columns tell you exactly what each row means.
258|
259|Reading raw signed bundle files directly is fine for audit (verifying what a run produced) but is not the right surface for "what does Luak currently say about this model."
260|
261|## Security and Trust Model
262|
263|Luak assumes prompt injection is a system problem, not just a model problem.
264|
265|That means:
266|
267|- task text can be malicious
268|- repo files can be malicious
269|- diffs and logs can be malicious
270|- model outputs can be malicious
271|- review-layer outputs can be malicious
272|
273|The system therefore maintains explicit trust boundaries:
274|
275|Trusted:
276|
277|- deterministic judge results
278|- hidden oracle data
279|- benchmark provenance: source, public/private status, oracle visibility, gold-solution visibility, contamination risk, and known scoring limitations
280|- integrity checks
281|- system metadata
282|
283|Untrusted:
284|
285|- task repo files
286|- diffs
287|- logs
288|- test output
289|- agent output
290|- review model output
291|
292|Recent hardening added a Velum-style review defense layer:
293|
294|- review input sanitization before any model-assisted review call
295|- prompt hardening that tells review models they are not authoritative
296|- strict JSON-only output validation
297|- advisory-only review status and disagreement signals
298|- review security telemetry in bundles, summaries, and receipts
299|
300|Review models may summarize, flag concerns, or recommend reruns. They may not override scoring, mutate pass/fail, or rewrite authoritative evidence.
301|
302|## Review Layer
303|
304|Luak supports optional review layers such as:
305|
306|- Second Opinion
307|- QC Review
308|- Howa Truthfulness Review (advisory)
309|
310|These are intentionally non-authoritative.
311|
312|Their role is to help surface:
313|
314|- suspicious patterns
315|- possible false passes or false fails
316|- flaky-looking outcomes
317|- reasons a human may want to inspect a run
318|
319|They do not change:
320|
321|- deterministic pass/fail
322|- score breakdown
323|- hidden/public test outcomes
324|- integrity verdicts
325|- bundle evidence
326|
327|Review inputs are sanitized and structured before model calls. Review outputs are schema-validated and fail closed on malformed output.
328|
329|### Howa Truthfulness Review
330|
331|Howa is the ecosystem's truthfulness / lie-detection product. It is wired into
332|Luak as a **third advisory review channel** that runs the *same sanitized
333|evidence summary* through a truthfulness-focused reviewer — looking for silent
334|failures, fabricated success, and self-verification claims the timeline/diff
335|don't support. It is advisory only: like Second Opinion and QC Review it never
336|changes the deterministic verdict, and it runs on the injection-scanned,
337|redacted evidence (blocked entirely if that evidence carries prompt-injection
338|indicators).
339|
340|Enable it globally without threading a flag through every call site:
341|
342|- `LUAK_HOWA_REVIEW=1` — turn the channel on (legacy alias `CRUCIBLE_HOWA_REVIEW`)
343|- `LUAK_HOWA_REVIEW_PROVIDER` / `LUAK_HOWA_REVIEW_MODEL` — override the reviewer
344|  (defaults to the configured judge model)
345|
346|The result appears on each run as `review.howaReview` and is surfaced by
347|`/api/runs` as `howa_review_status` plus a `howa_disagreement` advisory signal
348|(also folded into the aggregate `disagreement` flag).
349|
350|### Default Judge Model
351|
352|The advisory model judge defaults to **OpenRouter `xiaomi/mimo-v2.5-pro`**. Configure via `OPENROUTER_API_KEY`. Override with:
353|
354|- `LUAK_JUDGE_PROVIDER` — provider id (default `openrouter`)
355|- `LUAK_JUDGE_MODEL` — model id (default `xiaomi/mimo-v2.5-pro`)
356|
357|Legacy aliases `CRUCIBLE_JUDGE_PROVIDER` / `CRUCIBLE_JUDGE_MODEL` are still honored; prefer the `LUAK_*` names for new setups.
358|
359|Fallback: when the configured judge provider is unreachable, only the deterministic scorer runs and the model judge is recorded as `judge_usage.kind = "skipped"`. The run is never silently re-routed to a different model.
360|
361|Each bundle records both costs separately:
362|
363|- `usage` — tested-model token / cost spend
364|- `judge_usage` — judge-model token / cost spend, with `kind: "deterministic" | "model" | "skipped"`
365|
366|## QA Harness
367|
368|The QA harness walks every tab/lane, runs every test through the full pipeline, and emits a machine-readable report agents like Ricky and Ptah can consume.
369|
370|```bash
371|npm run harness                                # offline mock adapter, every lane
372|npm run harness -- --tab personality           # only the Personality lane
373|npm run harness -- --task personality-002      # one test by id
374|npm run harness -- --live                      # use the configured judge model
375|                                               # (OpenRouter MiMo by default;
376|                                               #  needs OPENROUTER_API_KEY)
377|npm run harness -- --enable-judge              # also run the model judge layer
378|```
379|
380|Per-test it records: `manifest_loaded`, `request_sent`, `response_received`, `judge_ran`, `bundle_stored`, `ui_summary_well_formed`, `drilldown_evidence_present`, plus tested-model and judge-model token + cost split. The report is written to `runs/_harness_report_<timestamp>.json`.
381|
382|Exit codes: `0` clean, `1` test failures only, `2` pipeline breakage, `3` conversational task incomplete (verdict neither PASS nor FAIL).
383|
384|## Adapters and Providers
385|
386|Luak is meant to evaluate models through adapters rather than binding itself to a single provider.
387|
388|The repo already supports a provider-first flow through adapters and exposes provider/model metadata in the bundle and API. Supported adapters/providers currently include:
389|
390|- `ollama`
391|- `anthropic`
392|- `openai`
393|- `openrouter`
394|- `openclaw`
395|- `claudecode`
396|- `peh`
397|- `grimoire-cc`
398|- `grimoire-codex`
399|- `minimax`
400|- `zai`
401|- `google`
402|
403|That means you can compare:
404|
405|- local setups
406|- hosted APIs
407|- agent wrappers
408|- different execution systems
409|
410|without losing track of who actually ran the task and under what identity.
411|
412|### Current Release Certification Scope
413|
414|The current release candidate is not unqualified `FULL_RELEASE_READY`.
415|Certification is scoped to the evidence archived in `docs/RELEASE_READINESS.md`.
416|
417|Certified release-target models:
418|
419|- OpenRouter / `deepseek/deepseek-v4-pro`
420|- OpenRouter / `xiaomi/mimo-v2.5-pro`
421|- Ollama / `qwen3.5:9b`
422|
423|Other providers and models may appear in the UI or adapter registry, but
424|visibility does not mean release certification. Those routes remain
425|uncertified unless a matching real-provider report is archived. Repo-mode
426|certification is representative smoke coverage only, not proof that every
427|repo task family has been live-certified. Automated UI-shape checks and the
428|manual browser UI checklist pass for the scoped target set, but this remains
429|`RELEASE_SCOPED_TO_CERTIFIED_TARGETS`, not `FULL_RELEASE_READY`.
430|
431|### Vision Capability-Certified (separate from the release-certification scope above)
432|
433|Vision is currently the one **capability** that has been formally
434|promoted under Luak's doctrine-gated capability-certification
435|track (`docs/CAPABILITY_CERTIFICATION_DOCTRINE.md`). This is
436|**separate from** the general release-certification scope above:
437|
438|- Vision capability certification is based on Luak's 15-test
439|  Vision suite run across **three independent route families**
440|  (MiMo, GPT-5, Anthropic) with aggregate pass rate ≥ 80% and no
441|  disallowed recurring measurement attribution.
442|- It says the **capability evaluation pipeline** works correctly
443|  and that real models pass it. It does **not** certify any one
444|  model as universally release-ready.
445|- It does **not** affect the leaderboard composite
446|  (`TAB_CONFIG.vision.scoreFamilies = []`).
447|- It does **not** mutate `reports/model-certification/certified-models.json`
448|  or `MODEL_CERTIFICATION.models[].tier`. Those files remain
449|  byte-identical to their pre-promotion state. The release-
450|  certification scope above is unchanged by Vision promotion.
451|- Promotion is operator-explicit (signed confirmation phrase at
452|  `POST /api/capabilities/vision/promote`). An immutable receipt
453|  lives under `reports/capability-promotions/vision/`. Local
454|  state lives in `data/capability-certifications.json` and is
455|  gitignored — fresh checkouts have no capability-promoted state
456|  and render the chip as `EXPERIMENTAL` by default.
457|- Full plain-English summary, audit trail, and verification
458|  commands: [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md).
459|
460|Capability badges other than Vision (Roleplay, tool-calling, etc.)
461|remain experimental until they reach the same level of
462|multi-family evidence under the same doctrine.
463|
464|## Methodology and Trust Docs
465|
466|Luak is being documented as a public audit and evidence-inspection system rather than only a codebase. Start here:
467|
468|- [docs/methodology.md](docs/methodology.md)
469|- [docs/scoring.md](docs/scoring.md)
470|- [docs/SCORING_FIELDS.md](docs/SCORING_FIELDS.md) — composite vs correctness vs efficiency credit; what each `score.*` field means; why `total_percent` may not match the binary correctness anchors.
471|- [docs/versioning.md](docs/versioning.md)
472|- [docs/reproducibility.md](docs/reproducibility.md)
473|- [docs/CAPABILITY_CERTIFICATION_DOCTRINE.md](docs/CAPABILITY_CERTIFICATION_DOCTRINE.md) — capability-specific certification track (separate from general model certification).
474|- [docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md](docs/VISION_CAPABILITY_CERTIFICATION_SUMMARY.md) — plain-English audit summary for Vision Capability-Certified (the one currently-promoted capability).
475|- [docs/MULTIMODAL_VISION_SUITE.md](docs/MULTIMODAL_VISION_SUITE.md) — Vision suite design, 15-test list, scorers, fixture provenance.
476|
477|## UI and API
478|
479|Luak includes a local API and browser UI for inspecting runs, receipts, bundles, quarantined evidence, and comparisons.
480|
481|The API exposes:
482|
483|- tasks
484|- suites
485|- adapters
486|- providers
487|- runs
488|- summaries
489|- receipts
490|- stats
491|- compare views
492|- leaderboard quarantine metadata
493|
494|The UI is there to make evidence inspection practical, but the trust model does not depend on the UI. The source of record remains the bundle and the deterministic judge output.
495|
496|## Install
497|
498|Requirements:
499|
500|- Node.js 20 or newer
501|