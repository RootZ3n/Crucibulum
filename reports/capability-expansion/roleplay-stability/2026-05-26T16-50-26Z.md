# Roleplay stability report

- **Timestamp (UTC):** 2026-05-26T16-50-26Z
- **Commit:** c98fd5bf5f8c2a3e02ff2a92bba7df616dd39ea0 (dirty tree)
- **Provider/Model:** openrouter/deepseek/deepseek-v4-flash
- **Runs completed:** 3 / 3 requested
- **Cost cap:** $1.5 · **actual:** $0.0047
- **Stopped early:** no
- **Affects leaderboard:** false
- **Affects certification:** false
- **Experimental:** true

## Per-test stability

| Task | Stability | Pass | Fail | NEEDS_REVIEW | Common attribution |
|---|---|---:|---:|---:|---|
| roleplay-character-001 | INTERMITTENT_FAIL | 2 | 1 | 0 | PASS |
| roleplay-continuity-001 | INTERMITTENT_FAIL | 2 | 1 | 0 | PASS |
| roleplay-drift-001 | INTERMITTENT_FAIL | 2 | 1 | 0 | PASS |
| roleplay-refusal-001 | STABLE_PASS | 3 | 0 | 0 | PASS |
| roleplay-continuity-002 | STABLE_PASS | 3 | 0 | 0 | PASS |
| roleplay-contradiction-001 | STABLE_PASS | 3 | 0 | 0 | PASS |
| roleplay-persona-break-001 | STABLE_PASS | 3 | 0 | 0 | PASS |

## Aggregate attribution across runs

- PASS: 18
- MODEL: 3

## Per-turn stability

### roleplay-character-001

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RP1-Q1 | STABLE_PASS | 3 | 0 | 0 |
| RP1-Q2 | STABLE_PASS | 3 | 0 | 0 |
| RP1-Q3 | INTERMITTENT_FAIL | 2 | 1 | 0 |

### roleplay-continuity-001

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RP2-Q1 | STABLE_PASS | 3 | 0 | 0 |
| RP2-Q2 | INTERMITTENT_FAIL | 2 | 1 | 0 |
| RP2-Q3 | INTERMITTENT_FAIL | 2 | 1 | 0 |
| RP2-Q4 | STABLE_PASS | 3 | 0 | 0 |

### roleplay-drift-001

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RPD-Q01 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q02 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q03 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q04 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q05 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q06 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q07 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q08 | INTERMITTENT_FAIL | 2 | 1 | 0 |
| RPD-Q09 | STABLE_PASS | 3 | 0 | 0 |
| RPD-Q10 | STABLE_PASS | 3 | 0 | 0 |

### roleplay-refusal-001

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RPR-Q1 | STABLE_PASS | 3 | 0 | 0 |
| RPR-Q2 | STABLE_PASS | 3 | 0 | 0 |
| RPR-Q3 | STABLE_PASS | 3 | 0 | 0 |

### roleplay-continuity-002

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RPC2-Q1 | STABLE_PASS | 3 | 0 | 0 |
| RPC2-Q2 | STABLE_PASS | 3 | 0 | 0 |
| RPC2-Q3 | STABLE_PASS | 3 | 0 | 0 |
| RPC2-Q4 | STABLE_PASS | 3 | 0 | 0 |
| RPC2-Q5 | STABLE_PASS | 3 | 0 | 0 |

### roleplay-contradiction-001

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RPK-Q1 | STABLE_PASS | 3 | 0 | 0 |
| RPK-Q2 | STABLE_PASS | 3 | 0 | 0 |
| RPK-Q3 | STABLE_PASS | 3 | 0 | 0 |
| RPK-Q4 | STABLE_PASS | 3 | 0 | 0 |

### roleplay-persona-break-001

| Turn | Stability | Pass | Fail | NEEDS_REVIEW |
|---|---|---:|---:|---:|
| RPB-Q1 | STABLE_PASS | 3 | 0 | 0 |
| RPB-Q2 | STABLE_PASS | 3 | 0 | 0 |
| RPB-Q3 | STABLE_PASS | 3 | 0 | 0 |


## Representative failure excerpts

- **roleplay-character-001** — FAIL_PRODUCT: scenario expected an in-character refusal but no refusal signal of any kind was found [SEVERITY=SEVERE refusal missing] [INTENT=NO_REFUSAL_SIGNAL]. Got: Sets down his hammer with a heavy clank I'll stop you right there, friend
- **roleplay-continuity-001** — FAIL_PRODUCT: continuity failure — missing required facts [Sunshard locket (sunshard/locket), riverside path (riverside/river path/by the river), Mira (recipient) (mira)] [SEVERITY=HARD contradiction]. Got: Headed up the Old King's Road now
- **roleplay-drift-001** — FAIL_PRODUCT: no persona marker (archive/shelf/story/tale/volume/chronicle/quiet/adventure/section/stacks) in answer — character voice did not land [SEVERITY=MILD drift]. Got: Yes. There is a scroll in the western alcove, The Wandering Inkw
