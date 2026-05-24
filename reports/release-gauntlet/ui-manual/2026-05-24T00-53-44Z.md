# Crucible manual UI certification

- Date/time: `2026-05-24T00:53:44Z`
- Commit: `b2762ccd55a62e188ab16f66658f7404581b5915`
- Branch: `master`
- Dirty tree at start: `false`
- Dirty tree during report write: `true` (report artifact only)
- Browser: Chromium headless via Chrome DevTools Protocol
- Server: `http://127.0.0.1:18896/`
- Screenshot: `reports/release-gauntlet/ui-manual/2026-05-24-ui-manual-scope-failure.png`

## Verdict

`UI_CERTIFIED = NO`

`FULL_RELEASE_READY = NO`

Classification: `FAIL_PRODUCT`

The browser UI did not make the certified release scope visible/honest. The
manual checklist requires certified target providers/models to be clear and
uncertified providers/models not to be implied release-ready. In the browser,
the certified target model ids were present in the picker, and many
uncertified providers/models were also visible, but no release-certification
text or certified/uncertified marker was present.

Because this is a manual UI certification blocker, provider/model batch runs
were not started. This avoided API spend after the gate had already failed.

## Certified Target Models

| Provider | Adapter | Model | Browser result |
| --- | --- | --- | --- |
| OpenRouter | `openrouter` | `deepseek/deepseek-v4-pro` | Present in picker; not marked release-certified |
| OpenRouter | `openrouter` | `xiaomi/mimo-v2.5-pro` | Present in picker; not marked release-certified |
| Ollama | `ollama` | `qwen3.5:9b` | Present in picker; not marked release-certified |

## Scope Honesty Check

Observed certified-scope text in browser:

- `release-certified`: absent
- `certified release target`: absent
- `UNCERTIFIED_NOT_RELEASE_TARGET`: absent
- `FULL_RELEASE_READY`: absent
- `RELEASE_SCOPED_TO_CERTIFIED_TARGETS`: absent

Uncertified picker models visible in the same UI inventory included:

- `gpt-5.4`
- `claude-opus-4-6`
- `abab6.5s-chat`
- `z-ai/glm-5.1`
- `deepseek/deepseek-v4-flash`
- `xiaomi/mimo-v2.5`

This does not prove those models are run-ready or certified, but the UI also
does not label them as outside the release-certified target set.

## Lane And Selection Checks Completed Before Stop

The browser loaded the UI and exposed these lanes:

- Personality
- Poison
- Build
- Safety
- Memory
- Tools
- Trust
- Providers

Selection behavior checked in the Personality lane:

- Initial selected task: `classification-001`
- Select all: `10` selected
- Clear: `0` selected
- Individual select: `personality-001`
- Run count changed to `1`

## Forbidden Fallback Text Check

At the time the gate stopped, the rendered page did not show:

- `Run stream interrupted`
- `Run state unreachable`
- generic `Could not start`

No provider failures or cooldowns occurred because provider runs were not
started after the scope-honesty blocker was found.

## Counts

| Class | Count |
| --- | ---: |
| PASS | 2 |
| FAIL_PRODUCT | 1 |
| FAIL_PROVIDER | 0 |
| FAIL_CONFIG | 0 |
| BLOCKED | 0 |
| SKIPPED_EXPLAINED | 3 |

PASS items:

- Browser UI loaded with expected lanes.
- Select all / clear / individual selection behavior worked in the Personality lane.

FAIL_PRODUCT item:

- Certified release scope is not visible/honest in the browser UI.

SKIPPED_EXPLAINED items:

- OpenRouter `deepseek/deepseek-v4-pro` certified-set run skipped after UI scope blocker.
- OpenRouter `xiaomi/mimo-v2.5-pro` certified-set run skipped after UI scope blocker.
- Ollama `qwen3.5:9b` certified-set run skipped after UI scope blocker.

## Required Fix Before Reattempt

Add browser-visible release scope language near the model picker or run controls:

- current state is `RELEASE_SCOPED_TO_CERTIFIED_TARGETS`, not unqualified full release
- certified targets are only OpenRouter DeepSeek, OpenRouter Mimo, and Ollama `qwen3.5:9b`
- visible uncertified providers/models are operator-selectable but not release-certified
- repo-mode is representative smoke only

Then rerun this manual checklist and provider/model browser runs.
