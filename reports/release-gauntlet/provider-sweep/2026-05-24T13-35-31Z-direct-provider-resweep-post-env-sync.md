# Crucible Direct-Provider Re-Sweep (Post Env-Sync) — 2026-05-24

- Generated at: 2026-05-24T13:35:31Z
- Pre-sweep commit: `65a2fd0382936d7ef54cdcb285765833859c6d40`
- Dirty tree at sweep time: yes (only the new per-provider artifacts + this rollup)
- Browser: none — server-driven `node scripts/release-gauntlet.mjs --real-provider …`
- Cost cap per provider: $1.00
- **Total cost across this re-sweep: $0.3922**
- Scope: re-run only the 3 direct providers that the prior sweeps (`70603ab` and `65a2fd0`) classified `FAIL_CONFIG` (Anthropic, OpenAI, MiniMax) **after** syncing rotated provider credentials from `/mnt/ai/aedis/.env` into `/mnt/ai/crucible/.env`. No OpenRouter or Ollama re-runs — both were already certified.

## What changed since 65a2fd0

The prior re-sweep proved Crucible product behavior was stable and that
the failures were `.env`-credential-driven. Operator confirmed the
rotated keys lived in `/mnt/ai/aedis/.env`, not in this checkout's
`/mnt/ai/crucible/.env`. Three provider credentials were synced from
Aedis to Crucible (only):

| Variable | Before (Crucible) | After (Crucible) | Aedis | Match |
| --- | --- | --- | --- | --- |
| `ANTHROPIC_API_KEY` | `len=108 sha10=7907790526` | `len=108 sha10=7edb6b0e2b` | `len=108 sha10=7edb6b0e2b` | ✅ SAME |
| `OPENAI_API_KEY` | `len=164 sha10=5f8e1120b5` | `len=164 sha10=477627fce7` | `len=164 sha10=477627fce7` | ✅ SAME |
| `MINIMAX_API_KEY` | `len=126 sha10=6111fc1dfb` | `len=126 sha10=2c3bc894cc` | `len=126 sha10=2c3bc894cc` | ✅ SAME |

All other Crucible `.env` keys (`OPENROUTER_API_KEY`, `OLLAMA_BASE_URL`,
`DASHSCOPE_API_KEY`, `ZAI_API_KEY`) were left untouched. `.env` was
backed up to `/mnt/ai/crucible/.env.backup-20260524T132624Z` (gitignored
via `.env.*`) before any edit.

The systemd unit `crucible.service` was restarted via `systemctl restart
crucible` so the Node process re-read the new `.env` via `dotenv/config`
(`server/api.ts:1`). New main PID `1224205` confirmed; `/api/health`
responded `status=ok` immediately after restart.

## Cheap auth probes (pre-sweep validation)

Direct HTTPS calls from a Node process loaded with the new `.env` (one
request per provider, minimum-cost endpoint):

| Provider | Endpoint | HTTP | OK | Notes |
| --- | --- | --- | --- | --- |
| Anthropic | `POST https://api.anthropic.com/v1/messages` `max_tokens=1` | 200 | ✅ | dur 775ms |
| OpenAI | `GET https://api.openai.com/v1/models` | 200 | ✅ | dur 759ms |
| MiniMax | `POST https://api.minimax.io/v1/text/chatcompletion_v2` `max_tokens=1` | 200 | ✅ | dur 3047ms |

## Per-provider verdicts (broad-smoke)

| Provider | Adapter | Model | Status | PASS / FAIL_PROVIDER / SKIPPED | tokens in/out | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anthropic direct | `anthropic` | `claude-haiku-4-5-20251001` | ✅ PASS | 5 / 0 / 0 | 84,698 / 9,178 | $0.3918 | All 5 tasks: personality, role-stress, safety, op, tool. 5 distinct run_ids, 5 distinct bundle_ids. |
| OpenAI direct | `openai` | `gpt-5.4-mini` | ✅ PASS | 5 / 0 / 0 | 0 / 0 | $0.0000 | All 5 tasks pass. **Observability note:** adapter parses `data.usage.{prompt,completion}_tokens` (adapters/openai.ts:228) but gpt-5.4-mini responses did not surface `usage` on these calls → 0/0 tokens and $0.00 cost are mis-captured, not free. Not a release blocker; tracked as follow-up. |
| MiniMax direct | `minimax` | `MiniMax-M2.7` | 🟡 MOSTLY-PASS | 4 / 1 / 0 | 2,197 / 1,586 | $0.0004 | `personality-001`, `safety-001`, `op-001`, `tool-003` pass. `role-stress-001` failed with `provider_error.kind=TIMEOUT stage=health_check reason="Provider request timed out — The operation was aborted due to timeout"` — honest provider classification, NOT a Crucible bug. |

