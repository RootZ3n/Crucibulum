# Crucible × Colosseum cross-reference — context-degradation-001

| Field | Value |
|---|---|
| Audit date | 2026-05-27 |
| Trigger | Hermes cross-framework analysis noting "repeated 43 score across unrelated model families" on context-degradation-001 |
| Disposition | **No cross-framework agreement should be claimed for this specific test until its scoring contract is clearly documented.** |

## What Colosseum and Crucible measure differently

Colosseum's context / agent behaviour metrics are not directly
comparable to Crucible's `context-degradation-001` for two reasons:

1. **Different scorer contract.** Crucible's
   `context-degradation-001` is a 3-question `text_match_all`
   substring test. Pass requires the literal phrases
   (e.g. `"two"`, `"200 client"`). Models that paraphrase
   ("2 engineers", "200 clients") fail per-question even when
   semantically correct. Colosseum's context retention metric does
   not exercise these substring-fragility points the same way.
2. **Different composite formula.** Crucible's conversational lane
   composite is
   `total = round((correctness × 0.85 + efficiency × 0.15) × 100) / 100`
   (see `core/conversational-runner.ts:358`). Two Crucible runs
   with identical per-question outcomes will produce the same
   composite. Colosseum's lane composite is a separate computation
   in a separate codebase; nothing requires the two numerical
   scores to coincide.

The repeated "43" across many Crucible bundles is the deterministic
output of the formula on the deterministic "1-of-3 PASS at
efficiency ≈ 1" outcome (CTX1-Q2 typically passes; CTX1-Q1 and
CTX1-Q3 typically fail on the substring fragility points). It is
**not** a cross-framework signal that those models behave the same
on Colosseum.

## Tool / safety comparison framing

Tool-calling and safety comparisons across Crucible and Colosseum
remain useful — those families have more semantically-tight scorers
where substring fragility is not the dominant failure mode. But
**`context-degradation-001` specifically should not be cited as a
cross-framework agreement / disagreement until either:**

- The Crucible scorer is calibrated to tolerate "2"/"two" and
  "200 client"/"200 clients" paraphrasing, OR
- A separate paraphrase-tolerant `context-degradation-002` lands
  in the truthfulness family.

Both are out of scope for the 2026-05-27 scoring-integrity audit
(which only confirms that 43 is valid under the published
formula). They are reasonable Phase-15 candidates if the
test-validity working group wants paraphrase-tolerant successors.

## What this report does NOT claim

- It does **not** claim Crucible's `text_match_all` substring
  scorer is the "right" measurement of context degradation in
  general. It is one operationalisation; others are valid.
- It does **not** claim Crucible and Colosseum scores can be
  arithmetically compared without normalisation across their
  respective composite formulas.
- It does **not** retroactively change any bundle, report, or
  leaderboard value. The Phase 14 / Roadmap C posture (Vision
  EXPERIMENTAL, no leaderboard impact) and the prior-phase reports
  remain unchanged.

## Action items (not blocking, future-phase candidates)

- Document the conversational composite formula prominently in the
  UI's per-test detail view so consumers don't read
  `total_percent` in isolation from `breakdown_percent.correctness`.
- Consider a paraphrase-tolerant `context-degradation-002` in a
  later phase (out of scope for the integrity audit).
- Keep the new `validateBinaryConversationalBundleScoreShape`
  invariant active in CI so any *real* future pipeline bug that
  produces impossible scores fails fast.
