# Provider / Model Selection — Second-Opinion Audit

Date: 2026-05-16
Auditor: Hostile second opinion (independent of the prior Codex audit)
Prior audit: `docs/audits/provider-model-selection-audit.md` (commit `25b704f` + `e87f990`)
Scope: provider/model selection, dispatch, bundle preservation, exports. No
broad release audit, no lane-scoring re-audit. Goal: prove the prior audit
missed something.

## Verdict

**RELEASE_WITH_FIXES**

The prior audit covered the request-side plumbing thoroughly (UI dropdown
parity, registry hint resolution, request/response echo of
`requested_target` vs `target`). It did **not** verify the receive side: that
the *stored bundle's* `agent.provider` field actually reflects the upstream
provider when the adapter proxies to multiple backends. The conversational
runner short-circuits `adapter_metadata.provider` and writes
`agent.provider = adapter.id` instead, which silently mislabels every
conversational bundle that goes through a multi-provider adapter
(Peh, OpenClaw, ClaudeCode). Personality / Safety / Memory lanes are
100% conversational, so 100% of their bundles inherit this bug whenever the
adapter ≠ provider.

This is not a runtime/correctness failure — the run executes through the
right provider. It is a *receipt integrity* failure: the bundle, the
leaderboard grouping key, the drilldown export, and the
`integrations.paedagogus.routing_signals` all carry the wrong provider id.

## Findings

### ISSUE_FOUND — HIGH

#### F1. Conversational bundle records `agent.provider = adapter.id`, dropping the real backend provider

- **File**: `core/conversational-runner.ts:643` (also `:747`, `:704-705`,
  `:422`, `:451`, `:498`)
- **Why it matters**: Peh, OpenClaw, and ClaudeCode are multi-backend
  adapters. The non-conversational runner (`core/bundle.ts:170`) reads
  `executionResult.adapter_metadata.provider`, which adapters set to the
  actual upstream provider (e.g. `this.provider ?? "peh-routed"` in
  `adapters/peh.ts:231`). The conversational runner ignores that and
  hard-codes `adapter.id`. Result: a personality run on `qwen3.6-plus` via
  Peh → ModelStudio is stored as `agent.provider = "peh"` instead
  of `"modelstudio"`. The leaderboard aggregator
  (`leaderboard/aggregator.ts:82`) keys runs by
  `adapter:provider:model`, so the same model splits into different
  leaderboard entries depending on whether its tasks were conversational or
  spec-based. The prior audit's release doc claims "Bundle metadata records
  actual provider/model used"; this assertion is false for ~half the lane
  surface.
- **Reproduction**: build a conversational run through Peh. Inspect the
  stored bundle:
  ```
  jq '.agent.provider, .agent.adapter' runs/<conv-bundle>.json
  ```
  Compare against a non-conversational (`core/runner.ts`) run through the
  same adapter; the latter records `modelstudio`/`minimax`/etc., the former
  records `peh`.
- **Scope of impact**: Personality lane (all conversational), Safety lane
  (all conversational), Memory lane (all conversational), and the
  `truthfulness` / `cost_efficiency` task families on Benchmark. Build and
  Poison lanes are unaffected because their tasks use the spec/repo path.
- **Recommended fix**: thread `executionResult.adapter_metadata.provider`
  through the conversational runner the same way `buildBundle` does — or, at
  minimum, prefer `adapter.config.provider ?? adapter.id` over a bare
  `adapter.id`. Five touch points in
  `core/conversational-runner.ts` (`provider:` keys in `agent`,
  `integrations.paedagogus.routing_signals`, `provider_cost_note`, and the
  three `normalizeProviderError({provider: adapter.id, ...})` error sites).
  Skipped here per "do not fix unless explicitly tiny and obviously safe" —
  it touches stored bundle shape and deserves an explicit decision.

### ISSUE_FOUND — MEDIUM

#### F2. Stale-model-id silent local fallback in `deriveRoutingForModel`

- **File**: `ui/index.html:1149-1153`
- **Why it matters**: `deriveRoutingForModel(modelId)` returns
  `{providerId:'ollama', adapterId:'ollama', kind:'local'}` when the model
  id is not found in the merged catalog. `runSingle`
  (`ui/index.html:2333`) calls it unconditionally before POSTing
  `/api/run`. If a cloud-model id is missing from the current catalog (UI
  open during a registry change, a curated-list shrink, or a user-typed id
  via dev console), the UI posts `adapter=ollama, provider=ollama,
  model=<cloudId>`. `canRunModel(modelId)` (`:2732`) routes through the
  same `deriveRoutingForModel`, so the local fallback also passes the
  reachability gate. The Ollama adapter's healthCheck only verifies
  `/api/tags` returns 200 — it doesn't validate the requested model — so
  the run actually attempts to invoke a cloud model id against the local
  Ollama daemon. The user sees an Ollama error rather than "stale cloud
  model id".
