# Crucible UI release certification checklist

This checklist is the manual/browser half of release certification. The
automated `--ui-shape` gauntlet check only proves the expected UI code paths
are present; it does not prove a browser successfully drove them.

Current status: `UI_CERTIFIED = YES` for the certified target scope archived
in `docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24.md` and
`reports/release-gauntlet/ui-manual/2026-05-24T01-36-16Z.md`. Passing
automated UI-shape checks alone does not make Crucible unqualified
`FULL_RELEASE_READY`.

Latest passing attempt:
`docs/release-evidence/UI_RELEASE_CERTIFICATION_2026-05-24.md`
and
`reports/release-gauntlet/ui-manual/2026-05-24T01-36-16Z.md`.

Previous failed attempt:
`reports/release-gauntlet/ui-manual/2026-05-24T00-53-44Z.md` stopped as
`FAIL_PRODUCT` because the browser UI did not visibly distinguish certified
release targets from other operator-selectable providers/models.

Before `UI_CERTIFIED=YES`, record the browser, viewport, provider/model, task
selection, report path, and operator initials in the release notes.

Use one certified release-target model for the certification run:

| Provider | Adapter | Model |
| --- | --- | --- |
| OpenRouter | `openrouter` | `deepseek/deepseek-v4-pro` |
| OpenRouter | `openrouter` | `xiaomi/mimo-v2.5-pro` |
| Ollama | `ollama` | `qwen3.5:9b` |

Models and providers visible in the UI but absent from this table are
operator-selectable, not release-certified.

Required checks:

1. Open the Crucible UI and select each release lane at least once:
   Personality, Poison, Build, Safety, Memory, Tools, Trust, Providers.
2. Select a certified release-target provider/model.
3. Confirm certified/uncertified model labels are visible in the picker:
   certified targets must say `Certified release target` or
   `Certified local release target`, while other visible providers/models must
   say `Uncertified / not release target`, `Provider certified / model
   uncertified`, or `Disabled/unavailable`.
4. Confirm the scoped release banner says visible non-target models are
   selectable for testing but not release-certified.
5. Run a 10-test selected batch.
6. If the provider rate-limits, confirm the cooldown/backoff message appears
   and the run is classified as provider/network, not product evidence loss.
7. Open the evidence inspector for a completed run and confirm it loads the
   matching bundle.
8. Open evidence for a failed provider run and confirm the minimal failure
   receipt hydrates.
9. Refresh the page and reopen the same completed and failed evidence records.
10. Confirm no row shows `Run stream interrupted` for a structured provider
   failure.
11. Confirm no row shows `Run state unreachable` when a bundle exists.
12. Export the relevant drilldown/report and archive it with the release
    evidence.

If this checklist is not completed for a future release candidate,
`UI_CERTIFIED` must return to `NO` for that candidate.
