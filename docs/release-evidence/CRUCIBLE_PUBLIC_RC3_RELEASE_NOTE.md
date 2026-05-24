# Crucible public scoped release candidate 3

Commit: 7321c50

Tag: crucible-public-rc3

Verdict: READY_FOR_SCOPED_TAG

FULL_RELEASE_READY = NO

RELEASE_SCOPED_TO_CERTIFIED_TARGETS = YES

UI_CERTIFIED_FOR_SCOPED_RELEASE = YES

## Certified Targets

- OpenRouter / deepseek/deepseek-v4-pro
- OpenRouter / xiaomi/mimo-v2.5-pro
- Ollama / qwen3.5:9b

## UI Evidence

- docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24.md
- docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24_desktop.png
- docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24_mobile.png
- docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24_provider-failure.png

## Caveats

- Visible providers/models outside the certified list are not release-certified.
- Repo-mode is representative smoke only.
- Real provider gauntlet was not rerun in final preflight.
- Provider failures are classified separately and not counted as passes.

## Validation

- npm run typecheck passed.
- npm test passed, 913/913.
- Release gauntlet dry-run inventory passed, 21 families, 62 tasks, 12 adapters.
