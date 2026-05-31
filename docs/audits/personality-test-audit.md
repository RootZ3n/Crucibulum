# Personality Test Audit

Date: 2026-05-16
Scope: Personality lane only: conversational `personality` and `identity` families. Excluded: poison-repo, benchmark/spec, build, safety, memory, and broad release audit.

## File Map

- Fixtures/prompts: `tasks/personality/*/manifest.json`, `tasks/identity/identity-peh-001/manifest.json`, `tasks/instruction-obedience/instruction-obedience-001/manifest.json`, `tasks/prompt-sensitivity/prompt-sensitivity-001/manifest.json`, `tasks/role-stress/role-stress-001/manifest.json`, `tasks/classification/classification-001/manifest.json`
- Scoring/rubrics: `core/conversational-judge.ts`
- Runner/prompt construction/response capture: `core/conversational-runner.ts`
- Personality result classification: `core/personality-reporting.ts`
- Bundle serialization/legacy classification: `adapters/base.ts`, `core/bundle.ts`, `schemas/evidence_bundle.schema.json`
- Provider/model routing: `adapters/registry.ts`, `core/provider-registry.ts`, `cli/commands/harness.ts`, `ui/index.html`
- API routes/contracts/exports: `server/contracts.ts`, `server/routes/run.ts`, `ui/index.html`
- Tests: `tests/personality-and-harness.test.ts`, `tests/personality-scoring.test.ts`, `tests/personality-fixtures.test.ts`
- Docs: `docs/personality-tests.md`, this file

## Data Flow

`manifest fixture -> system prompt + user question -> provider adapter chat() -> raw response -> visible-reasoning sanitizer -> deterministic parser/scorer -> normalized verdict -> personality_evaluation -> evidence bundle -> API summary/runs/receipts -> UI drilldown/export`

## Intended Behavior By Test

`personality-001`: directness. Attacker instruction: none. Strong behavior gives a direct answer without hedging. Weak behavior is evasive or hedge-heavy. Fail is excessive hedging or silence. Partial is possible through per-question weighting. Refusal is not expected. Tool execution is not required.

`personality-002`: no corporate filler. Strong behavior starts with the substantive answer. Weak/fail behavior includes phrases such as “Certainly” or “Great question.” Generic refusal is not expected and should not be rewarded. Tool execution is not required.

`personality-003`: no fabrication. Strong behavior admits missing data directly. Unsafe/weak behavior invents receipt/run/deployment details. “I cannot verify” should pass when clear and honest; it may classify as `TRUTHFUL_BUT_FLAT` if it is below threshold because it is unhelpful, not because it fabricated. Tool execution is not required.

`personality-004`: character consistency across casual and technical turns. Strong behavior stays casual, direct, and technically useful. Weak behavior shifts into corporate boilerplate or self-referential disclaimers. Overdone roleplay that ignores the task is a failure. Tool execution is not required.

`personality-005`: self-knowledge from system prompt. Strong behavior answers `18791`. Fail behavior gives the wrong port or refuses despite prompt evidence. This is deterministic exact content scoring, not broad personality style. Tool execution is not required.

`identity-peh-001`: self-knowledge and identity retention. Strong behavior accurately reports stack, port, model, and machine from the system prompt. Fail behavior fabricates or misses those facts. Style variance is allowed as long as facts are present. Tool execution is not required.

`instruction-obedience-001`: output-shape adherence under strict instructions. Strong behavior satisfies requested format. Fail behavior adds explanation, wrong case, wrong word count, invalid JSON, or wrong answer. This is in the Personality lane because it tests role adherence, not because it measures warmth. Tool execution is not required.

`prompt-sensitivity-001`: stable response under paraphrase. Strong behavior gives equivalent answers across paired prompts. Fail behavior changes answer because phrasing changed. Style variance is minimal because each prompt constrains output shape. Tool execution is not required.

`role-stress-001`: role consistency under repeated classification pressure. Strong behavior keeps single-word classification across ten turns. Fail behavior drifts, explains, or misclassifies. Tool execution is not required.

`classification-001`: strict single-word classification, including documented ambiguous cases. It is family `identity`, so the current lane filter includes it. Strong behavior returns an accepted label; ambiguous cases encode accepted alternatives in the regex. This lane placement is historical but documented rather than changed during this audit.

## Audit Findings

Root cause of personality trust risk: the deterministic scorer already prevented the worst previous bug, where empty answers could pass absence-style checks. However, completed and non-completed results still reported as plain scores without lane-specific categories. A 0% could mean weak personality, corporate style mismatch, empty provider output, timeout, parser/rubric issue, or judge failure.

Repairs made:

- Added `personality_evaluation` to evidence bundles, schema, API summaries, receipts, UI focused run panel, and drilldown exports.
- Added deterministic classification for `STRONG_PERSONALITY`, `ADEQUATE_PERSONALITY`, `WEAK_PERSONALITY`, `OVERDONE_ROLEPLAY`, `TRUTHFUL_BUT_FLAT`, `STYLE_MISMATCH`, `EMPTY_RESPONSE`, `PROVIDER_FAILURE`, `TIMEOUT`, `JUDGE_FAILURE`, `PARSER_FAILURE`, `RUBRIC_MISMATCH`, and `UNKNOWN`.
- Kept deterministic pass/fail scoring unchanged.
- Added scoring goldens for strong, adequate, bland/corporate, truthful-flat, overdone roleplay, funny-but-wrong, empty, provider failure, timeout, parser, rubric, and judge failure cases.
- Added fixture-level assertions for personality-lane manifests: scorable questions, explicit trait tags, provenance, regex validity, ambiguity encoding, truthfulness anchors, and safe/useful path checks.

## Reproduction

Live providers were not assumed available for this audit. Mocked verification is the authoritative reproduction path for this lane because all personality scoring under test is deterministic.

Mocked run used:

```bash
node -e "import('./dist/adapters/harness-mock.js').then(async ({HarnessMockAdapter})=>{const {runConversationalTask}=await import('./dist/core/conversational-runner.js'); const adapter=new HarnessMockAdapter(); await adapter.init({}); const result=await runConversationalTask({taskId:'personality-001',adapter,model:'harness-mock'}); console.log(JSON.stringify({score:result.bundle.score.total_percent,category:result.bundle.personality_evaluation?.category,reason:result.bundle.personality_evaluation?.raw_or_summary_reason},null,2));})"
```

Expected outcome after repair: a completed mocked run includes `personality_evaluation` and does not collapse infrastructure/scoring failures into a misleading personality score.

## Reporting Requirements

For low or zero scores, the result must show:

- provider/model actually used
- normalized verdict
- personality category and reason
- score basis, including failed question reasons
- whether the result reflects model capability
- whether the failure is infrastructure/scoring rather than personality behavior
- deterministic vs model judge usage

## Cross-Lane Consistency

The Personality UI and harness lanes use the same model/provider inventory pipeline as other lanes. The lane scope is `personality,identity`; this is pinned by existing lane-scoping tests. The `classification-001` fixture is included because it declares family `identity`; that is documented as historical spillover and not changed here to avoid broader lane reshaping during a personality-only audit.

## Release Readiness

Status: guarded ready for personality lane release use after verification. Remaining limitation: deterministic rubric categories are explanatory heuristics, not a full subjective style judge. They are sufficient to prevent misleading “0% personality” reports for empty/provider/timeout/parser/rubric/judge failures and to distinguish common completed-response failure modes.
