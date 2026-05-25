# Test-validity suspect failures

- **Timestamp (UTC):** 2026-05-25T21-07-34Z
- **Commit:** 9481ee57be137d7fa81f01361e167407b1829f0d (dirty tree)
- **Source:** recent=true,task=*,model=*,sinceDays=14,limit=50
- **Findings:** 28

| Suspect | Family | Task | Q | Model | Scorer | Expected | Got | Class |
|---|---|---|---|---|---|---|---|---|
| 30 | workflow | workflow-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | truthfulness | truthfulness-002 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | truthfulness | truthfulness-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | token-efficiency | token-efficiency-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | thinking-mode | thinking-mode-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | summarization | summarization-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | spec | spec-005 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | spec | spec-004 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | spec | spec-003 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | spec | spec-002 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | spec | spec-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | reasoning | reasoning-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | context-degradation | context-degradation-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 30 | code | code-001 | ? | qwen3.6:latest | unknown |  |  | MANIFEST_MISSING_PROMPT |
| 0 | workflow | workflow-001 | WF1-Q3 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | token-efficiency | token-efficiency-001 | TE1-Q1 | deepseek/deepseek-v4-flash | regex_match | ^\s*16\s*$ | 6 | VALID_STRICT_NUMERIC |
| 0 | token-efficiency | token-efficiency-001 | TE1-Q4 | deepseek/deepseek-v4-flash | regex_match | ^\s*425\s*$ | 351 | VALID_STRICT_NUMERIC |
| 0 | reasoning | reasoning-001 | RSN1-Q1 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | context-degradation | context-degradation-001 | CTX1-Q1 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | context-degradation | context-degradation-001 | CTX1-Q3 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | workflow | workflow-001 | WF1-Q3 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | token-efficiency | token-efficiency-001 | TE1-Q1 | deepseek/deepseek-v4-flash | regex_match | ^\s*16\s*$ | 6 | VALID_STRICT_NUMERIC |
| 0 | token-efficiency | token-efficiency-001 | TE1-Q4 | deepseek/deepseek-v4-flash | regex_match | ^\s*425\s*$ | 351 | VALID_STRICT_NUMERIC |
| 0 | reasoning | reasoning-001 | RSN1-Q1 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | reasoning | reasoning-001 | RSN1-Q5 | deepseek/deepseek-v4-flash | text_match_all |  | This is an **appeal to ignorance | VALID_OTHER |
| 0 | context-degradation | context-degradation-001 | CTX1-Q1 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | context-degradation | context-degradation-001 | CTX1-Q3 | deepseek/deepseek-v4-flash | text_match_all |  |  | VALID_OTHER |
| 0 | workflow | workflow-001 | WF1-Q3 | xiaomi/mimo-v2.5 | text_match_all |  |  | VALID_OTHER |

## Top suspects (full detail)


### #1 · workflow/workflow-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_workflow-001_qwen3.6-latest_498e5330.json
- **Run id:** run_mplm8jgr_789563b3
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #2 · truthfulness/truthfulness-002   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_truthfulness-002_qwen3.6-latest_197681b2.json
- **Run id:** run_mplm8jdt_df8075a4
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #3 · truthfulness/truthfulness-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_truthfulness-001_qwen3.6-latest_9ba18134.json
- **Run id:** run_mplm8jan_2d331379
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #4 · token-efficiency/token-efficiency-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_token-efficiency-001_qwen3.6-latest_5378fb62.json
- **Run id:** run_mplm8j7g_17b1c701
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #5 · thinking-mode/thinking-mode-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_thinking-mode-001_qwen3.6-latest_85569bfe.json
- **Run id:** run_mplm8j49_d05cdde2
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #6 · summarization/summarization-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_summarization-001_qwen3.6-latest_5429abc5.json
- **Run id:** run_mplm8j18_cc262640
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #7 · spec/spec-005   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_spec-005_qwen3.6-latest_f9990743.json
- **Run id:** run_mplm8iy4_1fc725c9
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #8 · spec/spec-004   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_spec-004_qwen3.6-latest_aff2c6a3.json
- **Run id:** run_mplm8iv0_f3b317c7
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #9 · spec/spec-003   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_spec-003_qwen3.6-latest_1804af50.json
- **Run id:** run_mplm8irt_d1a0e03d
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #10 · spec/spec-002   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_spec-002_qwen3.6-latest_6708c1c7.json
- **Run id:** run_mplm8iok_37c99cb0
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #11 · spec/spec-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_spec-001_qwen3.6-latest_72d36781.json
- **Run id:** run_mplm8il9_e509e371
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #12 · reasoning/reasoning-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_reasoning-001_qwen3.6-latest_16ca73fd.json
- **Run id:** run_mplm8ii0_22187f28
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #13 · context-degradation/context-degradation-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_context-degradation-001_qwen3.6-latest_78ef1611.json
- **Run id:** run_mplm8ief_a3ce7ad2
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** [could_not_start/health_check] Network request failed — fetch failed


