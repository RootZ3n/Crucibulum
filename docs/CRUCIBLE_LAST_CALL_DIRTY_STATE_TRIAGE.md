# Crucible Last-Call Dirty State Triage

Date: 2026-05-23

## Repository State Reviewed

- Branch: `master`
- Starting HEAD: `b29539f fix crucible runner lifecycle: unique run ids prevent state poisoning after interrupted streams`
- Dirty state was coherent in-flight evaluation backend work, not random local junk.
- Removed untracked generated artifact: root `json` live-run summary. It was not source and was not committed.
- Kept untracked fixture setup: `tasks/tool-calling/tool-006/repo/.crucibulum/setup.sh`.

## Classification

| File(s) | Classification | Decision |
| --- | --- | --- |
| `adapters/base.ts` | conversational-behavior eval work / evidence schema | Commit. Adds `currentQuestion` harness hint, `operational_trust` family, and optional `run_id` on evidence bundles. |
| `adapters/harness-mock.ts` | conversational-behavior eval work | Commit. Uses current question metadata for deterministic scorer-aware mock replies. No live provider calls. |
| `adapters/anthropic.ts`, `adapters/google.ts`, `adapters/minimax.ts`, `adapters/ollama.ts`, `adapters/openai.ts`, `adapters/openrouter.ts`, `adapters/squidley.ts`, `adapters/zai.ts` | adapter/runner work | Commit. Allows `DONE` without file edits only when task manifest sets `max_file_edits: 0`. Preserves evidence-backed no-edit task semantics. |
| `core/identity.ts` | runner/execution work | Commit. Centralizes collision-resistant run, suite, batch, and bundle id generation. |
| `core/bundle.ts` | runner/evidence work | Commit. Uses random-suffixed bundle ids, stores optional `run_id`, and prevents silent overwrite on collision. |
| `core/runner.ts`, `core/conversational-runner.ts` | runner/evidence work | Commit. Threads server `runId` into repo and conversational evidence bundles. |
| `server/routes/run.ts`, `server/routes/shared.ts` | Symposium/Model Operations integration | Commit. Lets `/api/runs/<runId>` hydrate by server run id as well as bundle id. |
| `server/routes/batch.ts`, `server/routes/suite.ts` | runner/execution work | Commit. Uses collision-resistant batch and suite ids. |
| `server/app.ts` | operational reliability | Commit. Disables browser caching for single-file UI shell so Model Operations sees current UI. |
| `cli/commands/harness.ts` | conversational-behavior eval work | Commit. Adds generic Trust lane for `operational_trust`. |
| `tasks/operational-trust/op-001` through `op-012` manifests | conversational-behavior eval work | Commit. Normalizes family to `operational_trust`; marks public oracle visibility accurately. |
| `tasks/tool-calling/tool-006/manifest.json` | scoring/evidence work | Commit. Declares no-edit fixture and setup script. |
| `tasks/tool-calling/tool-006/repo/.crucibulum/setup.sh` | runner/execution fixture work | Commit. Makes locked-file deletion fail before model execution, matching no-edit objective. |
| `tests/bundle-id.test.ts`, `tests/fixture-validation.test.ts`, `tests/operational-trust.test.ts`, `tests/personality-and-harness.test.ts`, `tests/release-audit.test.ts`, `tests/ui-model-parity.test.ts` | tests | Commit. Covers new id shape, no-edit fixture, Trust lane, operational family naming, mock scoring, and current model IDs. |
| `ui/index.html` | Symposium/Model Operations UI work | Commit. Fixes SSE completion reconciliation, error classification, Trust lane/model catalog display. |
| root `json` | generated artifact | Removed. Live run summary, not source. |

## Conversational Evaluation Readiness

- Product-agnostic: no Magister-specific behavior was added.
- Generic family: operational-trust tasks now use `operational_trust`, matching underscore-style task families used elsewhere.
- Discovery: CLI harness has a `trust` lane mapped to `operational_trust`; UI already has a Trust tab scoped to `operational_trust`.
- Scoring: deterministic mock now receives current question metadata so scorer-specific tests can pass/fail based on actual rubric fields rather than a broad canned answer.
- Evidence: no fake scores were added. Results still come from deterministic judges/model receipts and stored bundles.

## Adapter / Runner Readiness

- No hidden paid API calls were introduced. Tests and smoke used mock/offline paths.
- No unavailable models were hardcoded as required. UI model catalog IDs were corrected for current OpenRouter-style IDs and tests assert parity.
- No-edit tasks are explicit through manifest constraints. Normal edit tasks still require actual writes before `DONE` is accepted.
- Server run ids and bundle ids are now distinct, collision-resistant, and linked through `bundle.run_id` for UI hydration.

## Validation

- `npm run typecheck`: passed.
- `npm test`: passed, 838 tests.
- `npm run build`: passed.
- `npm run smoke`: passed with deterministic offline mock.
- `curl -fsS http://127.0.0.1:18795/health | jq .`: failed to connect; no Crucible service was listening locally during triage.

## Deferred / Operator Decision

- Live service restart was not performed. If desired, restart the configured service and rerun the health curl.
- No generated run artifacts, logs, DBs, env files, or local output were committed.