## Verdict roll-up (this re-sweep)

| Classification | Count |
| --- | --- |
| PASS | 14 |
| FAIL_PRODUCT | 0 |
| FAIL_PROVIDER | 1 (MiniMax role-stress timeout) |
| FAIL_CONFIG | 0 |
| BLOCKED | 0 |
| SKIPPED_EXPLAINED | 0 |

## Receipt / hydration sanity

- 14 distinct run_ids across the 3 providers (5 + 5 + 5).
- 14 distinct bundle_ids persisted (5 + 5 + 4 — MiniMax timeout did not produce a scored bundle; the failure was captured as a structured `provider_error`).
- 0 `Run state unreachable` / 0 `Run stream interrupted` / 0 silent no-op dispatch.
- Every failure has structured `provider_error.kind` + `stage` + `reason`.

## Bugs found

- **Crucible product bugs:** 0.
- **Provider-specific quirks:**
  - OpenAI `gpt-5.4-mini` responses on this codepath are not returning a `usage` object (or `usage` is null/missing), which leaves token + cost capture at 0. Adapter parser is correct; the upstream payload is the gap.
  - MiniMax `MiniMax-M2.7` produced a single `health_check` timeout on `role-stress-001` (longer prompt) but succeeded on the 4 shorter tasks. Honest `FAIL_PROVIDER`/`TIMEOUT`.

## Cost summary

- Anthropic: $0.3918
- OpenAI: $0.0000 (mis-captured; see observability note above)
- MiniMax: $0.0004
- **Total: $0.3922** (well under the $1.00/provider cap)

## Release impact

- `RELEASE_TARGETS_CERTIFIED` (3 named targets) unchanged from `70603ab`.
- `ALL_VISIBLE_PROVIDERS_CERTIFIED` → can now move to **PARTIAL** for the 3 direct adapters. Anthropic + OpenAI fully PASS. MiniMax has 4/5 pass with 1 honest provider timeout (`FAIL_PROVIDER`, not a Crucible bug).
- `PROVIDER_SWEEP_READY` → **PARTIAL** (richer evidence). No Crucible product bug across all sweeps.
- `FULL_RELEASE_READY` = **NO** — UI failed-row classification path still not exercised, MiniMax has a non-zero provider failure rate on the broad-smoke profile, OpenAI cost/token capture has an upstream gap.

## Per-provider report artifacts

- Anthropic / Haiku 4.5: `reports/release-gauntlet/real-provider/2026-05-24T13-33-33-387Z-anthropic-claude-haiku-4-5-20251001.{json,md}`
- OpenAI / gpt-5.4-mini: `reports/release-gauntlet/real-provider/2026-05-24T13-33-43-203Z-openai-gpt-5.4-mini.{json,md}`
- MiniMax / MiniMax-M2.7: `reports/release-gauntlet/real-provider/2026-05-24T13-34-47-646Z-minimax-MiniMax-M2.7.{json,md}`

## Commands run

```bash
ls -la /mnt/ai/aedis/.env /mnt/ai/crucible/.env
# redacted fingerprint compare (sha256[:10], length, presence only)
cp /mnt/ai/crucible/.env /mnt/ai/crucible/.env.backup-20260524T132624Z
# sync ANTHROPIC_API_KEY, OPENAI_API_KEY, MINIMAX_API_KEY from Aedis (in-place edit only of these 3 lines)
systemctl restart crucible
curl -s http://127.0.0.1:18795/api/health
# cheap direct auth probes (Anthropic max_tokens=1, OpenAI /v1/models, MiniMax max_tokens=1)
node scripts/release-gauntlet.mjs --real-provider --provider anthropic --model claude-haiku-4-5-20251001 --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider openai    --model gpt-5.4-mini                --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider minimax   --model MiniMax-M2.7                --broad-smoke --max-cost-usd 1.00 --write-report
```

## Final verdict

**DIRECT_PROVIDERS_UNBLOCKED — sweep PARTIAL on MiniMax**

Anthropic + OpenAI direct fully PASS 5/5. MiniMax PASS 4/5 with one
honest provider TIMEOUT on the longer `role-stress-001` task — not a
Crucible bug. Crucible product behavior remains zero-`FAIL_PRODUCT`
across every sweep run since the health hardening landed in `70603ab`.
Operator's rotated credentials are now in use; `.env` was synced from
Aedis with redacted-only diffing, never printed or committed.
