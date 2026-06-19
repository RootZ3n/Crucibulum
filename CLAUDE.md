# Luak

Luak is the model/agent benchmarking and evidence-inspection tool in the **Pehverse lab** — Jeffrey Miller's multi-agent AI development ecosystem. It turns model and agent trial outputs into auditable scoreboards, receipts, and comparison views. Luak ingests or creates run evidence, applies deterministic scoring, and exposes results through a local API + browser UI. It is an evidence viewer and local evaluation layer, not a safety certification or universal model ranking. Sibling tools: Colosseum (trial generation), Verum (adversarial probing), Aedis (build orchestration), Peh Public (user-facing control surface). `Crucibulum`/`crucible` is the older internal protocol name and survives as compatibility naming (env var aliases, the `crucible` bin, the `CrucibulumAdapter` type).

## Build / Test / Dev Commands

All scripts are pnpm/npm scripts from `package.json`. Requires Node >= 20, pnpm 9+.

- `pnpm install` — install dependencies
- `pnpm run build` — compile TypeScript (`tsc`) to `dist/`
- `pnpm run build:clean` — clean rebuild via `scripts/build-clean.mjs`
- `pnpm run dev` — `tsc --watch`
- `pnpm test` — run the suite. `pretest` does a clean build first, then `scripts/test.mjs` runs all compiled `dist/tests/*.test.js` files with `node --test`
- `pnpm run typecheck` — `tsc --noEmit`
- `pnpm run lint` — alias for `typecheck` (no separate linter)
- `pnpm run smoke` — deterministic offline mock-adapter pipeline check (`scripts/smoke.mjs`), no API keys
- `pnpm run serve` / `pnpm start` — start local API + UI (`dist/server/api.js`, default `http://127.0.0.1:18795`)
- `pnpm run cli -- <cmd>` — run the CLI (`dist/cli/main.js`); subcommands: `harness`, `qa`, `compare`, `leaderboard`, `list`, `verify`, `replay`, `oracle-hash`, `doctor`, `test`
- `pnpm run harness -- --task <id>` — run a task through the full pipeline (mock by default; `--live`/`--adapter`/`--model` for real providers)
- `pnpm run doctor` — read-only environment diagnostic
- `pnpm run verify:release` / `pnpm run audit:release` — release verification / pnpm advisory checks
- `pnpm run oracle:hash -- --check|--write` — verify/register oracle hashes
- `pnpm run clean:state -- --confirm` — wipe local `runs/` and `state/`

Tests compile first, then run with Node's built-in test runner (`node:test` + `node:assert/strict`). Test files live in `tests/` (~151 `*.test.ts`). The runner sets `LUAK_DISABLE_CIRCUIT_PERSIST=1` so parallel test processes don't leak circuit-breaker state through `state/`, and sweeps leftover `ws_*` workspaces after the run.

## Key Conventions

- **TypeScript, ESM.** `"type": "module"`; `module`/`moduleResolution` = `NodeNext`, target `ES2022`. Relative imports use explicit `.js` extensions (e.g. `import { log } from "../utils/logger.js"`) even from `.ts` sources.
- **Strict compiler.** `strict: true` plus `exactOptionalPropertyTypes` and `forceConsistentCasingInFileNames`. Keep optional properties precise.
- **Minimal runtime deps.** Only `better-sqlite3` and `dotenv` at runtime. No test framework, no bundler, no ESLint — `node --test` and `tsc` do everything.
- **Flat top-level module dirs** (not a single `src/`): `core/`, `adapters/`, `server/`, `cli/`, `leaderboard/`, `security/`, `utils/`, `types/`, plus data dirs `tasks/`, `oracles/`, `schemas/`, `suites/`, `ui/`, `scripts/`.
- **Section-banner comments** (`// ─── Name ───`) and audit-tagged comments (e.g. "Audit C3") are common; preserve them.
- **Env config with `LUAK_*` names**, legacy `CRUCIBLE_*`/`CRUCIBULUM_*` honored as deprecated aliases. Key vars: `LUAK_PORT`, `LUAK_HOST`, `LUAK_HMAC_KEY` (bundle signing), `OPENROUTER_API_KEY`, `LUAK_JUDGE_PROVIDER`/`LUAK_JUDGE_MODEL`. See `.env.example`, `utils/env.ts`.
- **Trust discipline (core invariant):** deterministic judge is authoritative; model/review/adapter output is untrusted; bundles are HMAC-signed and immutable; raw `score.total` is historical, the leaderboard recomputes against current rules. Do not weaken these in scoring/judge code.

