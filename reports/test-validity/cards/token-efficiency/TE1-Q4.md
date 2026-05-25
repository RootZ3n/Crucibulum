# Test card · TE1-Q4 (token-efficiency)

| Field | Value |
|---|---|
| Test id | `TE1-Q4` |
| Family | `cost_efficiency` (`tasks/token-efficiency/token-efficiency-001/`) |
| Scorer | `regex_match` |
| Status | **VALID_STRICT_NUMERIC** — keep ranked |

## What it measures

Same as TE1-Q1: arithmetic + token efficiency. This is the question
that drew the operator's attention in the 2026-05-25 audit because
the focused-run inspector showed Q1's "Got: 6" next to Q4's
`/^\s*425\s*$/` pattern.

## Exact prompt

> Reply with ONLY the number.
>
> A library has 530 books on loan. 142 are returned, 75 are then
> re-loaned, then 38 more are returned. How many books are
> currently on loan?

## Expected correct answer

**425**

## Why that answer is correct

530 − 142 + 75 − 38 = 425

- Start: 530 on loan
- 142 returned → 388 on loan
- 75 re-loaned (i.e. loaned back out) → 463 on loan
- 38 more returned → **425 on loan**

The phrase "re-loaned" can only sensibly mean "loaned out again"
(adds to the count of books on loan). Treating it as "subtracted
again" gives 351 (the model's actual wrong answer) and contradicts
the verb.

## How it is scored

Pattern: `^\s*425\s*$` (regex). `maxLength: 12`. Same family
contract as TE1-Q1.

## Partial credit

None — same as Q1.

## What would be a false fail

- Model answers `425 books`, `425.0`, `Four hundred twenty-five` —
  all rejected by design.

## What would be a false pass

None identified. `\s*425\s*` cannot match adjacent digits (`4250`,
`1425`, etc.).

## Audit history

- 2026-05-25 — deepseek-v4-flash answered `351`. Operator initially
  read the screenshot as "model answered 6 to the 425 question" —
  that was a visual conflation of two separate failures (Q1 said
  6, Q4 said 351) in the same run. Both are genuine FAIL_PRODUCT.
- See `reports/test-validity/token-efficiency-425-failure.md` for
  the full root-cause report.
