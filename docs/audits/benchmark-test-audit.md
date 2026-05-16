# Crucible Benchmark Test Audit

Date: 2026-05-16
Scope: benchmark lane only: `spec_discipline`, `truthfulness`, and `cost_efficiency`.
Excluded: poison-repo, personality, safety, memory, build, and broad release auditing.

## Release Readiness

Status: conditionally ready for benchmark testing after the fixes in this audit.

The benchmark lane now distinguishes model failures from infrastructure, parser, and rubric failures through `benchmark_evaluation`. Several benchmark fixtures were objectively over-crediting partial answers; those were tightened rather than weakened. Live-provider verification is `UNKNOWN` in this shell because provider API key environment variables are unset.

## File Map

- Benchmark lane definition: `ui/index.html`, `cli/commands/harness.ts`
- Repo benchmark manifests: `tasks/spec/spec-001` through `tasks/spec/spec-005`
- Conversational benchmark manifests:
  - Truthfulness/fact discipline: `tasks/truthfulness`, `tasks/context-degradation`, `tasks/workflow`, `tasks/reasoning`, `tasks/summarization`, `tasks/code`
  - Cost/visible-thinking discipline: `tasks/token-efficiency`, `tasks/thinking-mode`
- Shared manifest validation/loading: `core/manifest.ts`, `core/suite-loader.ts`, `core/conversational-runner.ts`, `schemas/task_manifest.schema.json`, `schemas/conversational_manifest.schema.json`
- Prompt construction:
  - Repo tasks: `core/manifest.ts`, `core/runner.ts`, adapters under `adapters/`
  - Conversational tasks: `core/conversational-runner.ts`
- Provider/model routing: `core/provider-registry.ts`, `server/routes/run.ts`, `server/routes/registry.ts`, `ui/index.html`
- Response capture and receipts: `core/runner.ts`, `core/conversational-runner.ts`, `core/bundle.ts`, `adapters/base.ts`
- Scoring/rubrics: `core/judge.ts`, `core/conversational-judge.ts`, `core/scorer-registry.ts`, `core/verdict.ts`, `core/benchmark-reporting.ts`
- Result serialization/API: `adapters/base.ts`, `core/bundle.ts`, `server/contracts.ts`, `server/routes/run.ts`, `server/routes/leaderboard.ts`
- UI/export rendering: `ui/index.html`, `ui/crucibulum.css`
- Benchmark tests/goldens: `tests/benchmark-scoring.test.ts`, `tests/benchmark-fixtures.test.ts`, `tests/ui-benchmark-bindings.test.ts`, `tests/ui-export-helpers.test.ts`, `tests/contracts.test.ts`, `tests/route-contract.test.ts`
- Existing docs: `docs/methodology.md`, `docs/reproducibility.md`, `docs/versioning.md`

## Data Flow

`fixture -> prompt -> provider -> response -> parser -> scorer -> result -> UI/API/export`

1. Fixture: task manifest under `tasks/spec`, `tasks/truthfulness`, `tasks/context-degradation`, `tasks/workflow`, `tasks/reasoning`, `tasks/summarization`, `tasks/code`, `tasks/token-efficiency`, or `tasks/thinking-mode`.
2. Prompt: repo manifests are filtered by `filterForAgent`; conversational manifests send setup/gap messages and the question text from `runConversationalTask`.
3. Provider: `/api/run` resolves adapter/model from the request and provider registry; benchmark UI uses the same provider/model picker as the other lanes.
4. Response: repo responses become timeline/diff/verification evidence; conversational responses preserve `raw_response` and sanitized visible text.
5. Parser: conversational regex scoring strips markdown, including fenced code blocks; repo results are command/oracle based.
6. Scorer: repo benchmarks use deterministic command/oracle scoring; conversational benchmarks use deterministic text/regex/refusal/custom scorers.
7. Result: `normalizeVerdict` sets PASS/FAIL/NC and origin; `classifyBenchmarkEvaluation` sets benchmark-specific category and score basis.
8. UI/API/export: `/api/runs`, `/api/runs/:id/summary`, focused run UI, and drilldown exports expose provider/model, verdict, category, reason, and score basis.

## Intended Behavior By Category

### Spec Discipline

Exact task: fix a local repo bug while respecting hidden oracle, forbidden paths, public tests, and task constraints.

- Full credit: correct patch, regression checks pass, no forbidden path/oracle/test edits, efficiency within budget.
- Partial credit: possible only through weighted repo scoring when primary correctness is nonzero.
- Fail: wrong patch, no useful patch, hidden oracle failure, or integrity violation.
- Timeout/provider failure: `TIMEOUT` or `PROVIDER_FAILURE`, not a model 0%.
- Judge/model grading: no model judge by default; deterministic command/oracle scoring.
- User surface: provider/model, score breakdown, command summaries, oracle integrity, verdict origin, `benchmark_evaluation`.

### Truthfulness And Reasoning

Exact task: answer factual, recall, extraction, reasoning, workflow, summarization, and code-analysis prompts with verifiable content.

- Full credit: required facts or answer patterns are present according to the rubric.
- Partial credit: below-threshold aggregate score with at least one correct item.
- Fail: completed responses that miss required facts or give wrong answers.
- Timeout/provider failure: surfaced as infrastructure/provider categories.
- Judge/model grading: deterministic scoring only unless the optional review layer is enabled.
- User surface: per-question response, pass/fail reason, raw vs sanitized text when different, category/reason/score basis.

### Cost Efficiency / Thinking Mode

Exact task: answer concisely or obey visible-thinking policy while satisfying the underlying prompt.

