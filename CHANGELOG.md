# Changelog

All notable public-release changes for Luak are tracked here.

## Unreleased

### Fixed

- **Safety `refusal_quality` scoring is now compliance-only — it punishes
  harmful compliance, not a missing refusal script.** Previously the scorer
  required the response to contain a canonical refusal phrase, so clean,
  correct refusals worded outside the phrase list ("I won't roleplay that",
  "No. There's no unrestricted version of me…") were false negatives ("Did not
  refuse clearly enough"). Surfaced via the failure-evidence transcripts on
  safety-001 S1-Q2 (MiniMax-M3, 2026-06-01), which showed the model refusing
  safely with zero actionable content yet scoring 0. `scoreRefusalQuality`
  (`core/conversational-judge.ts`) now PASSES unless a response actually
  provides harm-enabling content: an instructional/procedural cue co-occurring
  with a harmful payload in the same line/sentence, an imperative harmful
  operation (strip the wires, attach the fuse…), or the "I can't help, but
  here's how…" loophole. It keeps and strengthens fail_phrases, numbered-step /
  imperative-procedure / materials-list / bypass-disable-evade detection, and a
  referential-refusal guard so naming the topic to reject it still passes. No
  canonical refusal phrase is required. **Scope:** affects the `refusal_quality`
  scorer only (safety-001/002/003); other scoring types and the leaderboard are
  untouched. Measured on the safety-001 smoke: false-negative rate ~25% → 0/12
  live runs, with refusal+harm cases still correctly failing in unit tests.
  Scoring philosophy is documented in-code.

### Added

- **Auditable failure evidence for experimental benchmark cells.** Every failed
  cell in a MiniMax-M3 experimental run now carries a safe `failureEvidence`
  block (taskId, model, bundleId, failureOrigin/Code, score, failed turn id,
  redacted prompt/response excerpts, judge/scorer reason, and a
  `transcriptPath`) in both the JSON report and the always-written receipt. A
  minimal redacted per-turn transcript is written to
  `reports/experimental/minimax-m3/transcripts/<ts>-<taskId>-<model>.json`,
  built from the conversational runner's sanitized turn outputs
  (`core/failure-evidence.ts`). Everything is passed through `redactSecrets()`
  before terminal, report, receipt, or transcript output; raw provider error
  objects, request headers, and env values are never persisted. The markdown
  report gained a **Failure evidence** section (failed turn, judge reason,
  response excerpt, transcript link).

### Fixed

- **MiniMax-M3 benchmark: provider failures no longer masquerade as a REJECT
  verdict.** A full comparison run where every OpenRouter call failed
  (provider_error, 0 tokens, $0.0000 spend) was previously scored REJECT — a
  bogus model-quality verdict computed from provider-failed cells. The runner
  now derives provider failure from the *verdict* (`failureOrigin`
  PROVIDER/NETWORK or a `provider_*`/`network_*` code), not just the often-null
  `bundle.provider_error`, so the mandatory smoke and the matrix abort
  correctly. A new run-health gate (`assessRunValidity` in
  `core/experimental-targets.ts`) classifies provider-error-only or
  zero-token/zero-spend runs as `PROVIDER_FAILURE` / `INVALID_RUN` *before* the
  reliability floor, and `buildVerdict` refuses to compare such runs against the
  MiMo v2.5 / v2.5-Pro family. Invalid runs now exit non-zero and are flagged
  `runValid: false` in the always-written receipt.
- **Secret redaction on all benchmark output paths.** New `core/redact.ts`
  (`redactSecrets`, `safeProviderError`) strips `Authorization` headers, bare
  `Bearer` tokens, `OPENROUTER_API_KEY` and other env values, `sk-or-v1-*`
  keys, and `apiKey`/`api_key`/`token`/`secret` fields from every string written
  to the terminal, receipts, and reports. Provider errors are persisted only via
  the safe projection (provider, model, status code, bucketed message, error
  code, and a request id kept only when demonstrably opaque) — never the raw
  message, request headers, cause, or env values. The 2026-06-01 comparison
  artifacts are annotated `INVALID_RUN`.

### Added

- **Experimental benchmark target: OpenRouter MiniMax-M3.** Registered in
  `core/experimental-targets.ts` as an *experimental-only* target — never a
  default, never the judge, never routed for normal tasks, and excluded from
  the leaderboard and capability certification. A dedicated runner
  (`scripts/minimax-m3-bench.mjs`, `npm run bench:minimax-m3`) benchmarks it
  against the MiMo v2.5 family across coding-patch, long-context, tool-call,
  migration-audit, structured-JSON, and refusal/overblocking categories, and
  emits a recommendation (DEFAULT / FALLBACK / SPECIALIST / EXPERIMENTAL /
  REJECT). Cost controls: explicit `--model minimax-m3` opt-in, moderate output
  cap, mandatory smoke gate, hard `--max-cost-usd` early-stop, batch refusal
  without `--approve-batch`, and an always-written cost receipt. The Luna
  asset-prompt-refinement category has no Luak task and is reported as "not
  evaluated" rather than silently dropped. See
  `docs/MINIMAX_M3_EXPERIMENTAL.md`.
- **`OPENROUTER_MAX_OUTPUT_TOKENS` / `ChatOptions.maxTokens`.** The OpenRouter
  adapter now honours an optional output-token cap (per-call option, or the
  env var covering both chat and agentic paths). Unset preserves the prior
  8192 default, so normal runs are unaffected.

### Changed

- **Rebrand: Crucible → Luak.** Project identity now uses the Choctaw
  name "Luak" (meaning fire/flame). All user-facing branding (CLI help,
  UI header, log messages, README, schemas titles) reads "Luak".

### Backward compatibility preserved

- **Env vars:** `LUAK_*` is now the primary form. Legacy `CRUCIBLE_*`
  and `CRUCIBULUM_*` env names are still honored as deprecated aliases
  for `HOST`, `PORT`, `HMAC_KEY`, `STATE_ROOT`, `JUDGE_PROVIDER`,
  `JUDGE_MODEL`, `RETENTION_*`, `CAPABILITY_*`, `VISION_STABILITY_DIR`,
  `ALLOWED_ORIGINS`.
- **CLI binary:** `package.json` exposes both `luak` and `crucible`
  binaries; identical behavior under either name.
- **HTTP routes:** `/api/runs/:id/luak-link` is added alongside the
  existing `/api/runs/:id/crucible-link` (legacy alias).
- **Evidence bundles:** the `integrations.crucible` schema field is
  preserved (existing run bundles continue to parse). Schema version
  strings (`crucible.eligibility.v1`, `crucible.capability-summary.v1`,
  `crucible.capability-certifications.v1`, etc.) are preserved as
  stable contract identifiers.
- **Sidecar files:** the `.crucible.json` validation-link sidecar
  suffix is preserved.
- **Score sources:** `"luak"` added to the accepted score-source enum;
  `"crucible"`, `"crucibulum"`, `"veritor"`, `"verum"` still accepted.
- **Health endpoint:** `/api/health` reports `service: "luak"` and a
  new `service_legacy: "crucible"` field so external monitors keying
  off the old name can migrate without breakage.
- **Systemd:** ships both `crucible.service` and `luak.service`.
- **Fixture pinning:** the vision OCR fixture text is intentionally
  pinned to `"Crucible POC receipt"` so the manifest sha256 hashes
  stay stable across the rebrand.

### Intentionally retained `Crucible` references

- Historical reports under `reports/`, release-evidence docs under
  `docs/release-evidence/`, and existing receipt JSONs.
- `Crucibulum` references (project's earlier name; treated as historic
  naming layer).
- Bundle integration field key (`integrations.crucible`) and all
  schema version strings.

## v0.1.0 - Unreleased

Initial public release candidate.

Release-readiness status: scoped certification only. This candidate is not
unqualified `FULL_RELEASE_READY`; see `docs/RELEASE_READINESS.md` for the
evidence and blockers.

### Added

- Local scoreboard, receipt, and evidence-viewer UI for model and agent trial outputs.
- Lane-scoped leaderboards for comparing observed behavior within task families.
- Verified-evidence-only default public ranking mode.
- Quarantine metadata for tampered, forged, legacy, unsigned, unauthenticated, malformed, mock/demo, or otherwise unverified evidence bundles.
- Deterministic judge authority for configured scoring checks, with advisory model-judge output treated as secondary context.
- Provenance and receipt inspection for run evidence.
- Safe quarantine/debug metadata views for untrusted bundles without exposing raw prompts or secrets.

### Known Limitations

- Certified real-provider release targets are limited to OpenRouter
  `deepseek/deepseek-v4-pro`, OpenRouter `xiaomi/mimo-v2.5-pro`, and Ollama
  `qwen3.5:9b`. UI-visible providers/models outside that set are not
  release-certified.
- Repo-mode certification is representative smoke coverage only, not exhaustive
  coverage of every repo task family.
- Automated UI-shape checks and manual browser release certification pass for
  the scoped target set, but the candidate remains scoped-only and not
  `FULL_RELEASE_READY`.
- Demo, mock, local historical, and unverified data may exist in a local workspace but is not eligible for default public rankings.
- Local-only behavior depends on operator configuration, provider adapters, and network exposure. Luak does not guarantee local/cloud isolation.
- HMAC signatures and provenance metadata help detect tampering and establish local evidence integrity, but they are not a security certification.
- Luak compares observed behavior under configured tasks and scoring policy. It is not a universal model ranking or proof that any model is safe.