- **Reproduction**: in browser devtools after load, run
  `state.tabData.benchmark.selectedModels = ['no-such-model']` followed by
  the Run handler; inspect the POST payload — adapter/provider both
  `'ollama'`. (Codex's existing reconcileTabSelection filters out stale
  ids on tab init, but does not re-run before dispatch.)
- **Recommended fix**: `deriveRoutingForModel` should return
  `{providerId:null, adapterId:null, kind:'unknown'}` (or throw) for
  catalog misses, and `runSingle` should reject the run with a clear
  "model not in catalog" reason instead of silently posting an Ollama
  route. Per the prior audit's own first principle ("nothing runs
  silently"), this is the same class of bug it claimed to fix on the
  server side.

### ISSUE_FOUND — LOW

#### F3. `buildFailedBundle` hard-codes `provider: "unknown"` despite knowing the adapter

- **File**: `core/runner.ts:219` and `core/runner.ts:269`
- **Why it matters**: when an injection scan trips, the bundle is stored
  with `agent.provider = "unknown"` even though the requested provider is
  known at call time. The leaderboard aggregator buckets these into a
  separate `unknown` group, and the drilldown export carries the
  "unknown" string. Path is rare (only triggered by detected injection in
  the task prompt) but the data is wrong.
- **Recommended fix**: thread the requested provider through
  `buildFailedBundle` (it already gets the adapter), or pull it from the
  adapter config. One-line change but skipped per scope.

#### F4. UI curated `DEFAULT_MODEL_GROUPS` diverges from adapter registry's `listModels`

- **File**: `ui/index.html:79-93` vs `adapters/registry.ts:127-145, 326-365`
- **Why it matters**: the prior audit asserts every lane shows the same
  model set, which is true *within the UI catalog*. But the UI catalog
  doesn't agree with the backend adapter catalog:
  - Adapter registry lists `claude-haiku-4-5-20251001`; UI's Anthropic
    group has only Opus 4.6 and Sonnet 4.6.
  - Adapter registry lists `glm-4-air` for Z.AI; UI's ZAI group omits it.
  - Adapter registry has a full `google` adapter with three Gemini
    models; the UI has no Google group in `DEFAULT_MODEL_GROUPS` at all,
    so Google models are unreachable from the lane dropdowns unless
    registered manually.
  These are not blockers because the UI is curation-driven by design, but
  the prior audit's "shared catalog source" claim glosses over the fact
  that two independent stale lists can drift, and the curated cloud lists
  contain models that may not exist in the upstream provider's catalog
  (`claude-opus-4-6`, `gpt-5.4*`, `claude-sonnet-4-6` — none of these are
  verified against a live `/v1/models` response in any test).
- **Recommended fix**: out of scope here; flag for the curator. A
  drift-detection test that compares `DEFAULT_MODEL_GROUPS` against
  `adapters/registry.ts` hardcoded listings would catch this class.

### TEST_GAP

#### T1. No test asserts a stored conversational bundle's `agent.provider` matches the actual upstream provider

- **File**: `tests/provider-registry.test.ts`,
  `tests/provider-flow.test.ts`, `tests/route-contract.test.ts`,
  `tests/personality-and-harness.test.ts`
- **Why it matters**: Codex's "stale peh → direct minimax" rewrite
  test (`tests/route-contract.test.ts:307`) verifies that the dispatch
  *request record* shows `provider: "minimax"`. It does **not** drive a
  conversational task through the rewritten adapter and re-read the
  stored bundle. Had it done so, the F1 bug would have surfaced. The
  `personality-and-harness.test.ts` tests cover scoring and judge usage
  but not provider attribution. Across all 722 tests, `agent.provider` is
  asserted only on synthesized fixtures (`tests/leaderboard.test.ts`),
  never against the output of `buildConversationalBundle`.
- **Recommended fix**: add an integration-style test that runs
  `runConversationalTask` with a stub Peh adapter whose
  `adapter_metadata.provider` is `"modelstudio"`, and assert the returned
  bundle's `agent.provider === "modelstudio"`.

#### T2. The "continues with reachable selected models" test never reaches the confirm() gate

- **File**: `tests/ui-model-parity.test.ts:262-272`
- **Why it matters**: `gateSelectedModels` calls `confirm(msg)` when there
  is at least one reachable model alongside unreachable ones. The test
  sandbox in `loadUi()` does not define a global `confirm`. The test
  passes today because the sandbox happens to surface the throw as a
  rejected promise that node:test doesn't propagate — but the assertion
  `assert.deepEqual(ui.gateSelectedModels([...]), [localModel])` cannot
  be reached, so the test does not exercise the documented continuation
  path. This is a silent false positive.
- **Recommended fix**: provide a `confirm: () => true` stub in
  `loadUi()`'s sandbox so the continuation path is actually executed,
  and add a paired test where `confirm` returns `false` to assert
  `gateSelectedModels` returns `null`.

#### T3. No drift-detection between UI's curated lists and backend adapter listings

