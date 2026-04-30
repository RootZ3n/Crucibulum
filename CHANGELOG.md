# Changelog

All notable public-release changes for Crucible are tracked here.

## v0.1.0 - Unreleased

Initial public release candidate.

### Added

- Local scoreboard, receipt, and evidence-viewer UI for model and agent trial outputs.
- Lane-scoped leaderboards for comparing observed behavior within task families.
- Verified-evidence-only default public ranking mode.
- Quarantine metadata for tampered, forged, legacy, unsigned, unauthenticated, malformed, mock/demo, or otherwise unverified evidence bundles.
- Deterministic judge authority for configured scoring checks, with advisory model-judge output treated as secondary context.
- Provenance and receipt inspection for run evidence.
- Safe quarantine/debug metadata views for untrusted bundles without exposing raw prompts or secrets.

### Known Limitations

- Demo, mock, local historical, and unverified data may exist in a local workspace but is not eligible for default public rankings.
- Local-only behavior depends on operator configuration, provider adapters, and network exposure. Crucible does not guarantee local/cloud isolation.
- HMAC signatures and provenance metadata help detect tampering and establish local evidence integrity, but they are not a security certification.
- Crucible compares observed behavior under configured tasks and scoring policy. It is not a universal model ranking or proof that any model is safe.

