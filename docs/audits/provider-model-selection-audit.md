# Provider / Model Selection Audit

Date: 2026-05-16

Scope: provider/model selection and reporting only. Covered benchmark, personality, poison, build, safety, and memory lane model pickers; provider registry; run request dispatch; receipts/API/export metadata; and provider/model tests. Excluded lane scoring logic and broad release auditing.

## File Map

| Area | Files |
| --- | --- |
| Provider registry/config | `core/provider-registry.ts`, `state/provider-registry.json` at runtime |
| Adapter registry/adapters | `adapters/registry.ts`, provider adapters under `adapters/*` |
| UI dropdowns/routing | `ui/index.html`, `ui/crucibulum.css` |
| API schema/routes | `server/validators.ts`, `server/routes/run.ts`, `server/routes/registry.ts`, `server/app.ts` |
| Run executor | `core/runner.ts`, `core/conversational-runner.ts` |
| Bundle metadata | `adapters/base.ts`, `core/bundle.ts`, `schemas/evidence_bundle.schema.json` |
| Receipts/exports | `server/routes/run.ts`, `server/contracts.ts`, `ui/index.html` |
| Tests | `tests/ui-model-parity.test.ts`, `tests/provider-registry.test.ts`, `tests/provider-flow.test.ts`, `tests/adapter-registry.test.ts`, `tests/adapter-selection.test.ts`, `tests/route-contract.test.ts`, `tests/ui-layout-regression.test.ts` |
| Docs | `docs/provider-model-selection.md`, `docs/audits/provider-model-selection-audit.md` |

## Data Flow

`/api/registry/state` + `/api/models` + curated `DEFAULT_MODEL_GROUPS` -> `mergedModelGroups()` -> lane model dropdown -> `deriveRoutingForModel(modelId)` -> POST `/api/run` with `task`, `adapter`, `provider`, `model` -> `resolveRequestedDispatch()` -> `instantiateAdapterForRun()` -> adapter execution/chat -> `buildBundle()` or conversational bundle builder -> `agent.adapter/provider/model` in bundle -> `/api/runs`, `/api/run/:id/status`, `/api/runs/:id`, receipts, comparison, UI, CSV/JSON exports.

## Lane Matrix

| Lane | Dropdown Source | Request Payload | Executor Target | Result/API/Export |
| --- | --- | --- | --- | --- |
| benchmark | `mergedModelGroups()` and `mergedProviders()` | `runSingle()` posts derived adapter/provider/model | `resolveRequestedDispatch()` then `instantiateAdapterForRun()` | Bundle `agent.*`, `/api/runs`, receipts, UI exports |
| personality | Same as benchmark | Same as benchmark | Same as benchmark | Same as benchmark |
| poison | Same as benchmark | Same as benchmark | Same as benchmark | Same as benchmark |
| build | Same as benchmark | Same as benchmark | Same as benchmark | Same as benchmark |
| safety | Same as benchmark | Same as benchmark | Same as benchmark | Same as benchmark |
| memory | Same as benchmark | Same as benchmark | Same as benchmark | Same as benchmark |

Status: consistent after this audit. Existing parity tests already covered equal dropdown contents across all six lanes; this audit added availability and backend routing checks.

## Findings And Repairs

1. Unconfigured cloud providers were runnable from the browser gate

`canRunModel()` documented that cloud providers require `ok` or `unknown` health but implemented `health.status !== "down"`. That allowed `unconfigured` providers to proceed, making a missing provider setup look like a model/provider runtime failure. Fixed by blocking cloud models unless health is `ok` or `unknown`, and by returning `null` in headless/no-dialog paths when no selected model is reachable.

2. Registry routing could silently cross providers

`resolveByModelIdWithHint()` sorted the hinted provider first, but if that provider did not contain the requested model it still selected another provider with the same raw model id. Fixed by treating the provider hint as operator intent: when a hint is present, matches are scoped to that preset/config id or resolution returns `null`.

3. API accepted runs did not echo requested versus actual routing

`POST /api/run` now returns `requested_target`, `target`, `resolved_by_registry`, and `routing_note`. Active run status and SSE completion include the same routing fields. Stored bundles already record actual execution identity through `agent.adapter`, `agent.provider`, and `agent.model`.

## Provider Availability Rules

- Cloud `ok`: runnable.
- Cloud `unknown`: runnable but visibly untested.
- Cloud `down`: blocked before run.
- Cloud `unconfigured`: blocked before run.
- Local `down`: blocked.
- Local `unknown` or `ok`: runnable because the run itself validates the local adapter.

Unavailable providers remain visible in the UI so the operator can understand what exists and what needs configuration.