## Architecture Notes

Pipeline: load task manifest → filter for agent (hide rubric/oracle) → isolated workspace → run adapter/model → record timeline + filesystem evidence → collect diff → integrity/security checks → deterministic judge → signed evidence bundle → optional advisory review. The implementation centers on Runner / Observer / Judge.

- **`core/`** — the engine. `runner.ts` + `conversational-runner.ts` (orchestration), `observer.ts` (timeline/file capture), `judge.ts` + `conversational-judge.ts` (deterministic scoring), `oracle.ts`/`oracle-hash-util.ts`, `manifest.ts`/`suite-loader.ts` (task loading), `bundle.ts` (signed evidence bundles), `verdict.ts`/`verdict-policy.ts`/`eligibility.ts` (PASS / FAIL/MODEL / NC classification + ranking eligibility), `circuit-breaker.ts` (per-provider failure breaker + rate limiting, persisted to `state/circuit-breaker.json`), `retry.ts`/`retry-after.ts`/`flake.ts`, `provider-registry.ts` (code-owned **provider presets** + user-added providers), `review.ts`/`verum.ts` (advisory review layers), `security.ts`/`redact.ts`, `capability-certification*.ts`, plus many `*-reporting.ts` lane reporters.
- **`adapters/`** — provider integrations behind a common interface. `base.ts` defines the adapter contract (`CrucibulumAdapter`), `registry.ts` registers them. Adapters: `openrouter`, `anthropic`, `openai`, `ollama`, `minimax`, `google`, `zai`, `peh`, `openclaw`, `claudecode`, `grimoire-cc`, `grimoire-codex`, and `harness-mock` (deterministic offline). OpenRouter is the default-judge route (`xiaomi/mimo-v2.5-pro`).
- **`server/`** — local HTTP API + UI. `api.ts`/`app.ts` entry, `routes/` (run, suite, leaderboard, export, registry, vision, roleplay, capabilities, health, batch, storage), `contracts.ts`/`validators.ts`, `rate-limit.ts`. No built-in auth; binds `127.0.0.1` by default.
- **`cli/`** — `main.ts` dispatcher + `commands/` (harness, qa, compare, leaderboard, list, verify, replay, oracle-hash, doctor, test).
- **`leaderboard/`** — `aggregator.ts` + `schema.json`: composite scoring that excludes NC bundles and gates secondary credit on non-zero correctness.
- **`security/`** — `velum.ts` (review-input sanitization / prompt-injection defense), `injection-patterns.json`.
- **`utils/`** — `env.ts`, `logger.ts`, `hashing.ts`, `cost.ts`, `tokens.ts`, `diff.ts`, `json-safe.ts`, `safe-id.ts`, `timing.ts`.
- **`types/`** — shared types (`scores.ts`, `verdict.ts`, `provider-error.ts`).
- **Data dirs:** `tasks/<family>/<id>/manifest.json` (task manifests; repo tasks pair with `oracles/`), `schemas/` (JSON schemas), `suites/`, `ui/` (static API/UI client). Local output (`runs/`, `state/`, `data/`) is gitignored.

CLI exit codes: `0` pass, `1` fail, `2` integrity violation, `3` harness error, `4` injection detected, `5` adapter error. See `README.md` for the full operator guide and `docs/` for methodology/scoring/trust docs.