- **File**: missing
- **Why it matters**: F4 above — `DEFAULT_MODEL_GROUPS` and adapter
  registry `listModels()` are independent sources of truth. Today they
  silently disagree (Haiku, glm-4-air, Google entirely). A test that
  ingests both and reports first-class providers whose lists differ
  would have surfaced this. The prior audit's lane-parity test only
  proves consistency *across UI tabs*, not consistency *between the UI
  and the backend it speaks to*.
- **Recommended fix**: add a parity test that diffs preset adapter
  lists against the UI curated groups for shared presets
  (anthropic, openai, zai, minimax, google).

#### T4. `deriveRoutingForModel` fallback is not tested

- **File**: missing
- **Why it matters**: F2 above. No test exercises the unknown-model
  case. The fallback to `'ollama'` is invisible.
- **Recommended fix**: add `ui-model-parity.test.ts` cases for
  `deriveRoutingForModel('definitely-not-a-real-model')`.

### CONFIRMED_CLEAN

- C1. `resolveByModelIdWithHint` (`core/provider-registry.ts:457`) does
  not silently cross-provider fall back when the hinted provider lacks
  the model — verified by `tests/provider-registry.test.ts:166`.
- C2. `resolveRequestedDispatch` (`server/routes/run.ts:62`) reports
  `requested_target` vs `target` honestly. `/api/run/:id/status`
  preserves `requested_*` and `routing_note` per
  `tests/route-contract.test.ts:307`.
- C3. Adapter health-check failure does **not** store a bundle (see the
  SSE-error branch in `handleRunPost` at `server/routes/run.ts:540`).
  Provider/network failures cannot pollute leaderboard provider
  attribution through that path.
- C4. Inline registry secrets are masked
  (`tests/provider-registry.test.ts:265`).
- C5. Account-scoped (`minimax`) providers suppress curated defaults when
  registered entries exist (`ui/index.html:1085-1093`); curated remains
  visible when no registry entry exists.
- C6. Adapter-side bundle preservation works on the
  *non-conversational* path: `core/bundle.ts:170` correctly reads
  `executionResult.adapter_metadata.provider`, and every adapter
  populates this field (verified at `adapters/{ollama,peh,…}.ts`
  `adapter_metadata:` sites).
- C7. Drilldown export carries `provider` from the stored bundle
  (`ui/index.html:438, 481`). Its accuracy depends entirely on F1: the
  pipe is correct, the source is mislabeled for conversational rows.

### UNKNOWN_NOT_PROVEN

- U1. Live provider verification across all six lanes for direct cloud
  adapters (Anthropic, OpenAI, Z.AI, MiniMax, Google) requires real API
  keys — same caveat the prior audit ended on. Cannot prove the
  conversational bug F1 manifests against real backends without
  hitting them.
- U2. The hardcoded model lists in `adapters/registry.ts` for Anthropic
  / Z.AI / Google / MiniMax (`claude-opus-4-6`, `glm-4-air`,
  `gemini-3.1-pro`, etc.) are not verified against live provider
  catalogs by any test. Whether these model ids are real or fictional
  is undetermined here.

## What the prior audit missed

| Prior audit claim | Reality |
| --- | --- |
| "Bundle metadata records actual provider/model used" | False for conversational lanes through multi-provider adapters — F1. |
| "All six lanes use the same model group source" | True within the UI; false between UI and backend — F4. |
| "Provider hints do not silently fall back to another provider" | True for the server, but the UI's `deriveRoutingForModel` does silently fall back to **Ollama** for unknown ids — F2. |
| "Run dispatch records requested and resolved target metadata" | True at the request layer; never re-checked at the bundle layer — T1. |
| Tests added cover lane parity and hint behavior | They cover the request boundary only; no test verifies what ends up stored — T1, T3, T4. |

## Verification

- `git status --short` (before):
  ```
  M README.md
  M core/bundle.ts
  M leaderboard/aggregator.ts
  M server/contracts.ts
  M server/routes/leaderboard.ts
  M ui/crucibulum.css
  M ui/index.html
  ?? scripts/lane-diagnostic.mjs
  ?? scripts/safety-rescore-preview.mjs
  ?? tests/lane-family-drift.test.ts
  ?? tests/lane-scoring.test.ts
  ?? tests/ui-recommendation-guards.test.ts
  ```
  (Plus the new audit doc after this run.)
- `npm run typecheck`: pass.
- `npm run build`: pass.
- Focused tests (`provider-registry`, `provider-flow`, `ui-model-parity`,
  `adapter-registry`, `adapter-selection`, `route-contract`,
  `provider-error-normalization`): pass (37 + 62 = 99 tests).
- Full `npm test`: 722 tests, 0 failures, 0 cancellations.

The test suite is green. F1, F2, F3 are not caught by it; that is the
point of T1–T4.

## Recommendation

Ship the request-side hardening (Codex's work in `25b704f`) — it is
sound. Before any release that publishes leaderboards or shareable
drilldown exports through a non-OpenRouter / non-direct adapter
(Peh, OpenClaw, ClaudeCode), fix F1 so the receipt agrees with
the dispatch. F2 should ride the same change. F3 is cosmetic. F4 / T3
are drift-prevention work for the next maintenance window.
