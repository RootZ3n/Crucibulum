# Crucible Manual Browser Certification - Visible Lanes

- Date: 2026-05-24
- Browser URL: http://127.0.0.1:18795
- Target model: OpenRouter / deepseek/deepseek-v4-pro
- Scope: selected/default task set per visible lane
- Result: completed for all runnable visible lanes with 0 `Run state unreachable` and 0 `Run stream interrupted` in the certifying passes below.

## Certifying Artifacts

| Lane | Selected/default task | Run status | Evidence | Refresh hydration | Screenshot/report |
| --- | --- | --- | --- | --- | --- |
| Personality | classification-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T11-52-25Z-lane-cert/personality.png / lane-cert.json |
| Benchmark | code-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-16-17Z-lane-cert/benchmark.png / lane-cert.json |
| Poison | poison-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-03-06Z-lane-cert/poison.png / lane-cert.json |
| Build | coord-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-03-06Z-lane-cert/build.png / lane-cert.json |
| Safety | safety-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-03-06Z-lane-cert/safety.png / lane-cert.json |
| Memory | memory-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-03-06Z-lane-cert/memory.png / lane-cert.json |
| Tools | tool-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-03-06Z-lane-cert/tools.png / lane-cert.json |
| Trust | op-001 | complete, 1/1 completed | ok | ok | reports/release-gauntlet/ui-manual/2026-05-24T12-03-06Z-lane-cert/trust.png / lane-cert.json |
| Providers | n/a | surfaced | registry ok | n/a | reports/release-gauntlet/ui-manual/2026-05-24T12-16-17Z-lane-cert/providers.png / lane-cert.json |

## Observations

- No certifying lane had a failed selected row. The failed-row classification/stage/reason requirement was therefore not exercised by these default selected runs.
- Every executed lane had a persisted bundle reachable through `/api/runs/<persisted_run_id>`.
- Refresh hydration succeeded for every executed lane in the certifying artifacts.
- Providers tab was surfaced. The OpenRouter provider was detected through `presetId: openrouter`; DeepSeek V4 Pro was visible in registry/catalog data.

## Intermediate Failed Attempts

- `reports/release-gauntlet/ui-manual/2026-05-24T11-38-47Z-lane-cert/`: driver readiness bug; no lanes certified.
- `reports/release-gauntlet/ui-manual/2026-05-24T11-52-25Z-lane-cert/`: Personality and Benchmark dispatched; later lanes no-oped after browser health became stale/offline from Crucible read-rate limiting. Benchmark refresh hydration was rerun cleanly in the later Benchmark-only pass.
- `reports/release-gauntlet/ui-manual/2026-05-24T11-56-37Z-lane-cert/`: remaining lanes no-oped because the browser retained stale `state.health.net.ok=false` after `/api/health` returned `429`.

## Rate-Limit Finding

During the first broad sweep, the browser health check hit Crucible's own read-rate limit: `/api/health` returned `429`, setting UI health to offline. Because the browser kept stale offline health, `gateSelectedModels()` blocked cloud model dispatch until health was explicitly refreshed after cooldown. Running the remaining lanes with forced health refresh and 45-second gaps avoided the no-op dispatch path.

## Metadata Addendum (added at archive time)

- Archive commit hash (at time of archiving these artifacts): `6820c80ae26fa2193e76373c133a1241c8909e9c` (`fix crucible benchmark status fallback evidence leak`).
- Dirty-tree status at archive time: clean apart from the untracked manual UI evidence directories themselves and this certification document.
- Browser used for the certifying passes: Chromium-based manual browser driven against `http://127.0.0.1:18795`.
- The lane-cert sub-directories include `lane-cert.json`, `lane-cert.md`, and per-lane screenshots; the original `lane-cert.json` payloads embed `baseUrl`, `modelId`, `outDir`, `generatedAt`, and per-lane `persistedRunId` evidence pointers.
- Failed-row classification/stage/reason was **not** exercised by any certifying pass because no default-selected run produced a failed row. UI cert remains partial until a failed-row path is exercised.
- The `2026-05-24T11-38-47Z-lane-cert/`, `2026-05-24T11-52-25Z-lane-cert/`, and `2026-05-24T11-56-37Z-lane-cert/` sub-directories are preserved as the evidence trail for the self-rate-limit finding. They are explicitly NOT a passing certification — they are the failed-mid-sweep evidence that motivated the `/api/health` 429 hardening landed in the same commit as this archive.
