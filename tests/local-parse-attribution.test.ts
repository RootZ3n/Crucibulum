/**
 * The misattribution, demonstrated and then closed.
 *
 * ## What happened
 *
 * A qualification run against `qwen3.5-35b-a3b.iq3-xxs` produced completions
 * carrying `\u{3e}` inside JSON string values. `\u` in JSON must be followed by
 * exactly four hex digits; `\u{3e}` is not that, so `JSON.parse` refuses the
 * document. Luak recorded `local_harness_parse_failure` attributed to
 * HARNESS_PARSER, `scoreAttempt` turned that into HARNESS_FAILURE, and the
 * attempt left the model's capability distribution entirely.
 *
 * Every one of those steps worked as written. The transport delivered the
 * completion whole, the responder read it whole, and the parser reported
 * exactly what `JSON.parse` said. There was no harness defect anywhere in the
 * chain. What there was, was a model that could not hold to its output contract,
 * recorded as a harness that could not read it — and the error ran in the
 * direction that flatters the model, which is the direction a qualification
 * harness must never fail in.
 *
 * ## Where the escape comes from, and why that does not change the attribution
 *
 * `\u{3e}` is not arbitrary. Bokahli delivers evidence through Velum's fence,
 * and `neutralize()` escapes every `<` and `>` as `\u{3c}` / `\u{3e}` so that
 * content cannot forge the `>>>velum:end` marker and continue as instructions.
 * The campaign's own triage evidence contains 49 `>` characters. A model asked
 * to quote a line verbatim quotes what it was shown.
 *
 * That explains the failure. It does not reassign it. Under the unconstrained
 * regime the model is responsible for emitting valid JSON, and `>` inside a JSON
 * string needs no escape at all — `>` would also have been valid. Copying a
 * `\u{...}` sequence into a JSON string literal is a mistake about JSON, made by
 * the model, on evidence it read correctly. The transport's contribution is
 * real, is reported, and belongs in the campaign's findings; it is not an excuse
 * the taxonomy gets to apply on the model's behalf.
 *
 * ## What must stay true
 *
 * HARNESS_PARSER is not abolished. It means what it always should have meant:
 * the harness could not do its job. These tests pin both halves — the failures
 * that move to MODEL, and the failures that must not.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTriageAnswer, parseReconAnswer } from "../core/local/parsers.js";
import { runLocalSuite, type LocalResponse } from "../core/local/runner.js";
import { loadLocalSuite } from "../core/local/suite-registry.js";
import { scoreAttempt } from "../core/local/regime.js";
import { LOCAL_FAILURE_MAP } from "../types/local-verdict.js";
import { TEST_LOG_TRIAGE_FIXTURES, REPO_RECON_FIXTURES } from "../core/local/fixtures/index.js";

const TRIAGE_FX = TEST_LOG_TRIAGE_FIXTURES[0]!;
const RECON_FX = REPO_RECON_FIXTURES[0]!;
const SUITE = "local-l1-schema-grounding";

/**
 * The exact shape the IQ3_XXS run emitted.
 *
 * One backslash, not two. With two it is a valid JSON string containing the six
 * literal characters `\u{3e}`, which parses and then fails citation grounding
 * instead — a different defect, covered separately. With one it is invalid JSON,
 * which is the case that was misattributed.
 */
const IQ3_COMPLETION =
  '{"outcome":"ANSWERED","failureGroups":[{"classification":"ASSERTION_FAILURE",' +
  '"observed":"a test failed","citations":[{"startLine":3,"endLine":3,' +
  '"quote":"FAIL  src/import/parse.test.ts \\u{3e} rejects a malformed row"}]}],' +
  '"truncationReported":false,"needs":[]}';

function response(rawText: string, finishReason: string | null = "stop"): LocalResponse {
  return {
    rawText, finishReason,
    promptTokens: 900, completionTokens: 120,
    tokenCountSource: "runtime_tokenizer",
    timeToFirstTokenMs: 400, decodeTokensPerSecond: 50, wallTimeMs: 2800,
  };
}

// ---------------------------------------------------------------------------
// the regression itself
// ---------------------------------------------------------------------------

test("the IQ3 completion is genuinely invalid JSON, so the premise holds", () => {
  assert.throws(() => JSON.parse(IQ3_COMPLETION),
    "if this ever parses, the rest of this file is testing nothing");
});

test("invalid JSON from a delivered completion is MODEL, not HARNESS_PARSER", () => {
  const p = parseTriageAnswer(IQ3_COMPLETION, TRIAGE_FX);
  assert.equal(p.status, "CONTRACT_VIOLATION");
  assert.equal(
    p.status === "CONTRACT_VIOLATION" ? p.failureCode : null,
    "local_invalid_structured_output",
  );
  assert.equal(LOCAL_FAILURE_MAP["local_invalid_structured_output"].attribution, "MODEL");
  assert.equal(LOCAL_FAILURE_MAP["local_invalid_structured_output"].countsTowardModelScore, true);
});

test("end to end: the attempt is FAIL/MODEL and stays inside the model's distribution", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: parseTriageAnswer, parseRecon: parseReconAnswer,
    responder: async () => response(IQ3_COMPLETION),
  });

  assert.equal(r.records.length, 2);
  for (const s of r.scored) {
    assert.equal(s.attribution, "MODEL");
    assert.equal(s.outcome, "FAIL");
    assert.deepEqual(s.failureCodes, ["local_invalid_structured_output"]);
    assert.notEqual(s.outcome, "HARNESS_FAILURE",
      "the outcome that removed this attempt from the model's distribution");
  }
});

