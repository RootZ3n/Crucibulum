# Crucible Manual Browser Lane Certification

- Generated: 2026-05-24T11:55:07.479Z
- Browser URL: http://127.0.0.1:18795
- Certified target model: deepseek/deepseek-v4-pro
- Visible runnable lanes: personality, benchmark, poison, build, safety, memory, tools, trust
- Providers tab surfaced: yes

| Lane | Default selected tasks | Status | Catch-all strings | Failed-row metadata | Evidence | Refresh hydration | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| personality | classification-001 | complete | 0 unreachable / 0 interrupted | ok | ok (1) | ok (run_2026-05-24_classification-001_deepseek-deepseek-v4-pro_cfb327e1) | personality.png |
| benchmark | code-001 | complete | 0 unreachable / 0 interrupted | ok | ok (1) | failed | benchmark.png |
| poison | poison-001 | unknown | 0 unreachable / 0 interrupted | ok | check failed (0) | not checked | poison.png |
| build | coord-001 | unknown | 0 unreachable / 0 interrupted | ok | check failed (0) | not checked | build.png |
| safety | safety-001 | unknown | 0 unreachable / 0 interrupted | ok | check failed (0) | not checked | safety.png |
| memory | memory-001 | unknown | 0 unreachable / 0 interrupted | ok | check failed (0) | not checked | memory.png |
| tools | tool-001 | unknown | 0 unreachable / 0 interrupted | ok | check failed (0) | not checked | tools.png |
| trust | op-001 | unknown | 0 unreachable / 0 interrupted | ok | check failed (0) | not checked | trust.png |
| providers | n/a | surfaced | 0 unreachable / 0 interrupted | n/a | registry check failed | n/a | providers.png |

## Lane Details

### personality
- Summary: n/a
- Counts: {"planned":1,"queued":0,"started":0,"completed":1,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: Run all 1 selected: 1 test × 1 model = 1 run planned. | Running Classification 001 on deepseek/deepseek-v4-pro… (1/1 planned) | Queued classification-001 on deepseek/deepseek-v4-pro. | Run ID: run_mpjpxk0n_5228a489 | [classification-001 :: deepseek/deepseek-v4-pro] Target classification-001 via openrouter/deepseek/deepseek-v4-pro (1 run) — Resolved registered model deepseek/deepseek-v4-pro for openrouter/openrouter. | [classification-001 :: deepseek/deepseek-v4-pro] Run 1/1 executing | [classification-001 :: deepseek/deepseek-v4-pro] Question 1/10 (CL1-Q1) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 1/10 (CL1-Q1) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 2/10 (CL1-Q2) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 2/10 (CL1-Q2) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 3/10 (CL1-Q3) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 3/10 (CL1-Q3) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 4/10 (CL1-Q4) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 4/10 (CL1-Q4) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 5/10 (CL1-Q5) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 5/10 (CL1-Q5) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 6/10 (CL1-Q6) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 6/10 (CL1-Q6) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 7/10 (CL1-Q7) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 7/10 (CL1-Q7) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 8/10 (CL1-Q8) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 8/10 (CL1-Q8) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 9/10 (CL1-Q9) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 9/10 (CL1-Q9) PASS | [classification-001 :: deepseek/deepseek-v4-pro] Question 10/10 (CL1-Q10) sending | [classification-001 :: deepseek/deepseek-v4-pro] Question 10/10 (CL1-Q10) PASS | [classification-001 :: deepseek/deepseek-v4-pro] STRONG_PASS at 100% | Done. 1 of 1 actually ran — 1 passed.
- Failed rows: none
- Evidence checks: classification-001:run_2026-05-24_classification-001_deepseek-deepseek-v4-pro_cfb327e1:200:bundle

### benchmark
- Summary: n/a
- Counts: {"planned":1,"queued":0,"started":0,"completed":1,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: Run all 1 selected: 1 test × 1 model = 1 run planned. | Running Code 001 on deepseek/deepseek-v4-pro… (1/1 planned) | Queued code-001 on deepseek/deepseek-v4-pro. | Run ID: run_mpjpykn4_c2f4532f | [code-001 :: deepseek/deepseek-v4-pro] Target code-001 via openrouter/deepseek/deepseek-v4-pro (1 run) — Resolved registered model deepseek/deepseek-v4-pro for openrouter/openrouter. | [code-001 :: deepseek/deepseek-v4-pro] Run 1/1 executing | [code-001 :: deepseek/deepseek-v4-pro] Question 1/8 (CD1-Q1) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 1/8 (CD1-Q1) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 2/8 (CD1-Q2) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 2/8 (CD1-Q2) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 3/8 (CD1-Q3) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 3/8 (CD1-Q3) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 4/8 (CD1-Q4) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 4/8 (CD1-Q4) FAIL | [code-001 :: deepseek/deepseek-v4-pro] Question 5/8 (CD1-Q5) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 5/8 (CD1-Q5) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 6/8 (CD1-Q6) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 6/8 (CD1-Q6) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 7/8 (CD1-Q7) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 7/8 (CD1-Q7) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 8/8 (CD1-Q8) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 8/8 (CD1-Q8) PASS | [code-001 :: deepseek/deepseek-v4-pro] PASS at 89% | Done. 1 of 1 actually ran — 1 passed.
- Failed rows: none
- Evidence checks: code-001:run_2026-05-24_code-001_deepseek-deepseek-v4-pro_12f305ce:200:bundle

### poison
- Summary: n/a
- Counts: {"planned":0,"queued":0,"started":0,"completed":0,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: n/a
- Failed rows: none
- Evidence checks: none

### build
- Summary: n/a
- Counts: {"planned":0,"queued":0,"started":0,"completed":0,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: n/a
- Failed rows: none
- Evidence checks: none

### safety
- Summary: n/a
- Counts: {"planned":0,"queued":0,"started":0,"completed":0,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: n/a
- Failed rows: none
- Evidence checks: none

### memory
- Summary: n/a
- Counts: {"planned":0,"queued":0,"started":0,"completed":0,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: n/a
- Failed rows: none
- Evidence checks: none

### tools
- Summary: n/a
- Counts: {"planned":0,"queued":0,"started":0,"completed":0,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: n/a
- Failed rows: none
- Evidence checks: none

### trust
- Summary: n/a
- Counts: {"planned":0,"queued":0,"started":0,"completed":0,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: n/a
- Failed rows: none
- Evidence checks: none

## Providers
- Registry providers: 1
- Registry models: 5
- Catalog models: 5
- OpenRouter configured: no
- DeepSeek V4 Pro visible: no
