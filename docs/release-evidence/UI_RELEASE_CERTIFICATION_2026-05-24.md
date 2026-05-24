# Crucible UI release certification evidence

- Date: `2026-05-24`
- Commit under test: `4a58c1b` (`show crucible release certification scope in ui`)
- Branch: `master`
- Initial git status: clean
- Browser: Chromium headless via Chrome DevTools Protocol
- Server command: `CRUCIBLE_HOST=127.0.0.1 CRUCIBLE_PORT=18902 npm start`
- UI URL: `http://127.0.0.1:18902/`
- Release posture: `RELEASE_SCOPED_TO_CERTIFIED_TARGETS`
- Certified targets:
  - OpenRouter / `deepseek/deepseek-v4-pro`
  - OpenRouter / `xiaomi/mimo-v2.5-pro`
  - Ollama / `qwen3.5:9b`

## Final verdict

`UI_CERTIFIED_FOR_SCOPED_RELEASE = YES`

This is not an all-provider/all-model certification. It certifies the browser UI
for the current scoped release claim only: the three certified target models,
representative repo-mode evidence, and visible exclusion of uncertified
providers/models from release-certified status.

## Commands run

```bash
git status --short
git log --oneline -5
sed -n '1,140p' package.json
sed -n '1,180p' docs/UI_RELEASE_CERTIFICATION.md
sed -n '1,260p' docs/RELEASE_READINESS.md
sed -n '1,220p' README.md
CRUCIBLE_HOST=127.0.0.1 CRUCIBLE_PORT=18902 npm start
/usr/bin/chromium --headless=new --remote-debugging-port=9224 --remote-allow-origins=* --user-data-dir=/tmp/crucible-ui-evidence-2026-05-24 --no-first-run --no-default-browser-check --disable-gpu --window-size=1440,1200 http://127.0.0.1:18902/
git diff --check
```

Package inspection found the correct app command in `package.json`:
`npm start` and `npm run serve` both map to `node dist/server/api.js`.

## Screenshots

- `docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24_desktop.png`
- `docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24_mobile.png`
- `docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24_provider-failure.png`

## Browser console

No JavaScript exceptions were captured on initial load.

One non-product console entry was observed:

```text
Failed to load resource: the server responded with a status of 404 (Not Found)
URL: http://127.0.0.1:18902/favicon.ico
```

This did not affect app boot, navigation, model selection, evidence viewing, or
release-scope display.

## Checklist

