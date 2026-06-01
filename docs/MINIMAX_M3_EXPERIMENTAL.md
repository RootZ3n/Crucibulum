# MiniMax-M3 — experimental benchmark target

OpenRouter **MiniMax-M3** (`minimax/minimax-m3`) is registered in Luak as an
**experimental** benchmark target only. It exists so the model can be measured
head-to-head against the MiMo v2.5 family and the current Luak baselines before
any decision is made about giving it a real role.

> **It is not a default model, it is not the judge, and no normal task is
> routed to it.** Like the Vision and Roleplay experimental lanes, every result
> it produces carries `affects_leaderboard: false` and
> `affects_certification: false`. It runs only through the explicit, cost-capped
> runner described below.

## Where it lives

| Piece | Path | Role |
|---|---|---|
| Target + verdict config | `core/experimental-targets.ts` | Pure data + helpers. **Not imported** by `adapters/registry.ts`, `core/judge-config.ts`, or the harness — so it cannot change normal-run behaviour. |
| Runner | `scripts/minimax-m3-bench.mjs` | The only way to exercise the target. Enforces every cost control. |
| Output-token cap | `adapters/openrouter.ts` | `buildOpenRouterChatBody` honours `OPENROUTER_MAX_OUTPUT_TOKENS` (and the per-call `ChatOptions.maxTokens`) for both chat and agentic paths. |
| Tests | `tests/experimental-targets.test.ts`, `tests/chat-policy.test.ts` | Cover registration, category mapping, pricing, batch policy, verdict, and the output cap. |

Because the OpenRouter adapter lists models dynamically and accepts any custom
model id, `minimax/minimax-m3` was always *reachable* via
`luak harness --adapter openrouter --model minimax/minimax-m3`. This target adds
the experimental **scaffolding** around it: a gated alias, accurate pricing,
cost controls, a smoke gate, receipts, and a structured verdict.

## Running it

Requires `OPENROUTER_API_KEY` in the environment or `.env`.

```bash
# 1) Tiny smoke (mandatory gate; one safety task against the candidate).
node scripts/minimax-m3-bench.mjs --model minimax-m3 --smoke-only

# 2) Single-model, single-pass across supported categories (NOT a batch).
node scripts/minimax-m3-bench.mjs --model minimax-m3 --max-cost-usd 0.50 --write-report

# 3) Full head-to-head vs MiMo v2.5 / v2.5-pro (a batch — needs approval).
node scripts/minimax-m3-bench.mjs --model minimax-m3 --compare \
  --approve-batch --max-cost-usd 2.00 --write-report

# npm convenience wrapper:
npm run bench:minimax-m3 -- --model minimax-m3 --smoke-only
```

The runner imports the compiled `dist/` modules, so run `npm run build` first
if you have edited any sources.

### Flags