test("the raw completion survives on the record, so the verdict can be re-read", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: parseTriageAnswer, parseRecon: parseReconAnswer,
    responder: async () => response(IQ3_COMPLETION),
  });

  for (const rec of r.records) {
    assert.ok(rec.completion, "a received completion must be bound to its record");
    assert.match(rec.completion.sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(rec.completion.chars, IQ3_COMPLETION.length);
    assert.equal(rec.completion.finishReason, "stop");
  }

  assert.equal(r.completions.length, 2);
  for (const c of r.completions) {
    assert.equal(c.text, IQ3_COMPLETION, "kept verbatim: not repaired, not re-escaped");
    const rec = r.records.find((x) => x.attemptId === c.attemptId);
    assert.equal(rec?.completion?.sha256, c.sha256, "the digest on the record resolves the bytes");
  }
});

test("the completion is never repaired on the way to a verdict", () => {
  // A parser that fixed `\\u{3e}` into `>` would turn a failing attempt into a
  // passing one and report a capability the model does not have.
  const p = parseTriageAnswer(IQ3_COMPLETION, TRIAGE_FX);
  assert.equal(p.status, "CONTRACT_VIOLATION");
  assert.notEqual(p.status, "PARSED");
});

// ---------------------------------------------------------------------------
// the other side: what HARNESS_PARSER still means
// ---------------------------------------------------------------------------

test("a thrown extractor is a harness failure and says so with the reserved code", () => {
  const suite = loadLocalSuite(SUITE)!;
  return runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: () => { throw new Error("projection blew up"); },
    parseRecon: () => { throw new Error("projection blew up"); },
    responder: async () => response('{"outcome":"ANSWERED"}'),
  }).then(() => assert.fail("a throwing parser must propagate, not be silently absorbed"))
    .catch((err: Error) => {
      assert.match(err.message, /projection blew up/);
    });
});

test("an extractor that reports its own fault is never attributed to the model", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: () => ({ status: "EXTRACTOR_FAULT", detail: "line index table unavailable" }),
    parseRecon: () => ({ status: "EXTRACTOR_FAULT", detail: "line index table unavailable" }),
    responder: async () => response('{"outcome":"ANSWERED"}'),
  });
  for (const rec of r.records) {
    assert.deepEqual(rec.lanes[0]!.failureCodes, ["local_harness_extraction_failure"]);
    // The lane restates the code's own attribution rather than a weaker one
    // beside it; two sources for the same fact eventually disagree.
    assert.equal(rec.lanes[0]!.attribution,
      LOCAL_FAILURE_MAP["local_harness_extraction_failure"].attribution);
  }
  for (const s of r.scored) {
    assert.equal(s.outcome, "HARNESS_FAILURE");
    assert.notEqual(s.attribution, "MODEL");
  }
});

test("local_harness_extraction_failure keeps its non-model, non-exportable semantics", () => {
  const m = LOCAL_FAILURE_MAP["local_harness_extraction_failure"];
  assert.equal(m.attribution, "COMPOSITE",
    "COMPOSITE is the stronger statement: the measurement cannot be cleanly assigned at all");
  assert.equal(m.countsTowardModelScore, false);
  assert.equal(m.failureOrigin, "HARNESS");
});

// ---------------------------------------------------------------------------
// the neighbouring model-side codes stay distinguishable
// ---------------------------------------------------------------------------

test("a runtime that says it hit the token limit yields truncation, not malformed output", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: parseTriageAnswer, parseRecon: parseReconAnswer,
    responder: async () => response('{"outcome":"ANSWERED","failureGroups":[{"observed":"cut off', "length"),
  });
  for (const s of r.scored) {
    assert.deepEqual(s.failureCodes, ["local_truncated_completion"]);
    assert.equal(s.attribution, "MODEL");
    assert.equal(s.outcome, "INCOMPLETE", "cut off is not the same verdict as wrong");
  }
});

test("an empty completion is the model's, and is not truncation", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: parseTriageAnswer, parseRecon: parseReconAnswer,
    responder: async () => response("   "),
  });
  for (const s of r.scored) {
    assert.deepEqual(s.failureCodes, ["local_empty_completion"]);
    assert.equal(s.attribution, "MODEL");
  }
});

test("scoreAttempt no longer has a route from malformed output to HARNESS_FAILURE", () => {
  const scored = scoreAttempt({
    attemptId: "att_x", evidenceTransport: null, fixtureId: TRIAGE_FX.id,
    suiteId: "local-test-log-triage", suiteVersion: "1.0.0", split: "evaluation",
    applicability: "APPLICABLE",
    lanes: [{
      lane: "structured_output", scorerVersion: "local-scorers-1.1.0",
      measurements: [{ name: "structuredOutput.valid", value: 0, unit: "boolean", detail: "" }],
      failureCodes: ["local_invalid_structured_output"], attribution: "MODEL", notes: [],
    }],
    completion: { sha256: "sha256:" + "0".repeat(64), chars: 12, finishReason: "stop" },
    contextPosition: null, contextTier: "control",
    promptTokens: 10, completionTokens: 3, tokenCountSource: "runtime_tokenizer",
    timeToFirstTokenMs: 1, decodeTokensPerSecond: 1, wallTimeMs: 1, seed: 1,
  });
  assert.equal(scored.attribution, "MODEL");
  assert.equal(scored.outcome, "FAIL");
  assert.equal(scored.laneScores["structured_output"], 0);
});

test("recon output takes the same route, so the two fixture shapes cannot disagree", () => {
  const p = parseReconAnswer(IQ3_COMPLETION.replace("failureGroups", "files"), RECON_FX);
  assert.equal(p.status, "CONTRACT_VIOLATION");
  assert.equal(
    p.status === "CONTRACT_VIOLATION" ? p.failureCode : null,
    "local_invalid_structured_output",
  );
});
