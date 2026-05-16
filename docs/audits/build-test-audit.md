# Crucible Build Test Audit

Date: 2026-05-16
Scope: Build lane only: repo-mode `orchestration` tasks.
Excluded: poison, benchmark, personality, safety, memory, and broad release auditing.

## Release Readiness

Status: conditionally ready for build testing after the fixes in this audit.

The Build lane now emits `build_evaluation` so low scores distinguish model behavior from provider, timeout, sandbox, parser, rubric, and pre-existing repo failures. Live-provider verification is `UNKNOWN` in this shell unless provider keys are available.

## File Map

- Lane definitions and provider/model selection: `ui/index.html`, `cli/commands/harness.ts`
- Build fixtures: `tasks/orchestration/coord-001` through `tasks/orchestration/coord-004`
- Hidden oracles: `oracles/coord-001.oracle.json` through `oracles/coord-004.oracle.json`
- Prompt construction and manifest filtering: `core/manifest.ts`, `core/runner.ts`
- Agent execution and response capture: `core/runner.ts`, adapters under `adapters/`
- Command execution and scoring: `core/judge.ts`, `core/verdict.ts`, `core/build-reporting.ts`
- Bundle serialization and verification: `adapters/base.ts`, `core/bundle.ts`, `schemas/evidence_bundle.schema.json`
- API routes and contracts: `server/routes/run.ts`, `server/contracts.ts`
- UI/export rendering: `ui/index.html`
- Build tests/goldens: `tests/build-reporting.test.ts`, `tests/build-fixtures.test.ts`, `tests/build-reporting-ui.test.ts`
- Docs: `docs/build-tests.md`, `docs/audits/build-test-audit.md`

## Data Flow

`fixture -> prompt -> provider -> response/actions -> diff -> command runner -> scorer -> result -> UI/API/export`

1. Fixture: `tasks/orchestration/*/manifest.json` points at a local repo and an oracle.
2. Prompt: `filterForAgent` exposes task title, description, entrypoints, constraints, and public verification while hiding oracle data.
3. Provider: `/api/run` or CLI resolves the selected provider/model through the shared adapter registry.
4. Response/actions: `runTask` captures adapter timeline, final diff, usage, and raw errors.
5. Command runner: `core/judge.ts` runs public and hidden Node test commands with cwd set to the task workspace, 60s command timeout, and captured stdout/stderr.
6. Scorer: correctness, regression, integrity, and efficiency are weighted into the bundle score.
7. Verdict: `normalizeVerdict` sets PASS/FAIL/NC and failure origin.
8. Result: `classifyBuildEvaluation` attaches category, reason, score basis, and model-vs-infra flags.
9. UI/API/export: `/api/runs`, `/api/runs/:id/summary`, focused run UI, and drilldown exports expose provider/model, command evidence, category, reason, and score basis.

## Intended Behavior By Fixture

### `coord-001`

- Task: duplicate email registration succeeds despite async validation.
- Expected repo change: await `validate(email)` in `src/users/register.js`.
- Expected command: `node tests/register.test.js`; hidden oracle `node tests/oracle.test.js`.
- Pass: duplicate and invalid registrations are rejected, public and hidden tests pass, no forbidden edits.
- Partial: nonzero verification credit below threshold without integrity failure.
- Fail: no edit, wrong file, regex/store decoy edit, public/hidden test failure, or test/oracle modification.
- Infra: provider failure, timeout, empty response, sandbox/path failure, parser/rubric mismatch, or pre-agent command failure.

### `coord-002`

- Task: receipts show lower totals because order pricing double-applies discount.
- Expected repo change: correct final total calculation in pricing while preserving intake, inventory, and receipt flow.
- Expected command: `node tests/orders.test.js`; hidden oracle `node tests/oracle.test.js`.
- Pass: receipt totals include subtotal and tax correctly, public and hidden tests pass, no forbidden edits.
- Partial: useful data-flow fix earns nonzero score but fails threshold.
- Fail: wrong formula, wrong module-only workaround, no edit, public/hidden test failure, or integrity violation.
- Infra: same Build-lane infra categories as above.

### `coord-003`

- Task: cache returns stale or corrupt data.
- Expected repo changes: fix TTL boundary in `src/cache/store.js` and cache parsed data in `src/cache/fetcher.js`.
- Expected command: `node tests/cache.test.js`; hidden oracle `node tests/oracle.test.js`.
- Pass: both interacting bugs are fixed, public and hidden tests pass, no forbidden edits.
- Partial: one useful fix with nonzero score but hidden oracle still fails.
- Fail: single-bug fix scored as insufficient, middleware-only decoy edit, no edit, test/oracle modification.
- Infra: same Build-lane infra categories as above.