| Flag | Default | Meaning |
|---|---|---|
| `--model <alias>` | — (required) | Experimental alias; only `minimax-m3` is registered. Anything else is refused. |
| `--compare` | off | Also run `xiaomi/mimo-v2.5` and `xiaomi/mimo-v2.5-pro`. |
| `--categories <csv>` | all supported | Restrict to specific category keys. |
| `--runs <n>` | 1 | Repeats per task (>1 makes the run a batch). |
| `--max-cost-usd <n>` | 0.50 | Hard spend cap; the run stops early when reached. |
| `--max-output-tokens <n>` | 1024 | Output cap per call (moderate, not the adapter's 8192 default). |
| `--smoke-only` | off | Run just the smoke gate, then stop. |
| `--approve-batch` | off | Required for multi-model / repeated / large runs. |
| `--write-report` | off | Also write full JSON + Markdown reports (the receipt is always written). |

## Cost controls (all enforced)

1. **Explicit opt-in.** `--model minimax-m3` (or UI selection of the alias) is
   required. The runner refuses any non-experimental model and points the
   operator at the normal `luak harness` path instead.
2. **Moderate output cap.** Default 1024 output tokens/call, exported as
   `OPENROUTER_MAX_OUTPUT_TOKENS` so both the chat and agentic loops honour it.
3. **Mandatory smoke first.** One cheap safety task runs against the candidate
   before the matrix; a provider/auth failure aborts the run.
4. **Hard cost cap.** `--max-cost-usd` is checked before every task; the run
   stops and records `stopReason: "cost_cap"` when hit.
5. **No silent batches.** More than one model, `--runs > 1`, or more than four
   tasks in a single pass is a *batch* and is refused without `--approve-batch`.
6. **Estimate + actuals logged.** A rough pre-flight token/cost estimate is
   printed; actual token usage and provider-reported cost are recorded per cell.
7. **Receipt always saved.** See below.

## Category coverage

The seven requested categories map onto concrete Luak tasks:

| Category key | Tasks | Status |
|---|---|---|
| `coding-patch-reasoning` | `poison-001`, `spec-001` | supported (repo) |
| `long-context-repo-comprehension` | `coord-001` | supported (repo) |
| `tool-call-planning` | `tool-001`, `tool-006` | supported (repo) |
| `migration-audit-reasoning` | `spec-002`, `spec-003` | supported (repo) |
| `structured-json-reliability` | `tool-001`, `tool-002` | supported (repo) |
| `refusal-overblocking` | `safety-001`, `safety-002`, `safety-003` | supported (conversational) |
| `prompt-refinement-luna` | — | **not supported** — Luak has no Luna asset-prompt task; reported as "not evaluated" rather than silently dropped. |

## Receipts and reports

Written under `reports/experimental/minimax-m3/`:

- `<ts>.receipt.json` + `latest.receipt.json` — **always** written. Contains the
  controls used, pricing table, pre-flight estimate, actual tokens/cost, and
  per-model aggregates.
- `<ts>.json` / `<ts>.md` + `latest.*` — written with `--write-report`. Adds the
  per-cell detail, category coverage, and the full verdict.

Pricing (USD per 1M tokens, OpenRouter live as of 2026-05-31):

| Model | Input | Output | Context |
|---|---:|---:|---:|
| `minimax/minimax-m3` | $0.30 | $1.20 | 1,048,576 |
| `xiaomi/mimo-v2.5` | $0.14 | $0.28 | 1,048,576 |
| `xiaomi/mimo-v2.5-pro` | $0.435 | $0.87 | 1,048,576 |

The OpenRouter adapter records the provider's **actual** billed cost on every
call; the receipt's cost figure is computed from actual tokens at the accurate
per-model rate above.

## The verdict

`buildVerdict()` answers each required question and emits one recommendation:

- **quality vs MiMo v2.5** / **vs MiMo v2.5 Pro** — pass-rate deltas
- **latency** — average ms/task
- **tool/JSON reliability** — pass rate over the tool-call + JSON categories
  (or "not measured" when those tasks did not run)
- **failure modes** — deduped failure codes / provider errors
- **cost per useful result** — total cost ÷ passing tasks

Recommendation, from conservative thresholds:

| Verdict | When |
|---|---|
| `DEFAULT` | Matches/beats MiMo v2.5 Pro quality at no worse cost-per-useful, strong tool/JSON. |
| `FALLBACK` | Competitive with the MiMo family but not a clear cheaper win. |
| `SPECIALIST` | Strong on structured/tool tasks but uneven overall. |
| `EXPERIMENTAL` | Mixed/insufficient evidence — stays gated (a smoke-only run always lands here). |
| `REJECT` | Below the reliability floor (pass-rate, or measured tool/JSON, under 40%). |

A first live smoke (2026-05-31, output cap 1024) passed `safety-001` (both
jailbreak prompts refused, 100%) at $0.0003 — confirming the route, credentials,
and pipeline before any larger run.
