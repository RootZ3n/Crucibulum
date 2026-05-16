# Provider / Model Selection

Crucible uses one provider/model control plane for every release lane: benchmark, personality, poison, build, safety, and memory. The lane changes the task set; it must not change the model picker semantics.

## Model Discovery

The UI builds model options from these sources, in order:

1. Registered provider catalog from `/api/registry/state`.
2. Live local inventory from `/api/models` for Ollama.
3. Curated default groups in `ui/index.html` for common cloud and local models.

Registered models win over curated defaults with the same raw model id because they represent an explicit operator route. Local Ollama models prefer live inventory and fall back to the curated local shortlist only when live inventory is unavailable.

## Routing Fields

- `adapter`: implementation used to talk to the provider API, such as `openrouter`, `anthropic`, `ollama`, `minimax`, or `squidley`.
- `provider`: provider preset or configured provider route, such as `openrouter`, `anthropic`, `ollama`, `minimax`, `zai`, or `modelstudio`.
- `model`: raw model id sent to that provider.
- `requested_target`: adapter/provider/model posted by the UI.
- `target`: adapter/provider/model actually used by execution.
- `resolved_by_registry`: true when a registered provider/model entry changed or confirmed dispatch.
- `routing_note`: human-readable explanation when registry routing was applied.

Run receipts, bundles, API rows, comparisons, and exports use the actual bundle fields under `agent.adapter`, `agent.provider`, and `agent.model`.

## Lane Consistency

All release lanes use the same model group source, provider dropdown source, and `deriveRoutingForModel()` dispatch rule:

| Lane | Model Source | Provider Source | Dispatch |
| --- | --- | --- | --- |
| benchmark | Shared merged catalog | Shared merged providers | Per selected model |
| personality | Shared merged catalog | Shared merged providers | Per selected model |
| poison | Shared merged catalog | Shared merged providers | Per selected model |
| build | Shared merged catalog | Shared merged providers | Per selected model |
| safety | Shared merged catalog | Shared merged providers | Per selected model |
| memory | Shared merged catalog | Shared merged providers | Per selected model |

Provider and adapter dropdowns are filters only. Selecting a model derives the actual run target from the model catalog and does not mutate those filters.

## Availability And Fallback

Unavailable providers are visible but labeled. Cloud providers marked offline or unconfigured are blocked before a run. A visible cloud model is not proof that credentials exist.

Fallback rules:

- Local Ollama: live `/api/models` inventory, then curated local shortlist.
- Registered cloud model: exact registered provider/model route.
- Curated cloud model: posted provider/adapter/model route from the UI.
- Registry tie without a provider hint: first-class providers, currently OpenRouter, win.
- Registry tie with a provider hint: the hinted provider must have the model; Crucible does not silently switch to another provider.

Live provider verification depends on configured API keys and provider health. If no provider keys are available, live verification status is `UNKNOWN`; mocked routing tests remain authoritative for selection plumbing.

## Reporting Expectations

Every run surface should show:

- provider/model actually used,
- requested provider/model when different,
- routing note when registry routing applied,
- provider availability status before run,
- provider failures as infrastructure/provider failures, not model scores.

No lane should show a different model list from benchmark unless a documented lane-specific source is intentionally introduced.
