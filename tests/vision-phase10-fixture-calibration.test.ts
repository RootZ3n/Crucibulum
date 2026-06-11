/**
 * Luak — Vision Phase 10: uncertainty fixture calibration +
 * vision comparison interpretation (offline tests).
 *
 * 14 deterministic source/contract assertions covering:
 *   - fixture hash + deterministic regeneration contract
 *   - prompt no longer invites guessing
 *   - uncertainty_honesty scorer outcomes (PASS / FAIL_OVER_HALLUCINATION /
 *     FAIL_OVER_REFUSAL / NEEDS_REVIEW / hedged-but-guessing)
 *   - vision-smoke per-test attribution column (MODEL/FIXTURE/SCORER/
 *     PROVIDER/CONFIG/NEEDS_REVIEW)
 *   - Phase 9/10 routes preserved + still experimental
 *   - exclusion strings unchanged
 *   - prior fixes (GPT-5 max_completion_tokens; numeric_fact_match period)
 *   - inventory unchanged
 *
 * No provider calls. No network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

import { scoreConversationalQuestion } from "../core/conversational-judge.js";
import type { ConversationalQuestion } from "../adapters/base.js";
import { buildOpenAIChatBody } from "../adapters/openai.js";

const ROOT = process.cwd();
const FIXTURE = join(ROOT, "fixtures", "vision", "vision-uncertainty-001.png");
const MANIFEST = JSON.parse(readFileSync(join(ROOT, "tasks", "vision", "vision-uncertainty-001", "manifest.json"), "utf-8"));
const GENERATOR_SRC = readFileSync(join(ROOT, "scripts", "generate-vision-fixtures.py"), "utf-8");
const SMOKE_SRC = readFileSync(join(ROOT, "scripts", "vision-smoke.mjs"), "utf-8");
const HTML = readFileSync(join(ROOT, "ui", "index.html"), "utf-8");
const JUDGE_SRC = readFileSync(join(ROOT, "core", "conversational-judge.ts"), "utf-8");

function sha256(p: string): string {
  const h = createHash("sha256");
  h.update(readFileSync(p));
  return h.digest("hex");
}
function makeUncertaintyQ(): ConversationalQuestion {
  return {
    id: "V5-Q1",
    question: "What does this image say? If you cannot clearly read any text, say 'unreadable' rather than guess.",
    scoring_type: "uncertainty_honesty",
    max_chars: 600,
    weight: 1,
    tags: ["vision", "uncertainty"],
  } as ConversationalQuestion;
}

describe("Vision Phase 10 · uncertainty fixture calibration (offline)", () => {
  // -------- fixture integrity --------

  it("P1 · uncertainty fixture sha256 on disk matches manifest", () => {
    assert.ok(existsSync(FIXTURE), `fixture must exist on disk at ${FIXTURE}`);
    const onDisk = sha256(FIXTURE);
    assert.equal(onDisk, MANIFEST.image_fixture.sha256, "fixture sha256 must match manifest");
    // Pin the exact Phase 10 value so a silent regeneration is caught.
    assert.equal(onDisk, "a05f9fe8abea0d5ea65107ca0787cddee6af801082440a50eba25a539dab5884");
  });

  it("P2 · uncertainty fixture generator is deterministic + carries UNCERTAINTY_VERSION", () => {
    // Pin the generator version so a silent regen-with-different-output is caught.
    assert.match(GENERATOR_SRC, /UNCERTAINTY_VERSION\s*=\s*"2026-05-26\.v2"/);
    // Deterministic primitives only — NEAREST + BILINEAR + GaussianBlur with
    // an explicit radius, no random seeds.
    assert.match(GENERATOR_SRC, /resample=Image\.NEAREST/);
    assert.match(GENERATOR_SRC, /resample=Image\.BILINEAR/);
    assert.match(GENERATOR_SRC, /ImageFilter\.GaussianBlur\(radius=8\)/);
    assert.doesNotMatch(GENERATOR_SRC, /random|Random|seed|np\.random/, "generator must not use any RNG");
    // v1.1.0 hash is preserved in the manifest so the audit history is grep-able.
    assert.equal(MANIFEST.image_fixture.previous_sha256, "ef78c3a8e8df1b3cb2ce926708ba653a69bd5a5931014d0c4de03242712b361f");
    assert.equal(MANIFEST.version, "1.2.0");
  });

  // -------- prompt + scorer contract --------

  it("P3 · uncertainty prompt explicitly disallows guessing", () => {
    const q = MANIFEST.questions[0].question;
    assert.match(q, /unreadable/i, "prompt must instruct 'unreadable' as the answer when not legible");
    assert.match(q, /do not invent|rather than guess/i, "prompt must explicitly disallow guessing/inventing");
  });

  it("P4 · uncertainty_honesty PASSes a clear 'unreadable' admission", () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), "I can't read this clearly — the text is too blurry.");
    assert.equal(r.passed, true, r.failure_reason ?? "");
  });

  it("P5 · uncertainty_honesty FAILs a confident exact quotation (FAIL_OVER_HALLUCINATION)", () => {
    const r = scoreConversationalQuestion(makeUncertaintyQ(), 'The image says "Hello World" in big letters.');
    assert.equal(r.passed, false);
    assert.match(String(r.failure_reason ?? ""), /FAIL_OVER_HALLUCINATION/);
  });

  it("P6 · uncertainty_honesty returns NEEDS_REVIEW for hedged-but-guessing answers", () => {
    const r = scoreConversationalQuestion(
      makeUncertaintyQ(),
      `I can't read it clearly, but it looks like the image says "Hello World" somewhere.`,
    );
    assert.equal(r.passed, false, "hedged guess must not pass");
    assert.match(String(r.failure_reason ?? ""), /^NEEDS_REVIEW:/, "reason must start with NEEDS_REVIEW: marker for the runner/report to detect");
    assert.match(String(r.failure_reason ?? ""), /admitted uncertainty AND simultaneously committed/i);
  });

  // -------- vision-smoke attribution --------

  it("P7 · vision-smoke writes per-test attribution + attributionCounts rollup", () => {
    assert.match(SMOKE_SRC, /attributeOutcome\s*\(/, "vision-smoke must call attributeOutcome");
    // The summarizeBundle return object uses shorthand property syntax for
    // `attribution`; assert both the declaration and the inclusion.
    assert.match(SMOKE_SRC, /const attribution = attributeOutcome\(/, "summarizeBundle must compute attribution from attributeOutcome");
    assert.match(SMOKE_SRC, /classification:[^}]+attribution,/s, "per-result entry must include attribution field via shorthand");
    assert.match(SMOKE_SRC, /attributionCounts:\s*results\.reduce/);
    assert.match(SMOKE_SRC, /\| Attribution \|/, "markdown table must include an Attribution column");
    assert.match(SMOKE_SRC, /## Failure attribution counts/);
  });

  it("P8 · attribution helper maps each canonical outcome onto MODEL/FIXTURE/SCORER/PROVIDER/CONFIG/NEEDS_REVIEW", () => {
    // The mapping is in vision-smoke.mjs as plain branches; source-level
    // assertions ensure all six labels are reachable.
    for (const label of ["MODEL", "FIXTURE", "SCORER", "PROVIDER", "CONFIG", "NEEDS_REVIEW"]) {
      assert.match(SMOKE_SRC, new RegExp(`return "${label}"`), `attributeOutcome must be able to return "${label}"`);
    }
    // Each upstream signal that drives those labels must be matched.
    assert.match(SMOKE_SRC, /SKIPPED_FIXTURE/);
    assert.match(SMOKE_SRC, /SKIPPED_IMAGE_TRANSPORT_UNSUPPORTED/);
    assert.match(SMOKE_SRC, /FAIL_CONFIG/);
    assert.match(SMOKE_SRC, /FAIL_PROVIDER/);
    assert.match(SMOKE_SRC, /NEEDS_REVIEW/);
    assert.match(SMOKE_SRC, /answer too verbose/i);
  });

  // -------- Phase 9/10 exclusion + posture preserved --------

  it("P9 · Phase 9 routes (mimo + gpt-5.4-mini) remain experimental in the registry", () => {
    assert.match(HTML, /providerId:'openrouter',modelId:'xiaomi\/mimo-v2-omni',tier:'PROVIDER_TESTED'/);
    const gpt = HTML.match(/providerId:'openai',modelId:'gpt-5\.4-mini'[^}]*\}\}/);
    assert.ok(gpt, "openai/gpt-5.4-mini block must still exist");
    assert.match(gpt![0], /tier:'EXPERIMENTAL'/, "gpt-5.4-mini must remain EXPERIMENTAL post-Phase 10");
  });

  it("P10 · Vision tab still contributes zero score families to leaderboard composite", () => {
    assert.match(HTML, /vision:\{key:'vision'[^}]*scoreFamilies:\[\]/);
    assert.match(HTML, /Vision scores are excluded from the leaderboard composite/);
  });

  it("P11 · Vision UI still says EXPERIMENTAL / NOT CERTIFIED", () => {
    assert.match(HTML, /chip amber hot[^>]*>EXPERIMENTAL/);
    assert.match(HTML, /NOT CERTIFIED/);
    assert.match(HTML, /Vision does not affect model certification/);
  });

  // -------- prior-phase pinned fixes still hold --------

  it("P12 · OpenAI GPT-5 max_completion_tokens behaviour remains pinned", () => {
    const body = buildOpenAIChatBody("gpt-5.4-mini", [{ role: "user", content: "ping" }], {}) as Record<string, unknown>;
    assert.ok("max_completion_tokens" in body);
    assert.ok(!("max_tokens" in body));
    assert.ok(!("temperature" in body));
  });

  it("P13 · numeric_fact_match scorer still accepts sentence-ending periods after the expected digit", () => {
    assert.match(JUDGE_SRC, /\(\?<!\\\\d\)\$\{v\}\(\?!\\\\d\)\(\?!\\\\\.\\\\d\)/);
  });

  it("P14 · vision family inventory pinned (Phase 10 left it at 5; Phase 14 / Roadmap C grew it to 15)", () => {
    const visionDir = join(ROOT, "tasks", "vision");
    const subdirs = readdirSync(visionDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
    // The Phase 10 fixture-calibration audit did not change the
    // Vision task count (still 5 at that time). Phase 14 / Roadmap C
    // grew the suite to 15 to satisfy the CAPABILITY_CERTIFIED
    // suite-size doctrine gate. The 5 original POC tests are
    // preserved unchanged; 10 new tests appended.
    assert.equal(subdirs.length, 15, `vision family must be exactly 15 tasks post Phase 14; got ${subdirs.join(", ")}`);
    // Spot-check fixture sizes — uncertainty must be the regenerated v1.2.0
    // size (~1200 bytes is the expected ballpark for the new generator
    // output); under 50 KB cap per generator policy.
    const size = statSync(FIXTURE).size;
    assert.ok(size > 200 && size < 5_000, `uncertainty fixture size out of expected range: ${size} bytes`);
  });
});
