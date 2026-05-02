# Security Policy

## Supported Versions

Security fixes are accepted for the current public release line.

| Version | Supported |
| --- | --- |
| v0.1.x | Yes |
| Older local snapshots | No |

## Reporting Security Issues

Please do not file public issues for suspected secrets exposure, authentication bypasses, unsafe bundle ingestion, path traversal, or signature/provenance bypasses.

Report security-sensitive findings privately to the maintainers through the project’s preferred private contact channel. If no private contact has been published yet, open a minimal public issue that says a private security report is needed, without including exploit details, secrets, run bundles, prompts, or logs.

## Trust Model

Crucible is an evidence viewer and comparison layer. It can rank only evidence that passes the configured eligibility checks. Default public leaderboards exclude tampered, forged, legacy, unsigned, unauthenticated, malformed, mock/demo, and unverified bundles.

HMAC signatures, bundle hashes, provenance fields, and quarantine labels help operators detect local tampering or stale evidence. They do not prove that an upstream provider behaved honestly, that a model is safe, or that a run was performed in a fully trusted environment.

Crucible verifies bundle integrity (hash + HMAC), not provider honesty. A signed bundle proves the bundle content has not been modified since signing; it does not prove the upstream model provider ran the task faithfully or that the operator did not fabricate results before signing. Crucible does not defend against Sybil attacks or fake-but-signed bundles from an untrusted operator.

## Leaderboard Authentication

All leaderboard and score-query endpoints require authentication:

- `GET /api/leaderboard`
- `GET /api/scores/leaderboard`
- `GET /leaderboard`
- `GET /api/leaderboard/quarantine`
- `GET /api/scores`

Unauthenticated requests receive a `401` JSON response. Loopback clients are authenticated automatically when `CRUCIBLE_ALLOW_LOCAL` is not `"false"` (the default). Remote clients must present a valid `Authorization: Bearer <token>` header.

## Local Server Binding

Crucible is designed primarily for local operator use. Loopback clients may bootstrap without a token unless local bootstrap is disabled. Remote clients must authenticate.

For shared hosts, tunnels, reverse proxies, mobile access, or public networks:

- set a strong `CRUCIBLE_API_TOKEN` or `CRUCIBULUM_API_TOKEN`;
- set `CRUCIBLE_ALLOW_LOCAL=false` or `CRUCIBULUM_ALLOW_LOCAL=false` when loopback bootstrap should be disabled;
- bind and proxy deliberately;
- protect the state directory containing auth tokens and provider registry data.

The included `crucible.service` is an advanced Linux/systemd example only. Review the user, working directory, state path, file permissions, and network exposure before using it.

## HMAC, Signature, And Provenance Limits

Set `CRUCIBLE_HMAC_KEY` before generating run bundles that should be eligible for public ranking. Bundles created without a key are treated as unsigned/unverified and are not ranked by default.

Changing or losing the HMAC key can make existing bundles unverifiable. HMAC verification detects bundle mutation relative to the key and hash; it does not certify the quality, truthfulness, safety, or independence of the trial itself.

## Untrusted Run Bundle Risks

Treat imported run bundles as untrusted input. Do not publish raw run contents until they have been reviewed for secrets, private prompts, private paths, customer data, or provider credentials.

Quarantine/debug views must expose only safe metadata. Raw/archive evidence views should clearly label ranking eligibility and should not present unverified evidence as public leaderboard truth.

## Mock And Demo Data

Mock harness and demo data are useful for smoke tests and screenshots, but they are not public evidence. They should remain labeled as mock/demo, quarantined from default rankings, or moved into clearly named sample fixtures.

## Not A Certification Tool

Crucible is not a security certification tool, not a safety certification, not a universal model benchmark, and not a substitute for external audits or threat modeling.