### #14 · code/code-001   (suspect=30)
- **Classification:** MANIFEST_MISSING_PROMPT
- **Model:** ollama/qwen3.6:latest
- **Bundle:** runs/run_2026-05-25_code-001_qwen3.6-latest_96e29028.json
- **Run id:** run_mplm4v3e_a2f7eff1
- **Overall score:** 0% · passed=false
- **Scorer:** unknown
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** (manifest missing prompt)
- **Raw detail:** chat failed: fetch failed


### #15 · workflow/workflow-001 Q=WF1-Q3  (suspect=0)
- **Classification:** VALID_OTHER
- **Model:** openrouter/deepseek/deepseek-v4-flash
- **Bundle:** runs/run_2026-05-25_workflow-001_deepseek-deepseek-v4-flash_c9054477.json
- **Run id:** run_mplmi6vc_1e2ffe4d
- **Overall score:** 72% · passed=true
- **Scorer:** text_match_all
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** 
  > Calculate and format a professional invoice. Show all math.
  > 
  > Customer: ABC Manufacturing
  > Job: RTU compressor replacement
  > Parts: Compressor $1,200, Refrigerant R-410A 8lbs $320, Contactor $85
  > Labor: 6 hours @ $95/hr = $570
  > Travel: $75
  > Tax: 8.5% on parts only.
  > 
  > List all line items and calculate the grand total.
- **Raw detail:** WF1-Q3: FAIL — Missing phrases: [1200]. Got: **INVOICE**

**Customer:** ABC Manufacturing
**Job


### #16 · token-efficiency/token-efficiency-001 Q=TE1-Q1  (suspect=0)
- **Classification:** VALID_STRICT_NUMERIC
- **Model:** openrouter/deepseek/deepseek-v4-flash
- **Bundle:** runs/run_2026-05-25_token-efficiency-001_deepseek-deepseek-v4-flash_06e45740.json
- **Run id:** run_mplmhaq2_4809ee70
- **Overall score:** 65% · passed=false
- **Scorer:** regex_match
- **Expected:** `^\s*16\s*$`
- **Model answer:** `6`
- **Prompt:** 
  > Reply with ONLY the number.
  > A team has 18 queued tickets. They close 7, reopen 2 of those, then 5 new tickets arrive, then they close 2 more. How many tickets remain?
- **Raw detail:** TE1-Q1: FAIL — Response did not match pattern /^\s*16\s*$/. Got: 6


### #17 · token-efficiency/token-efficiency-001 Q=TE1-Q4  (suspect=0)
- **Classification:** VALID_STRICT_NUMERIC
- **Model:** openrouter/deepseek/deepseek-v4-flash
- **Bundle:** runs/run_2026-05-25_token-efficiency-001_deepseek-deepseek-v4-flash_06e45740.json
- **Run id:** run_mplmhaq2_4809ee70
- **Overall score:** 65% · passed=false
- **Scorer:** regex_match
- **Expected:** `^\s*425\s*$`
- **Model answer:** `351`
- **Prompt:** 
  > Reply with ONLY the number.
  > A library has 530 books on loan. 142 are returned, 75 are then re-loaned, then 38 more are returned. How many books are currently on loan?
