# Security Policy

## Supported Versions

Security fixes are accepted for the current public release line.

| Version | Supported |
| --- | --- |
| v0.1.x | Yes |
| Older local snapshots | No |

## Reporting Security Issues

Please do not file public issues for suspected secrets exposure, unsafe bundle ingestion, path traversal, or signature/provenance bypasses.

Report security-sensitive findings privately to the maintainers through the project’s preferred private contact channel. If no private contact has been published yet, open a minimal public issue that says a private security report is needed, without including exploit details, secrets, run bundles, prompts, or logs.

## Trust Model

Luak is an evidence viewer and comparison layer. It can rank only evidence that passes the configured eligibility checks. Default public leaderboards exclude tampered, forged, legacy, unsigned, malformed, mock/demo, and unverified bundles.

HMAC signatures, bundle hashes, provenance fields, and quarantine labels help operators detect local tampering or stale evidence. They do not prove that an upstream provider behaved honestly, that a model is safe, or that a run was performed in a fully trusted environment.

Luak verifies bundle integrity (hash + HMAC), not provider honesty. A signed bundle proves the bundle content has not been modified since signing; it does not prove the upstream model provider ran the task faithfully or that the operator did not fabricate results before signing. Luak does not defend against Sybil attacks or fake-but-signed bundles from an untrusted operator.

## No Built-In Authentication

**Luak has no built-in authentication.** There are no tokens, sign-in screens, pairing flows, or session gates. Anything that can reach the bound port can call every API endpoint, including the leaderboard, score-query, registry CRUD, and run dispatch routes.

This app assumes it is running on a trusted private network. The default bind is `127.0.0.1`, which keeps it reachable only from the same machine. Do not expose it directly to the public internet without adding your own access control.

## Local Server Binding And Network-Layer Access Control

Luak is designed for single-operator local use. If you need access from another device, put a private-network gate in front of it — pick whichever fits your setup:

- run it behind Tailscale or a VPN and rely on tailnet / VPN-level identity;
- bind to `0.0.0.0` only when there is a firewall in front and the LAN is trusted;
- run a reverse proxy (nginx, Caddy, Cloudflare Tunnel, etc.) that handles authentication before forwarding to Luak.

Operator responsibilities for any deployment beyond the loopback default:

- choose a network-layer access-control mechanism and verify it is actually enforcing;
- protect the state directory and `runs/` from unauthorized readers;
- bind and proxy deliberately — never assume Luak itself is gating requests.

The included `luak.service` is an advanced Linux/systemd example only. Review the user, working directory, state path, file permissions, and network exposure before using it.

## HMAC, Signature, And Provenance Limits

Set `LUAK_HMAC_KEY` (legacy alias: `CRUCIBLE_HMAC_KEY`) before generating run bundles that should be eligible for public ranking. Bundles created without a key are treated as unsigned/unverified and are not ranked by default.

Changing or losing the HMAC key can make existing bundles unverifiable. HMAC verification detects bundle mutation relative to the key and hash; it does not certify the quality, truthfulness, safety, or independence of the trial itself.

## Untrusted Run Bundle Risks

Treat imported run bundles as untrusted input. Do not publish raw run contents until they have been reviewed for secrets, private prompts, private paths, customer data, or provider credentials.

Quarantine/debug views must expose only safe metadata. Raw/archive evidence views should clearly label ranking eligibility and should not present unverified evidence as public leaderboard truth.

## Mock And Demo Data

Mock harness and demo data are useful for smoke tests and screenshots, but they are not public evidence. They should remain labeled as mock/demo, quarantined from default rankings, or moved into clearly named sample fixtures.

## Not A Certification Tool

Luak is not a security certification tool, not a safety certification, not a universal model benchmark, and not a substitute for external audits or threat modeling.

