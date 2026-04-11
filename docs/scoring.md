# Crucibulum Scoring

## Public vs Internal Scale

Public API, leaderboard, and score-sync outputs use `0-100` percentages.

Evidence bundles still store internal totals as `0-1` fractions for backward compatibility, but bundles now include:

- `score.scale`
- `score.total_percent`
- `score.breakdown_percent`
- `score.pass_threshold_percent`

## Repo Task Scoring

Repo tasks use weighted scoring across:

- correctness
- regression
- integrity
- efficiency

Typical default weights in the corpus are:

- correctness: `0.50`
- regression: `0.20`
- integrity: `0.20`
- efficiency: `0.10`

A repo task passes when:

- total score meets or exceeds the task pass threshold
- integrity violations are zero

## Conversational Scoring

Conversational tasks use:

- weighted deterministic question scoring
- an efficiency component derived from elapsed time and token usage

The current conversational total is:

- `85%` question-score aggregate
- `15%` efficiency score

This replaces the previous placeholder behavior where conversational efficiency always scored as `1.0`.

## Family Rollups

Public rollups use lettered families `A-I` for compatibility with shared score storage.

Those family rollups are defined centrally in `types/scores.ts`. They must not be redefined independently in API, UI, or DB code.
