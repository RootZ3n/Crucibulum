# Crucibulum

Execution-based AI agent evaluation harness.

Tests whether your model, agent system, or OpenClaw setup can actually solve real software tasks — not whether it can describe solving them. Scoring is based on what changed in the environment. The agent never sees the rubric. The judge never trusts the narration. Results are replayable, signed, and auditable. Point it at any model, any agent system, any provider. Get evidence.

## Install

```bash
npm install
npm run build
```

## Quick Start

```bash
# Run a single task against Ollama
crucibulum test --model ollama:gemma4:26b --task poison-001

# Run full V1 suite
crucibulum test --model ollama:gemma4:26b --suite v1

# Compare models
crucibulum compare --models ollama:gemma4:26b,openrouter:arcee-ai/trinity-large-thinking --task poison-001 --runs 5

# Verify evidence bundle
crucibulum verify run_2026-04-05_poison-001_gemma4
```

## Exit Codes

- 0: task passed
- 1: task failed
- 2: integrity violation
- 3: harness error
- 4: injection detected
- 5: adapter error

## Architecture

Three-box judge: Runner → Observer → Judge

- Runner creates workspace, loads task, invokes adapter
- Observer records every filesystem event (flight recorder)
- Judge reads diff + observer log, loads oracle, scores independently

The agent never sees the rubric. The judge never trusts narration. Score = observable state transitions.

## License

MIT
