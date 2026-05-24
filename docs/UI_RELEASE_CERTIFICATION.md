# Crucible UI release certification checklist

This checklist is the manual/browser half of release certification. The
automated `--ui-shape` gauntlet check only proves the expected UI code paths
are present; it does not prove a browser successfully drove them.

Before `UI_CERTIFIED=YES`, record the browser, viewport, provider/model, task
selection, report path, and operator initials in the release notes.

Required checks:

1. Open the Crucible UI and select each release lane at least once:
   Personality, Poison, Build, Safety, Memory, Tools, Trust, Providers.
2. Select a certified release-target provider/model.
3. Run a 10-test selected batch.
4. If the provider rate-limits, confirm the cooldown/backoff message appears
   and the run is classified as provider/network, not product evidence loss.
5. Open the evidence inspector for a completed run and confirm it loads the
   matching bundle.
6. Open evidence for a failed provider run and confirm the minimal failure
   receipt hydrates.
7. Refresh the page and reopen the same completed and failed evidence records.
8. Confirm no row shows `Run stream interrupted` for a structured provider
   failure.
9. Confirm no row shows `Run state unreachable` when a bundle exists.
10. Export the relevant drilldown/report and archive it with the release
    evidence.

Until this checklist is completed for the current release candidate,
`UI_CERTIFIED` remains `NO`.