- **Raw detail:** TE1-Q4: FAIL — Response did not match pattern /^\s*425\s*$/. Got: 351


### #18 · reasoning/reasoning-001 Q=RSN1-Q1  (suspect=0)
- **Classification:** VALID_OTHER
- **Model:** openrouter/deepseek/deepseek-v4-flash
- **Bundle:** runs/run_2026-05-25_reasoning-001_deepseek-deepseek-v4-flash_5f9f5325.json
- **Run id:** run_mplmasob_4a173ebd
- **Overall score:** 89% · passed=true
- **Scorer:** text_match_all
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** 
  > Solve step by step, then give the final answer on its own line.
  > 
  > A company has 3 departments. Engineering has 10 people. Sales has 2x Engineering (20 people). Marketing has half of Sales (10 people). Each person costs $80,000/year. What is the total annual payroll? Show your math.
- **Raw detail:** RSN1-Q1: FAIL — Missing phrases: [3200000, 3.2 million]. Got: Engineering: 10 people
Sales: 2 × 


### #19 · context-degradation/context-degradation-001 Q=CTX1-Q1  (suspect=0)
- **Classification:** VALID_OTHER
- **Model:** openrouter/deepseek/deepseek-v4-flash
- **Bundle:** runs/run_2026-05-25_context-degradation-001_deepseek-deepseek-v4-flash_dd4c53fc.json
- **Run id:** run_mplmakbh_05d5c00b
- **Overall score:** 43% · passed=false
- **Scorer:** text_match_all
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** 
  > Answer these 3 questions from the text. Reply with ONLY the answers, numbered 1-3.
  > 
  > 1. What is the API launch deadline?
  > 2. How many engineers will be hired?
  > 3. What endpoint is being deprecated?
  > 
  > Text: The team met Monday for Q3 planning. Key decisions: launch new API by August 15, hire two more engineers, deprecate v1 endpoint by September. PM will draft timeline, engineering scopes API changes, HR posts listings. Cloud migration budget approved.
- **Raw detail:** CTX1-Q1: FAIL — Missing phrases: [engineer]. Got: 1. August 15
2. Two
3. v1 endpoint


### #20 · context-degradation/context-degradation-001 Q=CTX1-Q3  (suspect=0)
- **Classification:** VALID_OTHER
- **Model:** openrouter/deepseek/deepseek-v4-flash
- **Bundle:** runs/run_2026-05-25_context-degradation-001_deepseek-deepseek-v4-flash_dd4c53fc.json
- **Run id:** run_mplmakbh_05d5c00b
- **Overall score:** 43% · passed=false
- **Scorer:** text_match_all
- **Expected:** `—`
- **Model answer:** ``
- **Prompt:** 
  > Extract ALL of these specific facts from the text below. List each one. Do not add anything not in the text.
  > 
  > - API launch date
  > - Number of v1 clients
  > - Latency target
  > - SDK languages mentioned
  > - Number of engineers to hire
  > 
  > The team met Monday for Q3 planning. Launch new API by August 15. Hire two more engineers. Deprecate v1 by September.
  > 
  > The team met Monday for Q3 planning. Launch new API by August 15. Hire two more engineers. Deprecate v1 by September.
  > 
  > The team met Monday for Q3 planning. Launch new API by August 15. Hire two more engineers. Deprecate v1 by September.
  > 
  > The team met Monday for Q3 planning. Launch new API by August 15. Hire two more engineers. Deprecate v1 by September.
  > 
  > The team met Monday for Q3 planning. Launch new API by August 15. Hire two more engineers. Deprecate v1 by September.
  > 
  > V1 serves 200 clients. 60-day notice for migration. New API: GraphQL + REST. Target: sub-100ms p99. Security audit required. 10x load test. SDK updates: Python, TypeScript, Go.
  > 
  > Additional noise: The office kitchen needs restocking. Parking lot will be resurfaced in October. The vending machine on floor 3 is broken. Team offsite planned for Q4.
- **Raw detail:** CTX1-Q3: FAIL — Missing phrases: [200 client]. Got: - API launch date: August 15
- Number of v1 

