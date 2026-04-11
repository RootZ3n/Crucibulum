# Crucibulum Reproducibility

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
crucibulum test --model ollama:gemma4:26b --task poison-001
```

## Evidence Verification

Stored bundles can be re-verified:

```bash
crucibulum verify <bundle_id>
```

## Reproducibility Limits

Exact reproduction is currently strongest for:

- local repo tasks
- pinned local runtimes
- deterministic judge outcomes

It is weaker for:

- cloud-hosted models that can drift behind a stable name
- adapters whose upstream provider changes the underlying model behavior

## Current Gap

Crucibulum still needs a pinned containerized runtime for full public reproducibility. Until that exists, benchmark publications should disclose the exact environment used.
