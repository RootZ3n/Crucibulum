# Vision / Multimodal test suite — design

**Status:** Experimental scaffold (2026-05-25). Not release-certified.

## Purpose

Measure whether a model can reason about images that accompany its
text prompt — OCR, object counting, chart reading, UI diagnosis,
spatial relations, and explicit uncertainty when an image is
unreadable or ambiguous.

The suite serves three audiences:

- **Operators** picking a model for a vision agent (e.g. screenshot
  diagnostician, OCR pipeline, chart-summary writer).
- **Safety reviewers** checking whether the model confidently
  hallucinates content that isn't in the image.
- **Quality reviewers** comparing real vision capability between
  candidate models, not just provider claims.

## What this suite measures

| Dimension | What we score |
|---|---|
| OCR / text extraction | Exact or near-exact extraction of visible text |
| UI screenshot understanding | Can the model identify clipped / overlapping / missing UI elements? |
| Chart / table comprehension | Can the model extract required facts (axis, value, trend)? |
| Object / colour / count recognition | Deterministic answers (3 cats, blue door, etc.) |
| Spatial / grid reasoning | "Which object is left of the door?" — coordinate / relationship answers |
| Multimodal instruction following | Can the model follow text instructions while looking at the image? |
| Uncertainty honesty | Does the model say "unreadable" / "ambiguous" / "can't tell" when appropriate? |
| Visual evidence grounding | Does the model cite where in the image it found the answer? |
| Screenshot-based debugging | Can the model name the broken UI state visible in a bug report screenshot? |
| Image + text reasoning | Can the model combine "here's the image, plus this caption" into a correct answer? |

## What this suite does NOT measure

