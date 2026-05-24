# Crucible Multi-Provider Sweep — 2026-05-24

- Generated at: 2026-05-24T12:55:56Z
- Commit: `6820c80ae26fa2193e76373c133a1241c8909e9c` (pre-commit of health hardening + UI cert archive)
- Dirty tree at sweep time: yes (health hardening edits + new tests + new docs not yet committed)
- Browser: none — server-driven gauntlet via `node scripts/release-gauntlet.mjs --real-provider …`. Browser-level UI lane certification is archived separately in `reports/release-gauntlet/ui-manual/2026-05-24T12-19-05Z-all-visible-lanes-certification.md`.
- Cost cap per paid provider: $1.00 (enforced by `--max-cost-usd 1.00`)
- Total cost spent across the sweep: $0.0069

## Per-provider verdicts

| Provider | Adapter | Model tested | Status | PASS / FAIL_PROVIDER / SKIPPED | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Ollama (local) | `ollama` | `qwen3.5:9b` | ✅ PASS | 5 / 0 / 0 | $0.0000 | Local Ollama at `http://localhost:11434`, 14 models discovered, target `qwen3.5:9b` present. |
| OpenRouter | `openrouter` | `deepseek/deepseek-v4-pro` | ✅ PASS | 5 / 0 / 0 | $0.0045 | Release target. |
| OpenRouter | `openrouter` | `xiaomi/mimo-v2.5-pro` | ✅ PASS | 5 / 0 / 0 | $0.0024 | Release target. |
| Anthropic direct | `anthropic` | `claude-haiku-4-5-20251001` | 🟠 FAIL_CONFIG | 0 / 2 / 3 | $0.0000 | `provider_error.kind=AUTH stage=health_check reason="Authentication failed (401)"`. ANTHROPIC_API_KEY in `.env` is stale/invalid. Crucible classified honestly — NOT a Crucible product bug. |
| OpenAI direct | `openai` | `gpt-5.4-mini` | 🟠 FAIL_CONFIG | 0 / 2 / 3 | $0.0000 | `provider_error.kind=AUTH stage=health_check reason="Authentication failed (401)"`. OPENAI_API_KEY in `.env` is stale/invalid. Crucible classified honestly — NOT a Crucible product bug. |
| MiniMax direct | `minimax` | `MiniMax-M2.7` | 🟠 FAIL_CONFIG | 0 / 2 / 3 | $0.0000 | `provider_error.kind=INVALID_RESPONSE stage=health_check reason="MiniMax error 1004: token is unusable"`. MINIMAX_API_KEY in `.env` is stale/invalid. Crucible classified honestly — NOT a Crucible product bug. |

## Verdict roll-up

| Classification | Count |
| --- | --- |
| PASS | 15 |
| FAIL_PRODUCT | 0 |
| FAIL_PROVIDER | 6 (Anthropic 2 · OpenAI 2 · MiniMax 2 — all `AUTH`/`INVALID_RESPONSE` at health-check) |
| FAIL_CONFIG | 3 providers blocked at config / credential level |
| BLOCKED | 0 |
| SKIPPED_EXPLAINED | 9 (3 per blocked provider after early-stop on repeated auth failure) |

## Cost summary

- OpenRouter total: $0.0069 (DeepSeek $0.0045 + Mimo $0.0024)
- Anthropic: $0.0000 (auth failed before chargeable tokens)
- OpenAI: $0.0000 (auth failed before chargeable tokens)
- MiniMax: $0.0000 (auth failed before chargeable tokens)
- Ollama: $0.0000 (local)
- **Total: $0.0069**

## Health 429 / stale-health incidents in this sweep

- None observed in the gauntlet runs themselves. The gauntlet does not poll `/api/health` from the browser; it dispatches via the same in-process server, so it never tripped Crucible's read-rate bucket the way the broad manual UI sweep did on 2026-05-24T11:38Z.
- The 2026-05-24T11–12 manual UI sweep that uncovered the stale-offline regression is documented in `reports/release-gauntlet/ui-manual/2026-05-24T12-19-05Z-all-visible-lanes-certification.md` (Metadata Addendum).

