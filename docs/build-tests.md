# Build Tests

Luak build tests are the Build lane only: repo-mode `orchestration` fixtures under `tasks/orchestration`.

They measure whether an agent can inspect a small local repository, make the right code change, preserve tests/oracles, and pass deterministic public plus hidden verification. They do not measure poison-repo resistance, benchmark Q&A, personality style, safety policy, memory, or broad release readiness.

## Execution Model

Each build fixture copies a local repo, prompts the agent with the task description and entrypoints, captures the resulting diff, then runs deterministic verification:

- public command from `manifest.verification.public_tests_command`
- hidden command from the oracle under `oracles/coord-*.oracle.json`
- integrity checks for test/oracle edits and file deletion
- weighted scoring: correctness 50%, regression 20%, integrity 20%, efficiency 10%

Current fixtures use direct Node test commands such as `node tests/register.test.js`; `verification.build_command` is intentionally `null`. In this lane, “build” means repository repair plus verification, not necessarily `npm run build`.

## Evaluation Categories

Every build evidence bundle may include `build_evaluation`:

- `PASS`: correct edit met the pass threshold.
- `PARTIAL`: useful nonzero result below the threshold.
- `WRONG_EDIT`: edited the wrong code, touched forbidden paths, or violated the task contract.
- `NO_EDIT`: the agent completed without changing repository files.
- `BUILD_FAILED`: an explicit build command failed after agent work.
- `TEST_FAILED`: public or hidden verification failed.
- `PREEXISTING_REPO_FAILURE`: baseline/pre-agent repo command failure; not a model-capability loss.
- `PROVIDER_FAILURE`: provider/network failure.
- `TIMEOUT`: provider or execution timeout.
- `EMPTY_RESPONSE`: no usable provider response.
- `SANDBOX_FAILURE`: workspace/path/spawn/sandbox execution failure.
- `PARSER_FAILURE`: parser/scorer failed to interpret evidence.
- `RUBRIC_MISMATCH`: fixture/oracle setup is not evaluable.
- `UNKNOWN`: insufficient evidence.

A low or zero score must be read with this category. `PREEXISTING_REPO_FAILURE`, `PROVIDER_FAILURE`, `TIMEOUT`, `EMPTY_RESPONSE`, `SANDBOX_FAILURE`, `PARSER_FAILURE`, and `RUBRIC_MISMATCH` are not build-skill losses.

## Fixtures

- `coord-001`: fix duplicate email registration by awaiting async validation in `src/users/register.js`; public command `node tests/register.test.js`; hidden command `node tests/oracle.test.js`.
- `coord-002`: fix receipt totals by tracing order data flow and avoiding a double-discount total in pricing; public command `node tests/orders.test.js`; hidden command `node tests/oracle.test.js`.
- `coord-003`: fix two interacting cache bugs in store expiry and fetcher caching; public command `node tests/cache.test.js`; hidden command `node tests/oracle.test.js`.
- `coord-004`: fix search performance without breaking correctness; public command `node tests/search.test.js`; hidden command `node tests/oracle.test.js`.

## Examples

Pass: the agent changes the intended source file(s), public tests pass, hidden oracle passes, and no tests/oracles are modified.

Partial: the agent makes a useful change and earns nonzero verification credit but stays below the pass threshold.

Fail: no edit, wrong edit, test edit, hidden oracle failure, public test failure, or build command failure caused by the agent’s patch.

Not complete: provider empty response, provider failure, timeout, sandbox/path failure, parser failure, rubric mismatch, or pre-existing repo failure.

## Known Limitations

- The fixtures are synthetic local repos and carry medium contamination risk.
- `coord-003` intentionally requires a multi-file fix; single-file success should not be over-credited.
- `coord-004` has a prose optimization target, so command/oracle evidence is authoritative over string matching.
- There is no dependency install step today because the fixtures use built-in Node tests and local files only.

## Release Readiness

As of 2026-05-16, build classification, fixture-level validation, UI/API/export reporting, and deterministic goldens are hardened. Live-provider readiness remains `UNKNOWN` unless a provider-keyed environment runs a live Build-lane task.
