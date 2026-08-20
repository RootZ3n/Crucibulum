/**
 * The pilot execution path: repeats, per-attempt preconditions, and parsing.
 *
 * A pilot is only evidence if the run it produced can be trusted to have
 * stopped when the ground moved. These tests cover the three pieces that make
 * that true — repetition is real repetition, the precondition is checked before
 * *every* attempt rather than once, and a run that aborts says so instead of
 * returning a short record set that reads like a complete one.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runLocalSuite, type LocalResponse } from "../core/local/runner.js";
import { loadLocalSuite } from "../core/local/suite-registry.js";
import { parseReconAnswer, parseTriageAnswer } from "../core/local/parsers.js";
import { TEST_LOG_TRIAGE_FIXTURES, REPO_RECON_FIXTURES } from "../core/local/fixtures/index.js";

const SUITE = "local-l1-schema-grounding";

function ok(rawText: string): LocalResponse {
  return {
    rawText, promptTokens: 10, completionTokens: 5,
    tokenCountSource: "runtime_reported_unknown_tokenizer",
    timeToFirstTokenMs: 1, decodeTokensPerSecond: 1, wallTimeMs: 2,
  };
}

test("repeats multiplies the schedule, not the prompt list", async () => {
  const suite = loadLocalSuite(SUITE)!;
  let calls = 0;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1, repeats: 3,
    responder: async () => { calls += 1; return ok("{}"); },
  });
  assert.equal(r.prompts.length, 2, "the suite's evaluation split is two fixtures");
  assert.equal(calls, 6, "three repeats of two fixtures is six attempts");
  assert.equal(r.records.length, 6);
  assert.equal(r.abortedReason, undefined);
});

test("repeats defaults to one and is never below one", async () => {
  const suite = loadLocalSuite(SUITE)!;
  for (const repeats of [undefined, 0, -5]) {
    let calls = 0;
    await runLocalSuite({
      suite, split: "evaluation", seed: 1,
      ...(repeats === undefined ? {} : { repeats }),
      responder: async () => { calls += 1; return ok("{}"); },
    });
    assert.equal(calls, 2, `repeats=${String(repeats)} must mean one pass`);
  }
});

test("the precondition runs before every attempt, not once", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const seen: number[] = [];
  await runLocalSuite({
    suite, split: "evaluation", seed: 1, repeats: 3,
    precondition: async (i) => { seen.push(i); return null; },
    responder: async () => ok("{}"),
  });
  assert.deepEqual(seen, [0, 1, 2, 3, 4, 5]);
});

test("a failing precondition aborts the run and is reported, not swallowed", async () => {
  const suite = loadLocalSuite(SUITE)!;
  let calls = 0;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1, repeats: 3,
    precondition: async (i) => (i === 2 ? "runtime restarted between attempts" : null),
    responder: async () => { calls += 1; return ok("{}"); },
  });
  assert.equal(calls, 2, "no attempt is made after the precondition fails");
  assert.equal(r.records.length, 2);
  assert.equal(r.abortedReason, "runtime restarted between attempts");
  // The partial run must not look complete to anything reading the result.
  assert.notEqual(r.records.length, r.prompts.length * 3);
});

test("a precondition that fails on the first attempt yields no records at all", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    precondition: async () => "identity mismatch",
    responder: async () => { throw new Error("must not be called"); },
  });
  assert.equal(r.records.length, 0);
  assert.equal(r.abortedReason, "identity mismatch");
  assert.equal(r.dryRun, false, "an aborted live run is not a dry run");
});

// ---------------------------------------------------------------------------
// parsers
// ---------------------------------------------------------------------------

const TRIAGE_FX = TEST_LOG_TRIAGE_FIXTURES[0]!;
const RECON_FX = REPO_RECON_FIXTURES[0]!;

test("a fenced JSON object parses; models wrap output far more often than they break it", () => {
  const a = parseTriageAnswer(
    '```json\n{"outcome":"ANSWERED","failureGroups":[],"truncationReported":false,"needs":[]}\n```',
    TRIAGE_FX,
  );
  assert.ok(a);
  assert.equal(a.abstained, false);
});

test("outcome must be one of the two declared values", () => {
  for (const bad of ['{"outcome":"yes"}', '{"outcome":null}', "{}", '{"outcome":"answered"}']) {
    assert.equal(parseTriageAnswer(bad, TRIAGE_FX), null, `must refuse ${bad}`);
  }
});

test("the parser repairs nothing", () => {
  // Trailing comma, single quotes, and a bare fragment are all refusals. A
  // parser that fixed these would be scoring its own repairs.
  for (const bad of ['{"outcome":"ANSWERED",}', "{'outcome':'ANSWERED'}", "ANSWERED", ""]) {
    assert.equal(parseTriageAnswer(bad, TRIAGE_FX), null);
  }
});

test("a JSON array or scalar is not an answer object", () => {
  for (const bad of ["[]", '["outcome"]', '"ANSWERED"', "42", "null"]) {
    assert.equal(parseTriageAnswer(bad, TRIAGE_FX), null);
    assert.equal(parseReconAnswer(bad, RECON_FX), null);
  }
});

test("ABSTAINED is a valid answer, not a parse failure", () => {
  const a = parseTriageAnswer('{"outcome":"ABSTAINED","needs":["the full log"]}', TRIAGE_FX);
  assert.ok(a);
  assert.equal(a.abstained, true);
  assert.deepEqual(a.statedNeeds, ["the full log"]);
});

test("malformed citations are dropped rather than becoming NaN line numbers", () => {
  const a = parseTriageAnswer(JSON.stringify({
    outcome: "ANSWERED",
    failureGroups: [{
      classification: "ASSERTION",
      observed: "x",
      citations: [{ startLine: 3 }, { startLine: "nonsense" }, null, { endLine: 9 }],
    }],
  }), TRIAGE_FX);
  assert.ok(a);
  const cites = a.groups[0]!.citations;
  assert.equal(cites.length, 1, "only the one citation with a usable start line survives");
  assert.equal(cites[0]!.startLine, 3);
  assert.equal(cites[0]!.endLine, 3, "a missing end line means a single line, not zero");
});

test("recon citations inherit the file path they were listed under", () => {
  const a = parseReconAnswer(JSON.stringify({
    outcome: "ANSWERED",
    files: [{ path: "core/a.ts", citations: [{ startLine: 1, endLine: 2 }] }],
  }), RECON_FX);
  assert.ok(a);
  assert.equal(a.files[0]!.citations[0]!.path, "core/a.ts");
});

test("non-string entries in string arrays are dropped, not stringified", () => {
  const a = parseTriageAnswer(
    '{"outcome":"ANSWERED","needs":["real",7,null,{"a":1}]}', TRIAGE_FX,
  );
  assert.ok(a);
  assert.deepEqual(a.statedNeeds, ["real"]);
});

test("rawText is preserved verbatim so a scored answer can be re-read", () => {
  const raw = '```json\n{"outcome":"ABSTAINED"}\n```';
  assert.equal(parseTriageAnswer(raw, TRIAGE_FX)!.rawText, raw);
});

test("an unparseable response becomes a HARNESS_PARSER failure, never a model failure", async () => {
  const suite = loadLocalSuite(SUITE)!;
  const r = await runLocalSuite({
    suite, split: "evaluation", seed: 1,
    parseTriage: parseTriageAnswer, parseRecon: parseReconAnswer,
    responder: async () => ok("I'm afraid I can't do that."),
  });
  assert.equal(r.records.length, 2);
  for (const rec of r.records) {
    const lanes = rec.lanes;
    assert.equal(lanes.length, 1);
    assert.equal(lanes[0]!.attribution, "HARNESS_PARSER");
    assert.deepEqual(lanes[0]!.failureCodes, ["local_harness_parse_failure"]);
  }
});