## Provider error behavior observed

| Provider | Auth | Quota | Rate limit | Network | Timeout | Malformed | Model unavail. | Safety refusal |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic | observed (HTTP 401, AUTH) | — | — | — | — | — | — | — |
| OpenAI | observed (HTTP 401, AUTH) | — | — | — | — | — | — | — |
| MiniMax | observed (HTTP 200 + error 1004 / INVALID_RESPONSE) | — | — | — | — | — | — | — |
| OpenRouter | — | — | — | — | — | — | — | — |
| Ollama | n/a | n/a | n/a | — | — | — | — | — |

Each provider failure was classified by Crucible into `provider_error.kind` + `stage` + `reason`. None produced a `Run state unreachable` or `Run stream interrupted` catch-all.

## Bugs found

- **Crucible product bugs:** 0.
- **Provider config bugs:** 3 (Anthropic, OpenAI, MiniMax credentials in `.env` are stale/invalid; sweep cannot certify those providers until credentials are rotated).
- **Provider-specific quirks observed:**
  - MiniMax `INVALID_RESPONSE` carries an in-band error code (`1004: token is unusable`) on HTTP 200; the existing classifier already handles this correctly.

## Release impact

- `RELEASE_TARGETS_CERTIFIED` for the 3 named targets (DeepSeek V4 Pro, Mimo v2.5 Pro, Ollama qwen3.5:9b) remains **YES**.
- `ALL_VISIBLE_PROVIDERS_CERTIFIED` = **NO** — Anthropic / OpenAI / MiniMax direct adapters cannot be certified for this candidate until credentials are valid.
- `PROVIDER_SWEEP_READY` = **PARTIAL** — sweep ran cleanly end-to-end with no Crucible product bugs, but 3 of 4 paid providers blocked at AUTH.
- `FULL_RELEASE_READY` = **NO** — scoped certification only, full UI failed-row classification path not exercised, full multi-provider sweep partial.

## Per-provider report artifacts

- Ollama: `reports/release-gauntlet/real-provider/2026-05-24T12-52-04-302Z-ollama-qwen3.5-9b.{json,md}`
- OpenRouter / DeepSeek V4 Pro: `reports/release-gauntlet/real-provider/2026-05-24T12-54-01-504Z-openrouter-deepseek-deepseek-v4-pro.{json,md}`
- OpenRouter / Mimo v2.5 Pro: `reports/release-gauntlet/real-provider/2026-05-24T12-55-16-240Z-openrouter-xiaomi-mimo-v2.5-pro.{json,md}`
- Anthropic / Haiku 4.5: `reports/release-gauntlet/real-provider/2026-05-24T12-55-20-070Z-anthropic-claude-haiku-4-5-20251001.{json,md}`
- OpenAI / gpt-5.4-mini: `reports/release-gauntlet/real-provider/2026-05-24T12-55-30-792Z-openai-gpt-5.4-mini.{json,md}`
- MiniMax / MiniMax-M2.7: `reports/release-gauntlet/real-provider/2026-05-24T12-55-42-761Z-minimax-MiniMax-M2.7.{json,md}`

## Commands run

```bash
node scripts/release-gauntlet.mjs --dry-run-inventory
node scripts/release-gauntlet.mjs --real-provider --provider ollama --model qwen3.5:9b --broad-smoke --write-report
node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model deepseek/deepseek-v4-pro --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider openrouter --model xiaomi/mimo-v2.5-pro --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider anthropic --model claude-haiku-4-5-20251001 --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider openai --model gpt-5.4-mini --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider minimax --model MiniMax-M2.7 --broad-smoke --max-cost-usd 1.00 --write-report
```

## Final verdict

**PROVIDER_SWEEP_PARTIAL** — Sweep completed end-to-end with no Crucible product bugs; 3 of 6 provider profiles (Anthropic, OpenAI, MiniMax) blocked at AUTH/INVALID_RESPONSE due to stale credentials in `.env`. OpenRouter (both release-target models) and Ollama passed cleanly. Stale credentials must be rotated before those providers can be certified.