## Test Coverage Added Or Confirmed

- All six lanes render the same model option set.
- All six lanes render the same provider option set.
- Provider/adapter filters narrow model options only when explicitly selected.
- `syncRouting()` does not mutate lane provider/adapter filters.
- Selected model routing derives from the model catalog, not lane-local filters.
- Unconfigured cloud provider selections are blocked before run.
- Mixed reachable/unreachable selections continue only with reachable models.
- Provider hints do not silently fall back to another provider.
- Provider config id hints resolve exact configured targets.
- Run dispatch records requested and resolved target metadata.

## Mocked Reproduction

Provider hint mismatch before fix:

1. Register `shared/model-1` under OpenRouter only.
2. Ask dispatch to run `adapter=anthropic`, `provider=anthropic`, `model=shared/model-1`.
3. Before fix, registry resolution could pick OpenRouter because it hosted the same model id.
4. After fix, dispatch remains `anthropic/anthropic/shared/model-1` with `resolved_by_registry=false`; no silent cross-provider fallback occurs.

Unconfigured provider before fix:

1. UI state has network up and `openrouter` health `unconfigured`.
2. Select a curated OpenRouter model.
3. Before fix, `canRunModel()` returned true.
4. After fix, `canRunModel()` returns false and headless `gateSelectedModels()` returns `null` if no reachable model remains.

Live provider verification: `UNKNOWN` in this environment until API keys are configured and at least one live run per lane is executed.

## Release Readiness

Provider/model selection is ready for release with one limitation: live cloud-provider availability cannot be certified without provider credentials in the release environment. The deterministic provider/model plumbing tests now cover lane parity, request routing, unavailability handling, and actual-target reporting.

## Full-Suite Failure Triage

Date: 2026-05-16

After commit `25b704f`, non-escalated `npm test` reported six compiled test-file failures: `core`, `e2e`, `hardening-phase2`, `route-contract`, `sse-lifecycle`, and `ui-benchmark-bindings`.

| Suite | Non-escalated evidence | Escalated or fixed result | Classification | Notes |
| --- | --- | --- | --- | --- |
| `core.test.js` | `hidden_test_failure_only` diagnostic received `public_and_hidden_failed` when subprocess execution was sandboxed. | `node --test dist/tests/core.test.js` with loopback/subprocess permissions: 35/35 pass. | `ENVIRONMENTAL` | Not caused by provider/model hardening. The failing path depends on local subprocess execution. |
| `e2e.test.js` | Mock pipeline scored 0 because workspace/git subprocess setup was sandbox-denied (`spawnSync /bin/sh EPERM`). | `node --test dist/tests/e2e.test.js` with subprocess permissions: 1/1 pass. | `ENVIRONMENTAL` | Not caused by provider/model hardening. |
| `hardening-phase2.test.js` | Rate-limiter server failed `listen EPERM: operation not permitted 127.0.0.1:46004`. | Escalated run: 16/16 pass. | `ENVIRONMENTAL` | Loopback binding is blocked by the default sandbox. |
| `route-contract.test.js` | All route tests cancelled after before-hook async activity from `listen EPERM` on `127.0.0.1`. | Escalated run: 43/43 pass. | `ENVIRONMENTAL` | Loopback binding is blocked by the default sandbox. |
| `sse-lifecycle.test.js` | All SSE tests cancelled after before-hook async activity from `listen EPERM` on `127.0.0.1`. | Escalated run: 5/5 pass. | `ENVIRONMENTAL` | Loopback binding is blocked by the default sandbox. |
| `ui-benchmark-bindings.test.js` | `handleRun should invoke runBatch exactly once`, actual `0`. | Fixed test fixture health snapshot; `node --test dist/tests/ui-benchmark-bindings.test.js`: 1/1 pass. | `CAUSED_BY_PROVIDER_HARDENING` | Provider hardening correctly blocks unavailable cloud providers. The VM test had no reachable `state.health`; it now seeds `net.ok=true` and provider health defaults before asserting run payload binding. |

Preserved provider/model invariants:

- strict provider hint behavior,
- no silent cross-provider fallback,
- unavailable-provider UI blocking,
- requested-target versus actual-target reporting.

Verification after the triage fix:

- `npm run typecheck`: pass.
- `npm run build`: pass.
- Provider/model focused tests: `provider-registry`, `ui-model-parity`, `provider-flow`, `adapter-registry`, and `adapter-selection` pass.
- Six previously failing compiled suites pass when run with required loopback/subprocess permissions.
- Full `npm test` passes under loopback/subprocess permissions: 722/722 tests.
