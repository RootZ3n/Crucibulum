# Crucible Personality Tests

Scope: the Personality lane covers conversational fixtures whose families are `personality` and `identity`. It intentionally does not cover poison-repo, benchmark/spec, build, safety, or memory scoring.

## What They Measure

Personality tests measure whether a model can keep useful voice and behavior traits while still answering the task:

- directness without excessive hedging
- avoidance of corporate filler
- honest refusal to fabricate unavailable data
- consistent casual/technical tone
- self-knowledge from the system prompt
- strict role and output-shape adherence for personality-lane spillover tasks
- prompt phrasing stability

They do not measure broad benchmark skill, repository editing ability, safety policy coverage, memory retention, or release readiness outside this lane.

## Scoring Categories

`personality_evaluation.category` is explanatory. It does not change the deterministic score.

- `STRONG_PERSONALITY`: pass-threshold met with near-complete trait coverage.
- `ADEQUATE_PERSONALITY`: pass-threshold met, or meaningful partial personality behavior below a perfect score.
- `WEAK_PERSONALITY`: completed response missed the measured trait or format.
- `OVERDONE_ROLEPLAY`: style was exaggerated enough to displace the task.
- `TRUTHFUL_BUT_FLAT`: response preserved honesty but gave little useful personality or task help.
- `STYLE_MISMATCH`: response used disallowed corporate/boilerplate tone.
- `EMPTY_RESPONSE`, `PROVIDER_FAILURE`, `TIMEOUT`: the model was not fairly evaluated.
- `JUDGE_FAILURE`, `PARSER_FAILURE`, `RUBRIC_MISMATCH`: scoring infrastructure or fixture issue.
- `UNKNOWN`: insufficient evidence for a stronger category.

## Examples

Strong/direct:

```text
Use Fastify. It is the cleaner default for a new TypeScript API.
```

Weak/corporate:

```text
Certainly, great question. I'd be happy to help you debug this.
```

Truthful but flat:

```text
I don't know. I cannot verify that receipt.
```

Overdone:

```text
Behold, dear traveler, tonight I shall embark upon a quest instead of debugging.
```

## Known Limitations

The current judge is deterministic. It catches the behaviors encoded in each fixture, but it is not a full literary-style evaluator. Corporate-speak and hedge checks are phrase based. Regex tasks verify constrained output shape and accepted answers, not the complete range of possible good personality. Optional model review remains advisory and is reported through judge usage, not treated as authoritative.

Release readiness: guarded-pass for the personality lane after the May 16, 2026 audit. The lane now distinguishes personality failures from empty/provider/timeout/parser/rubric/judge failures and exposes that classification through bundles, API summaries, UI drilldowns, and exports.