- Photo aesthetics, art critique, or generative image quality
  (Crucible doesn't generate images).
- Video / motion understanding (out of scope for this suite).
- Audio transcription / multi-modal beyond image-input (the existing
  `supportsAudio` flag exists for future expansion but no suite yet).
- Whether the model can SUBMIT an image — only consumption is tested.

## Task schema

```jsonc
{
  "id": "vision-ocr-001",
  "version": "1.0.0",
  "family": "vision",
  "execution_mode": "conversational",
  "difficulty": "easy",
  "description": "…",
  "requires_capability": ["supportsVision", "supportsImageInput"],
  "image_fixture": {
    "path": "fixtures/vision/ocr/receipt-small-001.png",
    "sha256": "<set when fixture is committed>",
    "mime": "image/png",
    "width": 600,
    "height": 800,
    "license": "CC0 / synthetic / Crucible-owned",
    "notes": "Hand-typed mock receipt; no real PII"
  },
  "prompt": "Read the total amount on this receipt. Reply with ONLY the dollar amount.",
  "scoring_type": "regex_match",
  "pattern": "^\\s*\\$?42\\.50\\s*$",
  "maxLength": 12,
  "scoring": {
    "pass_threshold": 1.0
  },
  "quarantine": null,
  "metadata": {
    "author": "crucibulum-core",
    "created": "2026-05-25",
    "tags": ["vision", "ocr", "experimental"],
    "diagnostic_purpose": "POC for the vision suite — exact OCR on a small synthetic receipt; pass requires the literal dollar amount."
  }
}
```

## Scoring modes (6)

| Mode | Scorer | Pass condition |
|---|---|---|
| `vision_ocr_exact` | `regex_match` against expected literal | Exact match (whitespace-only ws) |
| `vision_object_count` | `regex_match` against expected integer | Exact count |
| `vision_chart_facts` | `text_match_all` against required facts list | All listed facts present in answer |
| `vision_ui_diagnosis` | `rubric` (judge) | Judge sees the same broken element the manifest names |
| `vision_spatial` | `regex_match` against expected relation | Exact match (e.g. "to the left of") |
| `vision_uncertainty_honesty` | `rubric` (judge) | Model said "unreadable" / "ambiguous" / "can't determine" when expected |

## Evidence bundle requirements

Each vision run produces a bundle with:

- `image_fixture` — path + `sha256` (always recorded so a future
  fixture edit can't silently invalidate prior runs)
- `image_metadata` — resolution, MIME, file size in bytes
- `prompt` — full text prompt
- `model_answer` — verbatim model response
- `expected_answer_or_rubric` — manifest's expected pattern or rubric
- `scoring_result` — `PASS | FAIL_PRODUCT | NEEDS_REVIEW | SKIPPED_UNSUPPORTED_MULTIMODAL | FAIL_PROVIDER | FAIL_CONFIG`
- `image_transport` — `{ provider, transport: "openai_image_url" | "anthropic_image" | "minimax_image" | "local_url" | "unsupported", success: bool, error: ?string }`
- `capability_classification` — what flags the model was claimed to support, what the adapter actually attempted

The bundle's `evidence` field MUST embed the fixture path + sha256 so
operators can spot fixture drift.

## Provider / adapter capability requirements

Vision is **capability-gated**. A model attempts the suite only if
its `MODEL_CERTIFICATION` entry declares `supportsVision: true` AND
`supportsImageInput: true`, AND the adapter knows the multimodal
transport for that provider.

| Provider | Image input support | Transport key | Notes |
|---|---|---|---|
| OpenAI direct | Yes (vision models only — GPT-5.4, GPT-5.4-mini, GPT-5.4-nano) | `openai_image_url` | Supports URL + base64; max ~20 MB per image |
| Anthropic direct | Yes (Claude Opus / Sonnet 4.x) | `anthropic_image` | Base64 only; max ~5 MB per image |
| OpenRouter | Depends on routed model | `openai_image_url` (most routes) | Capability must be declared per-model, not per-provider |
| MiniMax | TBD — adapter currently text-only | `minimax_image` (not implemented) | Mark `supportsVision: false` until adapter is built |
| ModelStudio / DashScope | Depends on Qwen-VL model selection | `qwen_image_url` | Only `qwen3-vl:4b` etc. |
| ZAI | Depends on GLM-V model selection | `glm_image_url` | Not currently configured |
| Ollama (local) | Depends on local model (`qwen3-vl:4b` for example) | `local_url` (base64 inline) | Adapter must use Ollama's `images` field on chat request |

### Unsupported handling

If a model is asked to run a vision task but lacks
`supportsImageInput: true`:

- Runner produces `SKIPPED_UNSUPPORTED_MULTIMODAL`.
- Bundle still gets written with the classification (for auditability).
- Leaderboard does NOT count this as a failure.
- UI shows a `Skipped · no vision support` chip on the row.

If the adapter CAN format an image but the provider's specific model
rejects it (e.g. Claude Haiku claims vision support but the actual
endpoint returns 4xx for image content):

- Runner produces `FAIL_CONFIG_MODEL_CAPABILITY`.
- Bundle records the rejection error.
- Capability registry should be updated to mark the model
  `supportsImageInput: false`.

Do NOT silently claim vision support because a provider supports it
"generally". Capability is **model-specific**.

## Failure classifications

| Classification | Meaning |
|---|---|
| `PASS` | Scorer accepted the answer |
| `FAIL_PRODUCT` | Model gave a wrong answer despite the image being clear |
| `FAIL_OVER_HALLUCINATION` | Model invented details not in the image (e.g. claimed text that isn't present) |
| `FAIL_OVER_REFUSAL` | Model refused to look at a benign image (e.g. refused to OCR a receipt) |
| `FAIL_PROVIDER` | Transient 4xx/5xx / timeout |
| `FAIL_CONFIG` | Credentials missing |
| `FAIL_CONFIG_MODEL_CAPABILITY` | Adapter+model claimed support but endpoint rejected the image |
| `SKIPPED_UNSUPPORTED_MULTIMODAL` | Model opted out via capability flag |
| `NEEDS_REVIEW` | Rubric judge low-confidence verdict |

## Certification rules

Vision-Certified requires:

- Adapter image transport proven for the model's provider
- OCR + object + chart + UI POC tests all pass on at least one
  known vision-capable model (e.g. GPT-5.4 or Claude Opus 4.7)
- Unsupported models skip cleanly (no `FAIL_PRODUCT` for opt-outs)
- Every image fixture has a recorded sha256 and a stable
  license/origin
- No private / sensitive images committed to the repo — only
  synthetic / public / Crucible-owned fixtures
- Re-running the same bundle does not flap on infrastructure
  artifacts (image-encoding format changes, etc.)

Until those gates are met, the family stays Experimental.

## Initial POC tests (5)

| Task id | What it tests | Fixture |
|---|---|---|
| `vision-ocr-001` | OCR a small synthetic receipt — exact $-amount match | `fixtures/vision/ocr/receipt-small-001.png` (TBD; committed after audit) |
| `vision-ui-001` | UI screenshot diagnosis — identify a clipped button | `fixtures/vision/ui/clipped-button-001.png` (TBD) |
| `vision-chart-001` | Read a peak value from a simple bar chart | `fixtures/vision/chart/bars-001.png` (TBD) |
| `vision-object-count-001` | Count discrete objects in a synthetic scene | `fixtures/vision/objects/dots-7-001.png` (TBD) |
| `vision-uncertainty-001` | Model must say "unreadable" on a deliberately-blurred image | `fixtures/vision/uncertainty/blurred-text-001.png` (TBD) |

The manifests are committed with their `image_fixture` block but
the actual PNG files are added in a follow-up commit once the fixture
set has been hand-reviewed for licence + content (no PII, no
copyrighted screenshots). Until fixtures land, the runner produces
`SKIPPED_FIXTURE_MISSING` for these tests.

## Known risks / false-positive risks

- **Provider format drift** — image transport schemas change without
  notice. Mitigation: snapshot adapter request bodies; pin in tests.
- **Fixture contamination** — if a fixture happens to be in the
  model's training set, OCR becomes pattern-match. Mitigation: use
  synthetic fixtures with random IDs (`receipt-Y9KQ-001`).
- **Hallucinated confidence** — model invents text not in the image
  ("the receipt shows $42.50" when image says "$42.40"). The
  `FAIL_OVER_HALLUCINATION` classification exists for this; verify
  the scorer can distinguish from `FAIL_PRODUCT`.
- **Over-refusal of benign images** — some models refuse all
  human-likeness imagery. Vision suite POC tests must avoid people
  in early fixtures so we can build the baseline before tackling
  refusal handling.
- **Image-transport silent failure** — if the adapter sends bytes
  but the provider drops them silently, the model "reads" nothing.
  Adapter MUST verify the request was accepted (e.g. by checking
  upstream tokenisation acknowledges multimodal content).

## Cadence

- Audit weekly while Experimental.
- Add fixture set in a separate commit, hash-pinned.
- Promote to Provider-Tested only after all 5 POC tasks pass on at
  least one cloud vision model AND unsupported models skip cleanly.
- Promote to Release-Certified per the rules above.
