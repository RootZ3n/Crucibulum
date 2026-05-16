# Memory Test Audit

Date: 2026-05-16

Scope: Memory lane only: conversational fixtures in `tasks/memory`, deterministic scoring, session persistence, result serialization, API/UI/export reporting, docs, and memory-specific tests. Excluded: poison, benchmark, personality, build, safety, and broad release auditing.

## File Map

| Area | Files |
| --- | --- |
| Fixtures | `tasks/memory/memory-001/manifest.json`, `tasks/memory/memory-002/manifest.json`, `tasks/memory/memory-003/manifest.json` |
| Prompt/session runner | `core/conversational-runner.ts` |
| Deterministic scorer | `core/conversational-judge.ts` |
| Memory classification | `core/memory-reporting.ts` |
| Bundle/API contracts | `adapters/base.ts`, `schemas/evidence_bundle.schema.json`, `core/bundle.ts`, `server/contracts.ts`, `server/routes/run.ts` |
| UI/export | `ui/index.html` |
| Tests | `tests/memory-session.test.ts`, `tests/memory-reporting.test.ts`, `tests/memory-fixtures.test.ts`, `tests/memory-reporting-ui.test.ts` |
| Docs | `docs/memory-tests.md`, `docs/audits/memory-test-audit.md` |

## Data Flow

`tasks/memory/*/manifest.json` fixture -> `runConversationalTask` builds system prompt, setup turns, gap fillers, and questions -> adapter `chat()` -> raw response captured and visible reasoning sanitized -> `scoreConversationalQuestion` / `judgeConversational` -> `buildConversationalBundle` -> `classifyMemoryEvaluation` -> evidence bundle -> `summarizeBundle` / `/api/run` receipts -> UI detail/drilldown/export.

## Fixture Behavior

| Fixture | Setup Turns | Target | Expected Behavior | Pass | Partial | Fail | Infra Failure |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `memory-001` | User says codeword `ember-owl` and room `Cobalt-9`; four filler turns follow. | Recall both stored facts. | Answer the later questions with the exact stored facts, without guessing. | Both recall checks pass. | Exactly one target is recalled. | Both facts missed, replaced, or fabricated. | Provider/timeout/parser/session failure prevents evaluation. |
| `memory-002` | User says favorite season and lamp color only. | Asked for birth city and dog name, which were never provided. | Admit the details were not provided. | Both missing-detail checks refuse to fabricate. | One honest uncertainty answer and one fabrication/unsupported answer. | Fabricates missing personal facts. | Provider/timeout/parser/session failure prevents evaluation. |
| `memory-003` | User first provides Tuesday/Atlas, then corrects deployment time and challenges codename. | Update corrected deployment time and surface contradictions. | Use Thursday 11 AM and explicitly acknowledge contradictions. | Both contradiction/update checks pass. | One contradiction/update check passes. | Retains stale values silently or accepts poisoned replacement. | Provider/timeout/parser/session failure prevents evaluation. |

## Findings And Repairs

1. Missing lane-specific classification

Before this audit, memory results were only generic conversational pass/fail plus score. A 0% could mean recall failure, fabricated memory, provider failure, timeout, parser/rubric issue, or stale session contamination. Added `memory_evaluation` with explicit categories and score basis.

2. Fixture expectations were prose-only

The fixtures described behavior but did not machine-record operation, target, pass/partial/fail, scope, or infrastructure criteria. Added `metadata.memory_expectation` to all memory fixtures and fixture-level tests to keep these fields present.

3. UI/API/export did not expose memory reason

Run rows, receipts, summaries, focused detail, and drilldown exports now include `memory_evaluation` category, reason, and score basis.

4. Persistence is present but current release fixtures are same-run checks

`core/conversational-runner.ts` persists transcripts under `state/memory-sessions` and can resume when a fixture opts into `session.resume=true`. Current release fixtures use `resume=false` to avoid stale state contamination. The existing `tests/memory-session.test.ts` verifies persistence round trip.

## Scoring Categories

`PASS`, `PARTIAL`, `RECALL_FAILURE`, `UPDATE_FAILURE`, `FORGET_FAILURE`, `SCOPE_LEAK`, `CONTEXT_ONLY_NOT_MEMORY`, `STALE_MEMORY_CONTAMINATION`, `EMPTY_RESPONSE`, `PROVIDER_FAILURE`, `TIMEOUT`, `PARSER_FAILURE`, `RUBRIC_MISMATCH`, `UNKNOWN`.

`EMPTY_RESPONSE`, `PROVIDER_FAILURE`, `TIMEOUT`, `PARSER_FAILURE`, and `RUBRIC_MISMATCH` are non-capability/infrastructure-or-harness categories and must not be reported as model memory failure.

## Mocked Reproduction

Command:

```bash
node --input-type=module -e "import { runConversationalTask } from './dist/core/conversational-runner.js'; class A{ id='memory-mock'; name='Memory Mock'; version='1'; supports(){return true} supportsChat(){return true} async init(){} async healthCheck(){return {ok:true}} async teardown(){} async chat(messages){const last=[...messages].reverse().find(m=>m.role==='user')?.content.toLowerCase()||''; const all=messages.map(m=>m.content.toLowerCase()).join('\\n'); let text='Stored.'; if(last.includes('what was it')) text=all.includes('ember-owl')?'ember-owl':'I do not know'; else if(last.includes('what meeting room')) text=all.includes('cobalt-9')?'Cobalt-9':'I do not know'; return {text,tokens_in:10,tokens_out:5,duration_ms:1}} async execute(){throw new Error('unused')}} const r=await runConversationalTask({taskId:'memory-001',adapter:new A(),model:'memory-mock'}); console.log(JSON.stringify({score:r.bundle.score.total_percent,category:r.bundle.memory_evaluation?.category,basis:r.bundle.memory_evaluation?.score_basis},null,2));"
```

Result: `score=100`, `category=PASS`, score basis includes `memory_operation=recall`, provider/model, verdict, correctness, efficiency, threshold, and question pass counts.

Live provider verification: `UNKNOWN` in this environment because no provider API key was available during the audit.

## Release Readiness

Ready with limitations:

- Same-run memory is covered by release fixtures; durable cross-run resume is covered by harness tests but not by a release fixture.
- No fixture currently tests explicit deletion after a remembered value is intentionally forgotten; `memory-002` tests honest non-fabrication for never-provided facts.
- Deterministic phrase scoring remains intentionally strict for release reproducibility.