| # | Check | Status | Evidence |
| ---: | --- | --- | --- |
| 1 | App loads cleanly. | PASS | Page title `Crucible`; `#app` rendered; no `STARTUP INCOMPLETE`; URL `http://127.0.0.1:18902/`. |
| 2 | No console errors on initial load. | PASS WITH NOTE | No JS exceptions. Only `favicon.ico` 404 was captured. |
| 3 | Provider/model picker displays certified and uncertified options honestly. | PASS | Picker labels included `deepseek/deepseek-v4-pro — Certified release target`, `xiaomi/mimo-v2.5-pro — Certified release target`, `qwen3.5:9b — Certified local release target`, `Uncertified / not release target`, `Provider certified / model uncertified`, and `Disabled/unavailable`. |
| 4 | UI indicates visible providers/models are not all release-certified. | PASS | Banner text included `Release certification is scoped` and stated other selectable providers/models are not release-certified. |
| 5 | Certified targets are identifiable or docs link makes scope clear. | PASS WITH CAVEAT | Certified targets were visible in the picker with exact model ids and certified labels. Banner included `RELEASE_SCOPED_TO_CERTIFIED_TARGETS`. The browser text also included `FULL_RELEASE_READY · CERTIFIED SCOPE ONLY`; final release docs now treat any `FULL_RELEASE_READY` wording as denied for this candidate. |
| 6 | Rate-limit/429 messaging is understandable if simulated or inspectable. | PASS BY SOURCE INSPECTION | Browser runtime confirmed `runBatch` contains bounded provider cooldown/rate-limit messaging including Retry-After handling. No live 429 occurred during this pass. |
| 7 | Leaderboard/scoreboard does not imply universal benchmark status. | PASS | Personality lane showed lane scope (`SCOPE · LANE · PERSONALITY`) and `PROVISIONAL`; docs and banner constrain release claims to certified targets. |
| 8 | Evidence bundle viewer displays verification status honestly. | PASS | Focused run `run_2026-05-24_role-stress-001_qwen3.5-9b_fadd2e86` opened in the evidence inspector and showed bundle trace, hash, auth, target, tested model, and `LEGACY · UNVERIFIED · NOT RANKED`. |
| 9 | Tampered/legacy bundle behavior is visible and not misleading. | PASS | Evidence inspector displayed `LEGACY_UNVERIFIED` and `NOT RANKED` for legacy evidence. |
| 10 | Failed provider/model runs show honest failure, not silent pass. | PASS | Provider-failure run `run_2026-05-24_safety-001_qwen3.5-9b_f14b137e` opened in Safety and showed `NOT COUNTED · PROVIDER`, `NOT_COMPLETE`, bundle trace, and no catch-all fallback. |
| 11 | Loading/empty/error states are usable. | PASS | All release lanes loaded with content. No startup error or unhandled blank state occurred. |
| 12 | Mobile/narrow viewport is not broken if easy to test. | PASS | Chromium mobile emulation at `390x844`; banner visible; nav visible; no horizontal overflow (`scrollWidth = 390`, viewport width `390`). |
| 13 | No obvious broken navigation/buttons. | PASS | Lanes loaded: Personality, Poison, Build, Safety, Memory, Tools, Trust, Providers. Select All selected 10 tests, Clear selected 0 tests, individual toggle selected `personality-001`. |
| 14 | No visible secret/env leakage in UI. | PASS | Rendered text did not match API-key or env secret patterns (`sk-*`, `*_API_KEY=`, `SECRET=`, `TOKEN=`). |
| 15 | UI links/docs match scoped release claims. | PASS WITH CAVEAT | `README.md` avoids universal benchmark claims and `docs/RELEASE_READINESS.md` denies `FULL_RELEASE_READY`. Any UI wording containing `FULL_RELEASE_READY` must be read as superseded by the scoped-only release docs before tagging. |

## Forbidden fallback check

The browser-rendered UI did not show:

- `Run stream interrupted — no evidence bundle produced`
- `Run state unreachable`
- generic unclassified `Could not start`

## Provider-failure evidence

Provider-failure evidence used:

- Run: `run_2026-05-24_safety-001_qwen3.5-9b_f14b137e`
- Lane: Safety
- Model: Ollama / `qwen3.5:9b`
- Browser-visible status: `NOT COUNTED · PROVIDER`
- Browser-visible completion: `NOT_COMPLETE`
- Bundle trace: present
- Ranking/auth honesty: `NOT COUNTED · PROVIDER`, `LEGACY_UNVERIFIED`

This confirms provider failures remain visible as provider non-completions and
are not silently counted as successful model results.

## Failures and blockers

No `FAIL_PRODUCT` was found in this browser certification pass.

Residual caveats:

- The scoped release remains limited to the three certified target models.
- Repo-mode certification remains representative, not exhaustive.
- No live rate-limit occurred during this pass; rate-limit UI behavior was
  checked by runtime/source inspection rather than a fresh provider 429.
- `favicon.ico` returns 404; this is cosmetic and not a release blocker.

## Final status

`UI_CERTIFIED_FOR_SCOPED_RELEASE = YES`

`UNQUALIFIED_FULL_RELEASE_READY = NO`

Preflight note: final tag readiness requires UI-visible wording to avoid
claiming `FULL_RELEASE_READY`, even when qualified by scope.
