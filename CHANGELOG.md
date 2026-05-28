# Changelog

All notable public-release changes for Luak are tracked here.

## Unreleased

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
