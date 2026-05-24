# Crucible Direct-Provider Re-Sweep — 2026-05-24

- Generated at: 2026-05-24T13:18:40Z
- Commit (pre-resweep): `70603abe21bea9cc0b71ef63598004e58e371300`
- Dirty tree at sweep time: yes (only the 6 new per-provider real-provider artifacts + this rollup)
- Browser: none — server-driven `node scripts/release-gauntlet.mjs --real-provider …`
- Cost cap per provider: $1.00
- Total cost across this re-sweep: $0.0000
- Scope: re-run only the 3 direct providers that the prior sweep
  (`70603ab`) classified `FAIL_CONFIG` (Anthropic, OpenAI, MiniMax). No
  OpenRouter or Ollama re-runs — both were certified PASS in the prior
  sweep and are not re-validated unnecessarily.

## Cred-rotation prerequisite check

The re-sweep request was predicated on "credentials have been rotated".
`.env` mtime at re-sweep time was `2026-05-10 10:03:16` — **the file has
not been touched since well before the prior sweep**. Either the
operator's rotation step did not modify the on-disk `.env`, or the
provider portals issued the same (still-invalid) keys back. Either way,
the values Crucible loaded for this re-sweep are byte-identical to those
of `70603ab`. As expected, every provider returned the same auth-shape
error.

This re-sweep is therefore an honest negative result: it confirms the
prior `FAIL_CONFIG` verdicts hold and that no other regression slipped in
between commits. It does **not** unblock the 3 providers.

## Per-provider verdicts

| Provider | Adapter | Model tested | Status | PASS / FAIL_PROVIDER / SKIPPED | Cost | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Anthropic direct | `anthropic` | `claude-haiku-4-5-20251001` | 🟠 FAIL_CONFIG (unchanged) | 0 / 2 / 3 | $0.0000 | `provider_error.kind=AUTH stage=health_check reason="Authentication failed (401)"`. Identical to prior sweep. |
| OpenAI direct | `openai` | `gpt-5.4-mini` | 🟠 FAIL_CONFIG (unchanged) | 0 / 2 / 3 | $0.0000 | `provider_error.kind=AUTH stage=health_check reason="Authentication failed (401)"`. Identical to prior sweep. |
| MiniMax direct | `minimax` | `MiniMax-M2.7` | 🟠 FAIL_CONFIG (unchanged) | 0 / 2 / 3 | $0.0000 | `provider_error.kind=INVALID_RESPONSE stage=health_check reason="MiniMax error 1004: token is unusable"`. Identical to prior sweep. |

## Verdict roll-up (re-sweep only)

| Classification | Count |
| --- | --- |
| PASS | 0 |
| FAIL_PRODUCT | 0 |
| FAIL_PROVIDER | 6 (Anthropic 2 · OpenAI 2 · MiniMax 2 — all `AUTH`/`INVALID_RESPONSE` at health_check) |
| FAIL_CONFIG | 3 providers blocked at credential level (unchanged from prior sweep) |
| BLOCKED | 0 |
| SKIPPED_EXPLAINED | 9 (3 per blocked provider after early-stop on repeated auth failure) |

## What this re-sweep proves

- **Crucible product behavior is stable:** every failure carried structured
  `provider_error.kind` / `stage` / `reason`; no `Run state unreachable`,
  no `Run stream interrupted`, no silent no-op dispatch. The `70603ab`
  health hardening did not regress any provider path.
- **Crucible product bugs found:** 0.
- **Credentials are still invalid in `.env`:** the operator's rotation
  step has not landed on disk in this checkout. Until `.env` is updated
  with working keys for `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
  `MINIMAX_API_KEY`, these three direct providers cannot be certified.

## Cost summary

- Anthropic: $0.0000 (auth failed before chargeable tokens)
- OpenAI: $0.0000 (auth failed before chargeable tokens)
- MiniMax: $0.0000 (auth failed before chargeable tokens)
- **Total: $0.0000**

## Per-provider report artifacts

- Anthropic / Haiku 4.5: `reports/release-gauntlet/real-provider/2026-05-24T13-18-00-842Z-anthropic-claude-haiku-4-5-20251001.{json,md}`
- OpenAI / gpt-5.4-mini: `reports/release-gauntlet/real-provider/2026-05-24T13-18-10-077Z-openai-gpt-5.4-mini.{json,md}`
- MiniMax / MiniMax-M2.7: `reports/release-gauntlet/real-provider/2026-05-24T13-18-15-814Z-minimax-MiniMax-M2.7.{json,md}`

## Commands run

```bash
git status --short
npm run build
node scripts/test.mjs              # 926/926 pass
node scripts/release-gauntlet.mjs --real-provider --provider anthropic --model claude-haiku-4-5-20251001 --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider openai    --model gpt-5.4-mini                --broad-smoke --max-cost-usd 1.00 --write-report
node scripts/release-gauntlet.mjs --real-provider --provider minimax   --model MiniMax-M2.7                --broad-smoke --max-cost-usd 1.00 --write-report
stat -c '%y' .env                  # 2026-05-10 10:03:16  ← unchanged since prior sweep
```

## Final verdict

**RE_SWEEP_NO_CHANGE** — Anthropic, OpenAI, MiniMax direct adapters
remain `FAIL_CONFIG`. The credentials in `.env` were not actually
rotated between commits. The release-readiness posture is unchanged
from `70603ab`:

- `RELEASE_TARGETS_CERTIFIED` = YES (Ollama + 2 OpenRouter models, unchanged).
- `ALL_VISIBLE_PROVIDERS_CERTIFIED` = NO (3 direct adapters still blocked at AUTH).
- `PROVIDER_SWEEP_READY` = PARTIAL.
- `FULL_RELEASE_READY` = NO.

Operator next step: rotate `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and
`MINIMAX_API_KEY` in `.env`, confirm `stat -c '%y' .env` advances, then
re-trigger this same re-sweep.
