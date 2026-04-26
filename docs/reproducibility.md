# Crucible Reproducibility

## Minimum Reproduction Inputs

To reproduce a run, a third party needs:

- the task ID
- the adapter/provider identity
- the model ID
- the benchmark code snapshot
- the evidence bundle
- the environment variables required by the chosen adapter

## Local Reproduction

```bash
npm install
npm run build
crucible test --model ollama:gemma4:26b --task poison-001
```

## Evidence Verification

Stored bundles can be re-verified:

```bash
crucible verify <bundle_id>
```

## Oracle Integrity

Release task manifests pin their hidden oracle file by SHA-256 over the oracle
file bytes:

```text
sha256:<64 lowercase hex characters>
```

Before publishing or packaging a benchmark corpus, verify every release task
manifest with:

```bash
npm run build
npm run oracle:hash -- --check
```

When an oracle changes intentionally, refresh placeholder manifest hashes with:

```bash
npm run oracle:hash -- --write
```

Runtime task execution is strict: missing, malformed, placeholder, or mismatched
oracle hashes stop repo-task execution before the agent runs. Evidence bundles
record the oracle hash status and expected/actual hashes, but never expose
hidden oracle content.

## Reproducibility Limits

Exact reproduction is currently strongest for:

- local repo tasks
- pinned local runtimes
- deterministic judge outcomes

It is weaker for:

- cloud-hosted models that can drift behind a stable name
- adapters whose upstream provider changes the underlying model behavior

## Current Gap

Crucible still needs a pinned containerized runtime for full public reproducibility. Until that exists, benchmark publications should disclose the exact environment used.