### `coord-004`

- Task: search is correct but too slow for production-sized data.
- Expected repo change: remove the O(n^2) hotspot in `src/search/engine.js` while preserving correctness.
- Expected command: `node tests/search.test.js`; hidden oracle `node tests/oracle.test.js`.
- Pass: optimized implementation passes public and hidden performance/correctness checks with no forbidden edits.
- Partial: useful optimization below threshold.
- Fail: correctness regression, test edit, no edit, or unrelated optimization that does not pass oracle.
- Infra: same Build-lane infra categories as above.

## Findings And Fixes

### Missing Build-Specific Classification

Root cause: Build-lane bundles had normalized verdicts and score breakdowns, but no build-specific category. A 0% could mean no edit, wrong edit, provider empty response, timeout, sandbox failure, pre-existing fixture failure, or scorer mismatch.

Fix: added `build_evaluation` to evidence bundles, schema, bundle construction/loading, API summaries, run rows, focused UI, and drilldown exports.

### Pre-Existing Repo Failures Could Look Like Model Failures

Root cause: command text that clearly indicated baseline/pre-agent failure could still flow through as a low build score.

Fix: `classifyBuildEvaluation` maps baseline/pre-agent command failures to `PREEXISTING_REPO_FAILURE` with `failure_is_infrastructure=true` and `reflects_model_capability=false`.

### No-Edit And Wrong-Edit Paths Were Not Explicit

Root cause: build scoring already had diff and diagnosis evidence, but reporting did not name `NO_EDIT` or `WRONG_EDIT`.

Fix: deterministic goldens now cover no edit, wrong edit, build command failure, test failure, sandbox failure, timeout, provider empty response, pre-existing repo failure, and passing build behavior.

### Fixture Validity Was Not Directly Guarded

Root cause: orchestration fixtures had manifests and oracles, but no dedicated audit test proving commands, oracles, scoring weights, and edit constraints stayed aligned.

Fix: added fixture tests that validate repo paths, public and hidden commands, oracle IDs, weight sums, pass thresholds, no test/oracle answer leakage, and integrity checks.

## Reporting Requirements

Build results must surface:

- provider and model actually used
- command run and exit code in `score_basis`
- failure category and reason
- score basis and weighted score breakdown
- artifact/receipt identity through bundle ID/hash and run receipt routes
- whether the result reflects model capability or infrastructure/scoring failure

The UI/API/export path now carries `build_evaluation` alongside existing lane-specific evaluation fields.

## Cross-Lane Consistency

The Build tab uses `taskFamilies:['orchestration']` in `ui/index.html` and `cli/commands/harness.ts`. Provider/model selection is shared with the other lanes through the same registry and run routes. No Build-only provider list divergence was found.

## Known Limitations

- `verification.build_command` is null in current fixtures; public and hidden Node tests are the authoritative build/check commands.
- The fixture repos have no install step. Adding dependencies later must add explicit setup/install validation.
- Synthetic fixtures have medium contamination risk.
- Live-provider readiness is unknown until a keyed environment runs a live Build-lane task.

## Verification Commands

- `git status --short`
- `npm run typecheck`
- `npm run build`
- `node --test dist/tests/build-reporting.test.js dist/tests/build-fixtures.test.js dist/tests/build-reporting-ui.test.js`
- one mocked Build-lane run for `coord-001` showing `build_evaluation`
- `npm test` if runtime is reasonable

Observed mocked run:

```sh
node -e "import('./dist/core/runner.js').then(async ({runTask})=>{const {HarnessMockAdapter}=await import('./dist/adapters/harness-mock.js'); const adapter=new HarnessMockAdapter(); await adapter.init({}); const result=await runTask({taskId:'coord-001',adapter,model:'harness-mock'}); console.log(JSON.stringify({provider:result.bundle.agent.provider,model:result.bundle.agent.model,task:result.bundle.task.id,score:result.bundle.score.total_percent,category:result.bundle.build_evaluation?.category,reason:result.bundle.build_evaluation?.raw_or_summary_reason,basis:result.bundle.build_evaluation?.score_basis?.slice(0,8)},null,2));})"
```

Result: provider/model `local` / `harness-mock`, task `coord-001`, score `0`, category `NO_EDIT`, reason `Model completed the run but did not meet the pass threshold`, score basis included `family=orchestration`, `task=coord-001`, `provider=local`, `model=harness-mock`, `verdict=FAIL:MODEL:low_score`, `score=0%`, `correctness=0%`, and `regression=0%`.

Live provider verification: `UNKNOWN`; no `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, or `MINIMAX_API_KEY` was present in this shell.
