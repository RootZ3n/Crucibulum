# Test card · TE1-Q1 (token-efficiency)

| Field | Value |
|---|---|
| Test id | `TE1-Q1` |
| Family | `cost_efficiency` (`tasks/token-efficiency/token-efficiency-001/`) |
| Scorer | `regex_match` |
| Status | **VALID_STRICT_NUMERIC** — keep ranked |

## What it measures

Token efficiency: can the model answer a small arithmetic word
problem with **only** the number, no commentary? The family's whole
point is concision under explicit instruction.

## Exact prompt

> Reply with ONLY the number.
>
> A team has 18 queued tickets. They close 7, reopen 2 of those,
> then 5 new tickets arrive, then they close 2 more. How many
> tickets remain?

## Expected correct answer

**16**

## Why that answer is correct

18 − 7 + 2 + 5 − 2 = 16

- Start: 18 queued
- Close 7 → 11 queued
- Reopen 2 of the closed ones → 13 queued
- 5 new arrive → 18 queued
- Close 2 more → **16 queued**

## How it is scored

Pattern: `^\s*16\s*$` (regex). The model's full response must be
the literal digits `16`, optionally surrounded by whitespace, with
nothing else.

`maxLength: 12` characters — generous for a 2-digit answer.

## Partial credit

None. Token-efficiency tests are pass/fail by design (concision is
the measurement).

## What would be a false fail

- Model answers `16 tickets` — correct answer, fails by design
  (token-efficiency penalises extra words).
- Model answers `sixteen` — correct concept, fails (numeric form
  required by prompt).

These are intentional. The test is not testing arithmetic in
isolation; it's testing arithmetic + concision under instruction.

## What would be a false pass

The regex `^\s*16\s*$` cannot accidentally match a 3-digit number
or a substring (`160`, `116`, `0x16` all fail). No false-pass paths
identified.

## Audit history

- 2026-05-25 — deepseek-v4-flash answered `6`; tagged FAIL_PRODUCT
  by classifier, confirmed VALID test by hand check.
  Evidence: `runs/run_2026-05-25_token-efficiency-001_deepseek-deepseek-v4-flash_06e45740.json`.
