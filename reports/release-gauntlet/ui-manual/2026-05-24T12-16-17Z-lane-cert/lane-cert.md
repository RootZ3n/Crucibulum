# Crucible Manual Browser Lane Certification

- Generated: 2026-05-24T12:17:57.581Z
- Browser URL: http://127.0.0.1:18795
- Certified target model: deepseek/deepseek-v4-pro
- Visible runnable lanes: benchmark
- Providers tab surfaced: yes

| Lane | Default selected tasks | Status | Catch-all strings | Failed-row metadata | Evidence | Refresh hydration | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | --- |
| benchmark | code-001 | complete | 0 unreachable / 0 interrupted | ok | ok (1) | ok (run_2026-05-24_code-001_deepseek-deepseek-v4-pro_4574ace9) | benchmark.png |
| providers | n/a | surfaced | 0 unreachable / 0 interrupted | n/a | registry ok | n/a | providers.png |

## Lane Details

### benchmark
- Summary: n/a
- Counts: {"planned":1,"queued":0,"started":0,"completed":1,"failed":0,"could_not_start":0,"skipped_by_preflight":0}
- Activity lines: Run all 1 selected: 1 test × 1 model = 1 run planned. | Running Code 001 on deepseek/deepseek-v4-pro… (1/1 planned) | Queued code-001 on deepseek/deepseek-v4-pro. | Run ID: run_mpjqrmq6_54a8d9c0 | [code-001 :: deepseek/deepseek-v4-pro] Target code-001 via openrouter/deepseek/deepseek-v4-pro (1 run) — Resolved registered model deepseek/deepseek-v4-pro for openrouter/openrouter. | [code-001 :: deepseek/deepseek-v4-pro] Run 1/1 executing | [code-001 :: deepseek/deepseek-v4-pro] Question 1/8 (CD1-Q1) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 1/8 (CD1-Q1) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 2/8 (CD1-Q2) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 2/8 (CD1-Q2) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 3/8 (CD1-Q3) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 3/8 (CD1-Q3) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 4/8 (CD1-Q4) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 4/8 (CD1-Q4) FAIL | [code-001 :: deepseek/deepseek-v4-pro] Question 5/8 (CD1-Q5) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 5/8 (CD1-Q5) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 6/8 (CD1-Q6) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 6/8 (CD1-Q6) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 7/8 (CD1-Q7) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 7/8 (CD1-Q7) PASS | [code-001 :: deepseek/deepseek-v4-pro] Question 8/8 (CD1-Q8) sending | [code-001 :: deepseek/deepseek-v4-pro] Question 8/8 (CD1-Q8) PASS | [code-001 :: deepseek/deepseek-v4-pro] PASS at 89% | Done. 1 of 1 actually ran — 1 passed.
- Failed rows: none
- Evidence checks: code-001:run_2026-05-24_code-001_deepseek-deepseek-v4-pro_4574ace9:200:bundle

## Providers
- Registry providers: 1
- Registry models: 5
- Catalog models: 5
- OpenRouter configured: yes
- DeepSeek V4 Pro visible: yes
