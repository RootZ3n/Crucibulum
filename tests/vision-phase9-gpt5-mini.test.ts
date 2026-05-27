/**
 * Crucible — Vision Phase 9: GPT-5.4-mini second route (offline)
 *
 * 14 deterministic source/contract assertions covering Phase 9's
 * scope: registering OpenAI gpt-5.4-mini as the second vision-
 * capable route without promoting Vision to leaderboard / cert.
 *
 * No provider calls. No network. The live smoke is recorded under
 * reports/capability-expansion/vision-smoke/2026-05-26T02-21-08Z.{json,md}
 * and reports/capability-expansion/vision-phase9-gpt5-mini/.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { buildOpenAIChatBody } from "../adapters/openai.js";

const ROOT = process.cwd();
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const CSS = readFileSync(join(ROOT, "ui", "crucibulum.css"), "utf-8");
const OPENAI_SRC = readFileSync(join(ROOT, "adapters", "openai.ts"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "vision-smoke.mjs"), "utf-8");
const RUNNER_SRC = readFileSync(join(ROOT, "core", "conversational-runner.ts"), "utf-8");
const CERTIFIED_MODELS_JSON = join(ROOT, "reports", "model-certification", "certified-models.json");

describe("Vision Phase 9 · GPT-5.4-mini second route (offline)", () => {
  // -------- registry / capability metadata --------

  it("P1 · gpt-5.4-mini exact model id appears in MODEL_CERTIFICATION.models", () => {
    assert.match(HTML, /providerId:'openai',modelId:'gpt-5\.4-mini'/, "MODEL_CERTIFICATION must include openai/gpt-5.4-mini for Phase 9");
  });

  it("P2 · gpt-5.4-mini capability metadata declares vision honestly", () => {
    // Must declare supportsVision + supportsImageInput true (Crucible's
    // OpenAI adapter forwards image_url content parts unchanged and the
    // openai adapterImageTransport entry supports openai_image_url), and
    // must NOT claim release-certified status.
    const block = HTML.match(/providerId:'openai',modelId:'gpt-5\.4-mini'[^}]*\}\}/);
    assert.ok(block, "openai/gpt-5.4-mini block must exist");
    assert.match(block![0], /tier:'EXPERIMENTAL'/, "gpt-5.4-mini must be EXPERIMENTAL — not RELEASE_CERTIFIED or PROVIDER_TESTED based on Vision alone");
    assert.match(block![0], /supportsVision:true/);
    assert.match(block![0], /supportsImageInput:true/);
    assert.match(block![0], /multimodalTransport:'openai_image_url'/);
    // Crucially: must NOT claim supportsRepo / supportsTools / supportsRoleplay
    // — those are non-Vision capabilities and weren't proven by this phase.
    assert.doesNotMatch(block![0], /supportsRepo:true/, "Phase 9 only proves Vision; do not claim repo capability without evidence");
    assert.doesNotMatch(block![0], /supportsTools:true/, "Phase 9 only proves Vision; do not claim tool-calling capability without evidence");
  });

  it("P3 · OpenAI image payload builder passes through text + image content parts", () => {
    // buildOpenAIChatBody is a passthrough — it must not strip
    // image_url content parts, and the multimodal user message
    // must survive into the body.messages it sends to OpenAI.
    const userMsg = {
      role: "user" as const,
      content: [
        { type: "text", text: "Read the receipt." },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA", detail: "auto" } },
      ],
    };
    const body = buildOpenAIChatBody("gpt-5.4-mini", [userMsg], {}) as { model: string; messages: unknown[]; max_completion_tokens?: number; max_tokens?: number };
    assert.equal(body.model, "gpt-5.4-mini");
    assert.equal(body.messages.length, 1);
    const sent = body.messages[0] as { role: string; content: unknown };
    assert.equal(sent.role, "user");
    assert.ok(Array.isArray(sent.content), "user message content must remain an array (image part preserved)");
    const parts = sent.content as Array<{ type: string }>;
    assert.equal(parts.length, 2);
    assert.equal(parts[0]!.type, "text");
    assert.equal(parts[1]!.type, "image_url");
  });

  it("P4 · fixture validation runs BEFORE OpenAI payload construction", () => {
    // preflightSkipCheck (which verifies sha256 against disk) runs in
    // the conversational runner before the image bytes are read for
    // transport. Confirm the source enforces this order.
    const idxPreflight = RUNNER_SRC.indexOf("preflightSkipCheck");
    const idxReadFixture = RUNNER_SRC.indexOf("manifest.family === \"vision\"");
    assert.ok(idxPreflight > 0, "preflightSkipCheck must be called in the runner");
    assert.ok(idxReadFixture > 0, "vision image-bytes injection must exist in the runner");
    assert.ok(idxPreflight < idxReadFixture, "preflight skip-check (with hash verification) must precede image-bytes read");
  });

  it("P5 · gpt-5.4-mini family is routed to max_completion_tokens (not legacy max_tokens)", () => {
    // GPT-5 / o-family reject max_tokens with HTTP 400. The adapter
    // must use max_completion_tokens for these models. Caught live
    // during Phase 9 smoke.
    const body = buildOpenAIChatBody("gpt-5.4-mini", [{ role: "user", content: "ping" }], {}) as Record<string, unknown>;
    assert.ok("max_completion_tokens" in body, "gpt-5.4-mini must use max_completion_tokens");
    assert.ok(!("max_tokens" in body), "gpt-5.4-mini must NOT send legacy max_tokens (causes HTTP 400)");
    assert.ok(!("temperature" in body), "gpt-5.4-mini must NOT send temperature (rejected by GPT-5 chat completions)");
    // Sanity: a non-reasoning legacy model still uses max_tokens.
    const legacy = buildOpenAIChatBody("gpt-4-turbo", [{ role: "user", content: "ping" }], {}) as Record<string, unknown>;
    assert.ok("max_tokens" in legacy, "legacy chat models must still use max_tokens");
  });

  it("P6 · numeric_fact_match scorer accepts sentence-ending period after the expected digit", () => {
    // Phase 9 scorer calibration: the previous (?![\\d.]) lookahead
    // rejected '87.' at end-of-sentence (e.g. "value of 87."). The
    // new regex only rejects digit-adjacency + decimal continuation.
    const judgeSrc = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");
    assert.match(judgeSrc, /\(\?<!\\\\d\)\$\{v\}\(\?!\\\\d\)\(\?!\\\\\.\\\\d\)/, "scorer regex must reject only digit-adjacency + decimal continuation, not sentence-ending periods");
  });

  it("P7 · vision-smoke.mjs supports --provider openai with the right adapter + env", () => {
    assert.match(SMOKE_SRC, /openai:\s*\{[^}]*envKey:\s*"OPENAI_API_KEY"[^}]*build:\s*\(\)\s*=>\s*new OpenAIAdapter\(\)/s,
      "vision-smoke.mjs must register an openai provider entry that builds OpenAIAdapter and requires OPENAI_API_KEY");
    assert.match(SMOKE_SRC, /import\s*\{\s*OpenAIAdapter\s*\}\s*from\s*"\.\.\/dist\/adapters\/openai\.js"/);
  });

  it("P8 · vision-smoke OpenAI route can classify image transport unsupported distinctly", () => {
    // The skip-classifier still emits SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED
    // separately from FAIL_PROVIDER. vision-smoke continues to handle it
    // as a stop-early condition with its own reason name.
    assert.match(SMOKE_SRC, /SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED/);
    assert.match(SMOKE_SRC, /FAIL_PROVIDER/);
  });

  it("P9 · Vision UI renders multiple tested routes (mimo + gpt-5.4-mini)", () => {
    assert.match(HTML, /VISION_TESTED_ROUTES\s*=\s*\[/);
    assert.match(HTML, /providerId:'openrouter'[^}]*modelId:'xiaomi\/mimo-v2-omni'/);
    assert.match(HTML, /providerId:'openai'[^}]*modelId:'gpt-5\.4-mini'/);
    assert.match(HTML, /class="vision-routes-list"/);
    assert.match(CSS, /\.vision-route\{/);
  });

  it("P10 · Vision UI still says EXPERIMENTAL / NOT IN LEADERBOARD / NOT CERTIFIED", () => {
    // The three permanent posture chips must remain in the panel
    // regardless of how many routes have been tested.
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT IN LEADERBOARD/);
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
    assert.match(HTML, /Vision does not affect model certification/);
  });

  it("P11 · GPT-5.4-mini Vision results did not alter certified-models.json", () => {
    // Phase 9 must not promote gpt-5.4-mini via certified-models.json.
    if (!existsSync(CERTIFIED_MODELS_JSON)) return; // file is optional infra; tolerate absence
    const cm = JSON.parse(readFileSync(CERTIFIED_MODELS_JSON, "utf-8"));
    const models: Array<{ providerId?: string; modelId?: string; tier?: string }> = (cm && cm.models) || [];
    const hit = models.find((m) => m.providerId === "openai" && m.modelId === "gpt-5.4-mini");
    if (hit) {
      assert.notEqual(hit.tier, "RELEASE_CERTIFIED", "gpt-5.4-mini must not be RELEASE_CERTIFIED via Vision smoke");
      assert.notEqual(hit.tier, "PROVIDER_TESTED", "Phase 9 Vision smoke alone does not promote gpt-5.4-mini to PROVIDER_TESTED");
    }
  });

  it("P12 · Vision tab still contributes zero score families to the leaderboard composite", () => {
    // The TAB_CONFIG entry's scoreFamilies array gates composite
    // inclusion. Empty array = excluded by construction.
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
  });

  it("P13 · existing OpenRouter / xiaomi/mimo-v2-omni route preserved in the registry + UI", () => {
    // Phase 9 must not displace the Phase-6 proven route.
    assert.match(HTML, /providerId:'openrouter',modelId:'xiaomi\/mimo-v2-omni',tier:'PROVIDER_TESTED'/);
    assert.match(HTML, /VISION_PROVEN_ROUTE\s*=\s*\{[^}]*xiaomi\/mimo-v2-omni/);
  });

  it("P14 · release-gauntlet vision-family inventory pinned (Phase 9 left it at 5; Phase 14 / Roadmap C grew it to 15)", () => {
    // Phase 9 itself added a Vision model (gpt-5.4-mini) but did not
    // change the Vision task count (still 5 at that time). Phase 14 /
    // Roadmap C grew the Vision suite to 15 to satisfy the
    // CAPABILITY_CERTIFIED suite-size doctrine gate. The 5 original
    // POC tests are preserved unchanged; this assertion tracks the
    // post-Phase-14 live count.
    const visionDir = join(ROOT, "tasks", "vision");
    const subdirs = readdirSync(visionDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    assert.equal(subdirs.length, 15, `vision family expected at 15 tasks post Phase 14; got ${subdirs.length}: ${subdirs.join(", ")}`);
  });
});