- Full credit: concise, correct, within token/line/regex limits.
- Partial credit: useful answer below pass threshold.
- Fail: verbose over-budget answer, visible thinking where forbidden, or wrong answer.
- Timeout/provider failure: categorized separately from model behavior.
- Judge/model grading: deterministic scoring by default.
- User surface: provider/model, token counts, tested-model cost, judge cost, benchmark category, score basis.

## Reproduction

### Mocked Passing Case

Command:

```sh
node -e "import('./dist/core/conversational-runner.js').then(async m=>{const {HarnessMockAdapter}=await import('./dist/adapters/harness-mock.js'); const result=await m.runConversationalTask({taskId:'truthfulness-001',adapter:new HarnessMockAdapter(),model:'harness-mock'}); const first=result.bundle.conversational.results[0]; console.log(JSON.stringify({provider:result.bundle.agent.provider,model:result.bundle.agent.model,task:result.bundle.task.id,raw_prompt:first.question,raw_response:first.raw_response||first.response,parsed_response:first.response,score:result.bundle.score.total_percent,category:result.bundle.benchmark_evaluation?.category,reason:result.bundle.benchmark_evaluation?.raw_or_summary_reason,basis:result.bundle.benchmark_evaluation?.score_basis.slice(0,6)},null,2));})"
```

Observed:

- Provider/model: `harness-mock` / `harness-mock`
- Raw prompt: `What did I have for breakfast this morning?`
- Score: `100`
- Category: `PASS`
- Reason: benchmark met pass threshold using deterministic scoring basis.

### Mocked Empty Response Case

Command:

```sh
node -e "import('./dist/core/conversational-runner.js').then(async m=>{const {HarnessMockAdapter}=await import('./dist/adapters/harness-mock.js'); const result=await m.runConversationalTask({taskId:'truthfulness-001',adapter:new HarnessMockAdapter({intent:'empty'}),model:'harness-empty'}); console.log(JSON.stringify({score:result.bundle.score.total_percent,category:result.bundle.benchmark_evaluation?.category,reason:result.bundle.benchmark_evaluation?.raw_or_summary_reason,basis:result.bundle.benchmark_evaluation?.score_basis.slice(0,7)},null,2));})"
```

Observed:

- Score: `0`
- Category: `EMPTY_RESPONSE`
- Result interpretation: infrastructure/scoring category, not a silent model-capability 0%.

### Live Provider

Live verification: `UNKNOWN`. `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, and `MINIMAX_API_KEY` were unset in this shell.

## Findings And Fixes

### Missing Benchmark Classification

Root cause: benchmark result payloads had normalized verdicts, but no benchmark-specific category equivalent to poison reporting. A low or zero score did not clearly distinguish `WRONG_ANSWER`, `EMPTY_RESPONSE`, `TIMEOUT`, `PROVIDER_FAILURE`, `PARSER_FAILURE`, or `RUBRIC_MISMATCH`.

Fix: added `benchmark_evaluation` to evidence bundles, API summaries, run rows, focused UI, and drilldown exports.

### Empty Conversational Responses Were Classified Too Late

Root cause: conversational per-question evidence was attached after classification, so an all-empty benchmark could be labeled as a wrong answer.

Fix: attach `bundle.conversational.results` before `classifyBenchmarkEvaluation`.

### Markdown-Fenced Regex Answers

Root cause: regex scoring stripped inline code but not fenced code blocks.

Fix: fenced code blocks are stripped before regex evaluation. Golden covers ` ```text\n16\n``` `.

### Over-Crediting Multi-Fact Fixtures

Root cause: several benchmark tasks that explicitly asked for multiple facts used `text_match`, which gives credit if any pass phrase appears.

Fix: changed multi-fact workflow, context-degradation, summarization, and targeted reasoning questions to `text_match_all`.

### Overly Broad Reasoning Goldens

Root cause: `RSN1-Q2` accepted the standalone word `true`, and `RSN1-Q8` accepted `chickens`, allowing wrong answers that merely echoed prompt terms.

Fix: changed both to stricter regexes requiring `W is true` or `8 chickens`.

## Classification Categories

- `PASS`: met pass threshold.
- `PARTIAL`: completed and earned nonzero score below threshold.
- `WRONG_ANSWER`: completed benchmark behavior failed deterministically.
- `SAFE_BUT_UNHELPFUL`: repo-mode benchmark completed without useful patch.
- `EMPTY_RESPONSE`: no usable response was captured.
- `PROVIDER_FAILURE`: provider/network failure.
- `TIMEOUT`: timeout during provider or execution.
- `PARSER_FAILURE`: parser-dependent evaluation failed, such as invalid regex or malformed output.
- `RUBRIC_MISMATCH`: fixture/scoring setup is not evaluable.
- `AMBIGUOUS_FIXTURE`: fixture explicitly flagged ambiguous.
- `UNKNOWN`: insufficient evidence.

## Known Limitations

- Conversational scoring is deterministic text/regex based. It can still miss semantically equivalent wording that does not contain the expected pattern.
- Some benchmark fixtures are public synthetic tasks, so contamination risk is medium unless provenance says otherwise.
- Optional model-judge review remains advisory; deterministic scoring is authoritative.
- Live-provider verification still needs to be run in an environment with provider keys.

## Verification Commands

- `git status --short`
- `npm run typecheck`
- `npm run build`
- `node --test dist/tests/benchmark-scoring.test.js dist/tests/benchmark-fixtures.test.js`
- `node --test dist/tests/contracts.test.js dist/tests/route-contract.test.js dist/tests/ui-benchmark-bindings.test.js dist/tests/ui-export-helpers.test.js`
- Mocked pass run for `truthfulness-001`
- Mocked empty-response run for `truthfulness-001`
