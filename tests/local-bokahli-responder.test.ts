/**
 * Bokahli responder: config, credentials, failure mapping, streaming.
 *
 * Everything runs against a fake HTTP server built from Bokahli's real response
 * shapes, read out of its source at 00f1508. No fixture here contains a secret,
 * and none reaches the live deployment.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { chmodSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BOKAHLI_RESPONDER_CONFIG_VERSION, defaultLoopbackConfig, validateBokahliConfig,
  type BokahliResponderConfig,
} from "../core/local/responders/bokahli-config.js";
import { authHeaders, readCredential, redact, redactDeep, safeHeaders, CredentialError }
  from "../core/local/responders/credentials.js";
import {
  ALL_MAPS, anyModelAttributed, BOKAHLI_FAILURE_MAP_VERSION, lookupOutcome,
} from "../core/local/responders/bokahli-failure-map.js";
import {
  BOKAHLI_TOKEN_PROVENANCE_FLOOR, classifyTransportError, createBokahliResponder,
  type BokahliResponse,
} from "../core/local/responders/bokahli.js";
import { parseFrame, readBokahliStream } from "../core/local/responders/bokahli-stream.js";
import { LOCAL_FAILURE_MAP } from "../types/local-verdict.js";
import {
  EVIDENCE_TRANSPORT_VERSION, buildEvidencePacket, evidenceSetDigest,
} from "../core/local/evidence.js";
import type { AttemptRecord } from "../core/local/regime.js";
import type { LocalPrompt } from "../core/local/runner.js";

const MODEL = "testmodel.q4-k";
const DIGEST = `sha256:${"a".repeat(64)}`;
const BUILD = "b10505-test";
const FAKE_TOKEN = "not-a-real-token-0000000000000000000000000";

const EVIDENCE = [buildEvidencePacket({
  id: "tlt-008-abstention-required/log",
  label: "tlt-008-abstention-required.log",
  kind: "test-log",
  content: "line one\nline two\n",
})];

const PROMPT: LocalPrompt = {
  fixtureId: "tlt-008-abstention-required",
  split: "evaluation",
  system: "sys",
  user: "user",
  evidence: EVIDENCE,
  evidenceSetDigest: evidenceSetDigest(EVIDENCE),
  transportVersion: EVIDENCE_TRANSPORT_VERSION,
  outputSchemaKeys: ["outcome"],
};

// ---------------------------------------------------------------------------
// fake Bokahli, built from the real response shapes
// ---------------------------------------------------------------------------

let server: Server;
let base: string;
let nextResponse: { status: number; body: unknown; sse?: string; headers?: Record<string, string> } = { status: 200, body: {} };
let lastRequest: { headers: Record<string, string | string[] | undefined>; body: unknown } | null = null;

function routedBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    requestId: "req-1",
    outcome: "ROUTED",
    requested: { mode: "EXACT", modelId: MODEL, artifactDigest: DIGEST },
    route: { kind: "ROUTED", mode: "EXACT", selected: {}, considered: [], rationale: "" },
    result: {
      content: '{"outcome":"ABSTAINED"}',
      finishReason: "stop",
      servedIdentity: {
        modelId: MODEL, digest: DIGEST,
        runtime: { engine: "llama.cpp", build: BUILD, executableDigest: null, cuda: null, driver: null },
        servedContextTokens: 32768,
        qualification: { status: "INSTALLED_UNQUALIFIED" },
        attested: true, attestationMethod: "backend-props-match",
      },
    },
    telemetry: {
      requestId: "req-1", receivedAt: "2026-08-20T12:00:00Z", completedAt: "2026-08-20T12:00:01Z",
      queueWaitMs: 0, queueDepthAtAdmission: 0, routeMs: 4,
      timeToFirstTokenMs: 288, totalMs: 390,
      promptTokens: 120, completionTokens: 18,
      promptTokensPerSecond: 71.25, completionTokensPerSecond: 58.9,
      servedContextTokens: 32768, contextUtilisation: 0.004, runtimeBuild: BUILD,
      gpu: { totalMiB: 12282, usedMiB: 2850, freeMiB: 9023, utilisationPct: 0, temperatureC: 34 },
    },
    ...over,
  };
}

before(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      let parsed: unknown = null;
      try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8")); } catch { /* ignore */ }
      lastRequest = { headers: req.headers, body: parsed };
      if (nextResponse.sse !== undefined) {
        res.writeHead(200, { "content-type": "text/event-stream", ...nextResponse.headers });
        res.end(nextResponse.sse);
        return;
      }
      res.writeHead(nextResponse.status, {
        "content-type": "application/json", ...nextResponse.headers,
      });
      res.end(JSON.stringify(nextResponse.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

after(async () => {
  server.closeAllConnections?.();
  await new Promise<void>((r) => server.close(() => r()));
});

function credFile(mode = 0o600): string {
  const dir = mkdtempSync(join(tmpdir(), "luak-cred-"));
  const p = join(dir, "token");
  writeFileSync(p, `${FAKE_TOKEN}\n`);
  chmodSync(p, mode);
  return p;
}

/**
 * The fixtures in this file are Phase 1 shaped, which is what the deployment
 * still serves. A responder pinned to B2 refuses them as a protocol failure —
 * correctly — so these tests declare the legacy target explicitly. That is the
 * whole point of the pin: legacy is a configuration, never an inference from
 * which fields happened to arrive.
 */
function config(over: Partial<BokahliResponderConfig> = {}): BokahliResponderConfig {
  return {
    configVersion: BOKAHLI_RESPONDER_CONFIG_VERSION,
    protocol: { mode: "legacy", expectedContractVersion: "bokahli.qualification-telemetry.v1" },
    endpoint: base,
    modelId: MODEL, artifactDigest: DIGEST, expectedRuntimeBuild: BUILD,
    contextTier: "control",
    requestTimeoutMs: 5_000, firstTokenTimeoutMs: 2_000,
    credential: { kind: "file", path: credFile() },
    sampler: { temperature: 0, topP: 1, maxTokens: 256 },
    ...over,
  };
}

async function ask(over: Partial<BokahliResponderConfig> = {}): Promise<BokahliResponse> {
  const r = createBokahliResponder({ config: config(over) });
  return (await r(PROMPT)) as BokahliResponse;
}

// ---------------------------------------------------------------------------
// config
// ---------------------------------------------------------------------------

/**
 * A well-formed evidence-transport block for a record that represents a
 * correct campaign. Written out rather than defaulted so a test that means to
 * describe a *legacy* record has to say so by passing null.
 */
function transport(over: Partial<NonNullable<AttemptRecord["evidenceTransport"]>> = {}) {
  return {
    transportVersion: "luak.evidence-transport/1",
    packetCount: 1,
    evidenceSetDigest: `sha256:${"1".repeat(64)}`,
    packetIds: ["fx/log"],
    scannedAll: true,
    fencedPacketCount: 1,
    findingsByPacket: [{
      packetId: "fx/log", zone: "evidence",
      findingCount: 0, peakSeverity: null, disposition: "fenced",
    }],
    modelOutputFindingCount: 0,
    boundaryDecision: "allow",
    detectorVersion: "velum.a32-detector/1.0.0+abaiya-velum-mvp-1",
    registryPayloadSha256: `sha256:${"2".repeat(64)}`,
    ...over,
  };
}

test("a valid loopback config is accepted", () => {
  const v = validateBokahliConfig(defaultLoopbackConfig(MODEL, DIGEST, BUILD));
  assert.equal(v.ok, true, v.ok ? "" : JSON.stringify(v.problems));
});

test("wildcard, public, and credential-bearing endpoints are refused", () => {
  for (const [endpoint, why] of [
    ["http://0.0.0.0:8080", "wildcard"],
    ["http://example.com:8080", "public host"],
    ["http://user:pass@127.0.0.1:8080", "embedded credentials"],
    ["http://127.0.0.1:8080/?token=abc", "query string"],
    ["ftp://127.0.0.1", "scheme"],
  ] as const) {
    const v = validateBokahliConfig({ ...defaultLoopbackConfig(MODEL, DIGEST, BUILD), endpoint });
    assert.equal(v.ok, false, `${why} must be refused`);
  }
  // A tailnet address is allowed: a campaign may be driven from a peer.
  const tail = validateBokahliConfig({
    ...defaultLoopbackConfig(MODEL, DIGEST, BUILD), endpoint: "http://100.115.140.2:8080",
  });
  assert.equal(tail.ok, true);
});

test("path-shaped identities and malformed digests are refused", () => {
  for (const modelId of ["/home/zen/models/x.gguf", "./x", "Model.GGUF", "a/b"]) {
    const v = validateBokahliConfig({ ...defaultLoopbackConfig(modelId, DIGEST, BUILD) });
    assert.equal(v.ok, false, `${modelId} must be refused`);
  }
  for (const digest of ["sha256:NOTHEX", "abc", `sha256:${"a".repeat(63)}`, `SHA256:${"a".repeat(64)}`]) {
    const v = validateBokahliConfig({ ...defaultLoopbackConfig(MODEL, digest, BUILD) });
    assert.equal(v.ok, false, `${digest} must be refused`);
  }
});

test("incomplete exact identity is refused", () => {
  for (const patch of [{ expectedRuntimeBuild: "" }, { contextTier: "" }, { modelId: "" }]) {
    const v = validateBokahliConfig({ ...defaultLoopbackConfig(MODEL, DIGEST, BUILD), ...patch });
    assert.equal(v.ok, false, `${JSON.stringify(patch)} must be refused`);
  }
});

test("a config carrying an embedded secret is refused outright", () => {
  for (const key of ["token", "apiKey", "api_key", "bearerToken", "password"]) {
    const v = validateBokahliConfig({
      ...defaultLoopbackConfig(MODEL, DIGEST, BUILD), [key]: "sk-whatever",
    });
    assert.equal(v.ok, false, `a config carrying ${key} must be refused`);
  }
  const inCred = validateBokahliConfig({
    ...defaultLoopbackConfig(MODEL, DIGEST, BUILD),
    credential: { kind: "env", variable: "X", token: "sk-whatever" },
  });
  assert.equal(inCred.ok, false);
});

// ---------------------------------------------------------------------------
// credentials
// ---------------------------------------------------------------------------

test("a 0600 credential file is read; looser modes are refused", () => {
  assert.equal(readCredential(config({ credential: { kind: "file", path: credFile(0o600) } })), FAKE_TOKEN);
  for (const mode of [0o644, 0o640, 0o604, 0o666]) {
    assert.throws(
      () => readCredential(config({ credential: { kind: "file", path: credFile(mode) } })),
      CredentialError,
      `mode ${mode.toString(8)} must be refused`,
    );
  }
});

test("an env credential is read, and an unset one fails clearly without quoting anything", () => {
  process.env["LUAK_TEST_TOKEN"] = FAKE_TOKEN;
  assert.equal(readCredential(config({ credential: { kind: "env", variable: "LUAK_TEST_TOKEN" } })), FAKE_TOKEN);
  delete process.env["LUAK_TEST_TOKEN"];
  try {
    readCredential(config({ credential: { kind: "env", variable: "LUAK_TEST_TOKEN" } }));
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof CredentialError);
    assert.ok(!(err as Error).message.includes(FAKE_TOKEN));
  }
});

test("redaction covers every carrier the token can travel in", () => {
  for (const text of [
    `Authorization: Bearer ${FAKE_TOKEN}`,
    `authorization:${FAKE_TOKEN}`,
    `curl -H "Authorization: Bearer ${FAKE_TOKEN}" http://x`,
    `http://x/?token=${FAKE_TOKEN}&y=1`,
    `Cookie: bokahli_token=${FAKE_TOKEN}; other=1`,
    `{"token":"${FAKE_TOKEN}"}`,
  ]) {
    const out = redact(text);
    assert.ok(!out.includes(FAKE_TOKEN), `not redacted: ${text.slice(0, 40)}`);
  }
});

test("redactDeep scrubs nested structures destined for evidence", () => {
  const out = redactDeep({
    ok: true,
    headers: { authorization: `Bearer ${FAKE_TOKEN}` },
    nested: [{ apiKey: FAKE_TOKEN }, `Bearer ${FAKE_TOKEN}`],
  });
  assert.ok(!JSON.stringify(out).includes(FAKE_TOKEN));
});

test("safeHeaders hides the credential while keeping the shape", () => {
  const h = safeHeaders(authHeaders(FAKE_TOKEN));
  assert.equal(h["authorization"], "Bearer «redacted»");
  assert.equal(h["content-type"], "application/json");
});

test("no attempt fact or response ever carries the token", async () => {
  nextResponse = { status: 200, body: routedBody() };
  const r = await ask();
  assert.ok(!JSON.stringify(r).includes(FAKE_TOKEN), "the token must not appear anywhere in the result");
});

// ---------------------------------------------------------------------------
// the request Bokahli actually receives
// ---------------------------------------------------------------------------

test("the request is EXACT, names the digest, and never demands qualification", async () => {
  nextResponse = { status: 200, body: routedBody() };
  await ask();
  const body = lastRequest?.body as { route: Record<string, unknown> };
  assert.equal(body.route["mode"], "EXACT");
  assert.equal(body.route["modelId"], MODEL);
  assert.equal(body.route["artifactDigest"], DIGEST);
  // Circularity guard: a campaign produces qualification and cannot presuppose it.
  assert.equal(body.route["requireQualified"], false);
  assert.equal(lastRequest?.headers["authorization"], `Bearer ${FAKE_TOKEN}`);
});

test("the attempt records that this was an authorized qualification attempt", async () => {
  nextResponse = { status: 200, body: routedBody() };
  const r = await ask();
  assert.equal(r.facts.authorizedQualificationAttempt, true);
  assert.equal(r.facts.requireQualifiedSent, false);
});

// ---------------------------------------------------------------------------
// identity binding
// ---------------------------------------------------------------------------

test("a successful attested response binds the exact served identity", async () => {
  nextResponse = { status: 200, body: routedBody() };
  const r = await ask();
  assert.equal(r.facts.attested, true);
  assert.equal(r.facts.attestationMethod, "backend-props-match");
  assert.equal(r.facts.servedModelId, MODEL);
  assert.equal(r.facts.servedDigest, DIGEST);
  assert.equal(r.facts.runtimeBuild, BUILD);
  assert.equal(r.facts.servedContextTokens, 32768);
  assert.equal(r.facts.promptTokensPerSecond, 71.25);
  assert.equal(r.facts.gpuUsedMiB, 2850);
  assert.equal(r.rawText, '{"outcome":"ABSTAINED"}');
  assert.equal(r.timeToFirstTokenMs, 288);
  assert.equal(r.decodeTokensPerSecond, 58.9);
  assert.equal(r.wallTimeMs, 390);
});

test("a wrong served digest is refused even if Bokahli returned ROUTED", async () => {
  const body = routedBody();
  ((body["result"] as Record<string, unknown>)["servedIdentity"] as Record<string, unknown>)["digest"] =
    `sha256:${"b".repeat(64)}`;
  nextResponse = { status: 200, body };
  const r = await ask();
  assert.equal(r.facts.failure?.reason, "EXACT_DIGEST_MISMATCH");
  assert.equal(r.facts.failure?.attribution, "RUNTIME_PROVIDER");
  assert.equal(r.rawText, "", "nothing from a mis-identified response may be scored");
});

test("a wrong runtime build is refused", async () => {
  const body = routedBody();
  const si = (body["result"] as Record<string, unknown>)["servedIdentity"] as Record<string, unknown>;
  (si["runtime"] as Record<string, unknown>)["build"] = "b99999-other";
  nextResponse = { status: 200, body };
  const r = await ask();
  assert.ok(r.facts.failure);
  assert.equal(r.rawText, "");
});

test("an unattested response is refused", async () => {
  const body = routedBody();
  ((body["result"] as Record<string, unknown>)["servedIdentity"] as Record<string, unknown>)["attested"] = false;
  nextResponse = { status: 200, body };
  const r = await ask();
  assert.equal(r.facts.failure?.reason, "EXACT_NOT_ATTESTED");
  assert.equal(r.rawText, "");
});

// ---------------------------------------------------------------------------
// token provenance
// ---------------------------------------------------------------------------

test("a Phase 1 response yields counts that cannot be called a tokenizer measurement", async () => {
  // The currently deployed Bokahli. It returns counts and publishes no
  // attestation contract, so the counts are recorded, reported, and refused at
  // export — which is exactly what the pilot was built around.
  nextResponse = { status: 200, body: routedBody() };
  const r = await ask();
  assert.equal(r.promptTokens, 120);
  assert.equal(r.completionTokens, 18);
  assert.equal(r.tokenCountSource, "runtime_reported_unknown_tokenizer");
  assert.equal(BOKAHLI_TOKEN_PROVENANCE_FLOOR, "runtime_reported_unknown_tokenizer");
  assert.notEqual(r.tokenCountSource, "runtime_tokenizer");
  assert.equal(r.facts.b2.publishesB2Contract, false, "and it is recognised as legacy, not as failing");
  assert.ok((r.facts.tokenProvenance?.unmet.length ?? 0) > 0, "with reasons, not a bare verdict");
});

test("missing usage yields unknown, not zero and not an estimate", async () => {
  const body = routedBody();
  const t = body["telemetry"] as Record<string, unknown>;
  t["promptTokens"] = null;
  t["completionTokens"] = null;
  nextResponse = { status: 200, body };
  const r = await ask();
  assert.equal(r.promptTokens, null);
  assert.equal(r.tokenCountSource, "unknown");
});

// ---------------------------------------------------------------------------
// failure mapping
// ---------------------------------------------------------------------------

test("the failure map is versioned and attributes nothing to the model", () => {
  assert.match(BOKAHLI_FAILURE_MAP_VERSION, /^bokahli-failure-map-\d+\.\d+\.\d+$/);
  assert.deepEqual(anyModelAttributed(), [],
    "no transport, routing, identity or capacity outcome may be a model failure");
});

test("every mapped outcome names a real local failure code and justifies itself", () => {
  for (const [table, entries] of Object.entries(ALL_MAPS)) {
    for (const [reason, m] of Object.entries(entries as Record<string, { code: string; why: string }>)) {
      assert.ok(LOCAL_FAILURE_MAP[m.code as keyof typeof LOCAL_FAILURE_MAP],
        `${table}.${reason} maps to unknown code ${m.code}`);
      assert.ok(m.why.length > 20, `${table}.${reason} has no justification`);
    }
  }
});

test("every Bokahli typed outcome is mapped, exhaustively", () => {
  // The unions as they exist in Bokahli at 00f1508, read from its source.
  const escalate = ["NO_LOCAL_CANDIDATES", "NO_QUALIFIED_LOCAL_ROUTE", "REQUIREMENTS_UNMET",
    "CONTEXT_EXCEEDS_LOCAL_CAPABILITY", "CAPABILITY_UNSUPPORTED",
    "MODEL_NOT_QUALIFIED_FOR_TASK", "RUNTIME_UNHEALTHY"];
  const refused = ["EXACT_IDENTITY_UNKNOWN", "EXACT_DIGEST_MISMATCH", "EXACT_IDENTITY_NOT_PUBLIC",
    "EXACT_NOT_ATTESTED", "INVALID_ROUTE_SPEC", "CONTEXT_EXCEEDS_SERVED_LIMIT"];
  const capacity = ["GPU_LEASE_HELD_BY_OTHER", "QUEUE_FULL", "QUEUE_TIMEOUT",
    "RUNTIME_UNAVAILABLE", "RUNTIME_NOT_READY"];
  const http = ["UNAUTHORIZED", "BAD_REQUEST", "NOT_FOUND", "METHOD_NOT_ALLOWED",
    "PAYLOAD_TOO_LARGE", "UPSTREAM_UNAVAILABLE", "INTERNAL"];
  for (const [kind, list] of [["ESCALATE", escalate], ["REFUSED", refused],
    ["CAPACITY_UNAVAILABLE", capacity], ["HTTP", http]] as const) {
    for (const reason of list) {
      assert.ok(lookupOutcome(kind, reason), `${kind}/${reason} is unmapped`);
    }
  }
});

test("an unmapped outcome becomes a loud harness failure, never a model failure", async () => {
  nextResponse = {
    status: 200,
    body: { requestId: "r", outcome: "ESCALATE", route: { kind: "ESCALATE", reason: "SOMETHING_NEW" } },
  };
  const r = await ask();
  assert.equal(r.facts.failure?.attribution, "HARNESS_PARSER");
  assert.match(r.facts.failure?.why ?? "", /failure map needs updating/);
});

test("each typed escalation, refusal and capacity outcome round-trips", async () => {
  for (const [kind, reason, status] of [
    ["ESCALATE", "RUNTIME_UNHEALTHY", 200],
    ["ESCALATE", "MODEL_NOT_QUALIFIED_FOR_TASK", 200],
    ["REFUSED", "EXACT_DIGEST_MISMATCH", 409],
    ["CAPACITY_UNAVAILABLE", "QUEUE_FULL", 503],
    ["CAPACITY_UNAVAILABLE", "RUNTIME_NOT_READY", 503],
  ] as const) {
    nextResponse = { status, body: { requestId: "r", outcome: kind, route: { kind, reason } } };
    const r = await ask();
    assert.equal(r.facts.failure?.reason, reason);
    assert.notEqual(r.facts.failure?.attribution, "MODEL", `${reason} must never be a model failure`);
    assert.equal(r.rawText, "");
  }
});

test("an authentication failure is a harness problem, not a model problem", async () => {
  nextResponse = { status: 401, body: { error: { code: "UNAUTHORIZED", message: "authentication required", requestId: "r" } } };
  const r = await ask();
  assert.equal(r.facts.failure?.attribution, "HARNESS_PARSER");
  assert.notEqual(r.facts.failure?.attribution, "MODEL");
});

test("transport errors classify without guessing", () => {
  assert.equal(classifyTransportError(new Error("connect ECONNREFUSED 127.0.0.1:8080"), false), "connection_refused");
  assert.equal(classifyTransportError(new Error("socket hang up ECONNRESET"), false), "connection_reset");
  assert.equal(classifyTransportError(new Error("getaddrinfo ENOTFOUND x"), false), "dns_failure");
  assert.equal(classifyTransportError(new Error("anything"), true), "timeout_before_first_token");
  assert.equal(classifyTransportError(new Error("mystery"), false), "unexpected_close");
});

test("a refused connection is a runtime failure, and the model is untouched", async () => {
  const r = createBokahliResponder({ config: config({ endpoint: "http://127.0.0.1:1" }) });
  const out = (await r(PROMPT)) as BokahliResponse;
  assert.equal(out.facts.failure?.attribution, "RUNTIME_PROVIDER");
  assert.equal(out.runtimeFailure?.code, "crash");
});

// ---------------------------------------------------------------------------
// streaming
// ---------------------------------------------------------------------------

function stream(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(body)); c.close(); },
  });
}
const OPTS = { firstTokenTimeoutMs: 5_000, totalTimeoutMs: 10_000 };

test("a normal stream yields deltas then a routed terminal", async () => {
  const out = await readBokahliStream(stream(
    'event: bokahli.identity\ndata: {"requestId":"r","servedIdentity":{"attested":true}}\n\n' +
    'event: bokahli.delta\ndata: {"text":"hel"}\n\n' +
    'event: bokahli.delta\ndata: {"text":"lo"}\n\n' +
    'event: bokahli.done\ndata: {"requestId":"r","outcome":"ROUTED","result":{"content":"hello"}}\n\n',
  ), OPTS);
  assert.equal(out.text, "hello");
  assert.equal(out.deltaCount, 2);
  assert.equal(out.transportEvent, null);
  assert.ok(out.identity);
});

test("a terminal ESCALATE discards every delta that preceded it", async () => {
  const out = await readBokahliStream(stream(
    'event: bokahli.delta\ndata: {"text":"partial answer that looks fine"}\n\n' +
    'event: bokahli.done\ndata: {"outcome":"ESCALATE","route":{"reason":"RUNTIME_UNHEALTHY"},' +
    '"result":null,"partialTextDiscarded":true}\n\n',
  ), OPTS);
  // The server disowned this text. Scoring it would be grading a fragment
  // Bokahli itself refused to call an answer.
  assert.equal(out.text, "");
  assert.equal(out.discardedText, "partial answer that looks fine");
  assert.equal(out.terminal?.["outcome"], "ESCALATE");
});

test("a malformed frame stops the stream rather than being skipped", async () => {
  const out = await readBokahliStream(stream(
    'event: bokahli.delta\ndata: {"text":"a"}\n\n' +
    "event: bokahli.delta\ndata: {not json\n\n" +
    'event: bokahli.done\ndata: {"outcome":"ROUTED"}\n\n',
  ), OPTS);
  assert.equal(out.transportEvent, "malformed_event");
  assert.equal(out.text, "", "a stream that lost a frame produced no completion");
});

test("a missing terminal event is not a completion", async () => {
  const out = await readBokahliStream(stream(
    'event: bokahli.delta\ndata: {"text":"looks complete but is not"}\n\n',
  ), OPTS);
  assert.equal(out.transportEvent, "missing_terminal_event");
  assert.equal(out.text, "");
  assert.equal(out.discardedText, "looks complete but is not");
});

test("a duplicate terminal event is refused, not allowed to overwrite", async () => {
  const out = await readBokahliStream(stream(
    'event: bokahli.done\ndata: {"outcome":"ESCALATE","route":{"reason":"RUNTIME_UNHEALTHY"}}\n\n' +
    'event: bokahli.done\ndata: {"outcome":"ROUTED","result":{"content":"gotcha"}}\n\n',
  ), OPTS);
  assert.equal(out.transportEvent, "duplicate_terminal_event");
  assert.equal(out.terminal?.["outcome"], "ESCALATE", "the first terminal stands");
  assert.equal(out.text, "");
});

test("a connection that closes mid-stream is not a completion", async () => {
  const broken = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('event: bokahli.delta\ndata: {"text":"half"}\n\n'));
      c.error(new Error("ECONNRESET"));
    },
  });
  const out = await readBokahliStream(broken, OPTS);
  assert.equal(out.transportEvent, "unexpected_close");
  assert.equal(out.text, "");
});

test("timeouts before and during generation are distinguished", async () => {
  let t = 0;
  const never = new ReadableStream<Uint8Array>({ start() { /* nothing, ever */ } });
  const before = await readBokahliStream(never, {
    firstTokenTimeoutMs: 10, totalTimeoutMs: 1_000, now: () => (t += 100),
  });
  assert.equal(before.transportEvent, "timeout_before_first_token");

  let t2 = 0;
  const slow = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new TextEncoder().encode('event: bokahli.delta\ndata: {"text":"a"}\n\n')); },
  });
  const during = await readBokahliStream(slow, {
    firstTokenTimeoutMs: 10_000, totalTimeoutMs: 50, now: () => (t2 += 40),
  });
  assert.equal(during.transportEvent, "timeout_during_generation");
  assert.equal(during.text, "");
});

test("frame parsing handles comments, [DONE], and multi-line data", () => {
  assert.equal(parseFrame(": keepalive"), "skip", "a comment is skipped, not fatal");
  const done = parseFrame("data: [DONE]");
  assert.ok(done !== null && done !== "skip");
  assert.equal(done.event, "openai.done");
  const multi = parseFrame('event: x\ndata: {"a":\ndata: 1}');
  assert.ok(multi !== null && multi !== "skip");
  assert.deepEqual(multi.data, { a: 1 });
  assert.equal(parseFrame("event: x\ndata: nope"), null, "data that will not parse is fatal");
});

// ---------------------------------------------------------------------------
// export refusal on missing provenance
// ---------------------------------------------------------------------------

test("evidence from this responder cannot be exported as qualification today", async () => {
  const { exportBokahliBundle } = await import("../core/local/bokahli-export.js");
  const { scoreAttempt, LOCAL_REGIME_VERSION } = await import("../core/local/regime.js");
  const { LOCAL_IDENTITY_VERSION } = await import("../types/local-identity.js");

  const rec = {
    attemptId: "a1", evidenceTransport: transport(), fixtureId: "tlt-008-abstention-required",
    suiteId: "local-test-log-triage", suiteVersion: "1.0.0",
    split: "evaluation" as const, applicability: "APPLICABLE" as const,
    lanes: [{
      lane: "facts", scorerVersion: "local-scorers-1.0.0" as const,
      measurements: [{ name: "facts.recall", value: 1, unit: "ratio" as const, detail: "" }],
      failureCodes: [], attribution: "MODEL" as const, notes: [],
    }],
    contextPosition: null, contextTier: "control",
    promptTokens: 120, completionTokens: 18,
    // Exactly what the responder reports today.
    tokenCountSource: BOKAHLI_TOKEN_PROVENANCE_FLOOR,
    timeToFirstTokenMs: 288, decodeTokensPerSecond: 58.9, wallTimeMs: 390, seed: 1,
  };
  const result = exportBokahliBundle({
    taskClass: "test_log_triage", taskClassContractVersion: "1.0.0",
    identity: {
      identityVersion: LOCAL_IDENTITY_VERSION,
      artifact: { modelId: MODEL, artifactDigest: DIGEST, quantization: "Q4_K", format: "gguf", sizeBytes: 1, parameterCount: 1, activeParameterCount: null },
      runtime: { name: "llama.cpp", build: BUILD, binaryDigest: null, apiFlavour: "openai-compatible" },
      promptTemplate: { templateId: null, templateDigest: null, appliedBy: "unknown", bosTokenId: null, eosTokenId: null },
      sampler: { temperature: 0, topP: 1, topK: null, repeatPenalty: null, seed: null, seedHonoured: null },
      hardware: { profileId: "mushin", gpuModel: null, gpuMemoryMiB: null, gpuDriver: null, cudaVersion: null, cpuModel: null, systemMemoryMiB: null },
      placement: { requestedGpuLayers: null, observedGpuLayers: null, cpuOffloadEnabled: null, observedVramBytes: null, observedHostRamBytes: null, gpuConfirmed: null },
      context: { configuredTokens: 32768, effectiveMaxTokens: 8000, tierLabel: "control", tokenCountSource: "runtime_tokenizer" },
      concurrency: { slots: 1, maxConcurrentRequests: 1, batchSize: null },
      fixtureSuiteId: "local-test-log-triage", fixtureSuiteVersion: "1.0.0",
      verificationRegimeVersion: LOCAL_REGIME_VERSION,
    },
    records: [rec], scored: [scoreAttempt(rec)],
    luakBundleIds: ["a1"], luakBundleHashes: [], luakSignatureStatus: null,
    luakRepoCommit: null, now: new Date("2026-08-20T12:00:00Z"),
  });

  assert.equal(result.ok, false, "runtime-reported counts without provenance must not export");
  if (result.ok) return;
  const codes = result.refusals.map((r) => r.code);
  assert.ok(codes.includes("TOKEN_COUNTS_NOT_MEASURED"),
    `expected TOKEN_COUNTS_NOT_MEASURED, got ${codes.join(",")}`);
});

// ---------------------------------------------------------------------------
// audit regressions — every one of these was an exploit before remediation
// ---------------------------------------------------------------------------

test("HTTP status, x-bokahli-outcome and body must agree", async () => {
  // The worst pre-remediation defect: a 409 REFUSED carrying a ROUTED body was
  // scored as a real completion — an infrastructure refusal read as an answer.
  for (const [status, header] of [
    [409, "REFUSED"], [503, "CAPACITY_UNAVAILABLE"], [500, "INTERNAL"],
  ] as const) {
    nextResponse = { status, body: routedBody(), headers: { "x-bokahli-outcome": header } };
    const r = await ask();
    assert.ok(r.facts.failure, `HTTP ${status} with a ROUTED body must not be scored`);
    assert.equal(r.rawText, "", "no text from a contradictory response may be scored");
  }
  // Header disagreeing with body, at a plausible status.
  nextResponse = { status: 200, body: routedBody(), headers: { "x-bokahli-outcome": "ESCALATE" } };
  const mixed = await ask();
  assert.ok(mixed.facts.failure);
  assert.equal(mixed.facts.failure?.attribution, "COMPOSITE");
});

test("an agreeing response is still accepted", async () => {
  nextResponse = { status: 200, body: routedBody(), headers: { "x-bokahli-outcome": "ROUTED" } };
  const r = await ask();
  assert.equal(r.facts.failure, null);
  assert.equal(r.rawText, '{"outcome":"ABSTAINED"}');
});

test("an oversized response is refused rather than buffered", async () => {
  const body = routedBody();
  (body["result"] as Record<string, unknown>)["content"] = "x".repeat(2 * 1024 * 1024);
  nextResponse = { status: 200, body };
  const r = await ask();
  assert.ok(r.facts.failure, "a 2 MB completion exceeds the bound");
  assert.equal(r.facts.failure?.reason, "oversized_response");
  assert.equal(r.rawText, "");
});

test("a redirect is refused, never followed", async () => {
  nextResponse = { status: 302, body: {}, headers: { location: "http://127.0.0.1:9/elsewhere" } };
  const r = await ask();
  assert.equal(r.facts.failure?.reason, "redirect_refused");
  assert.equal(r.rawText, "");
});

test("telemetry runtime build must agree with the served identity", async () => {
  const body = routedBody();
  (body["telemetry"] as Record<string, unknown>)["runtimeBuild"] = "b99999-different";
  nextResponse = { status: 200, body };
  const r = await ask();
  assert.ok(r.facts.failure, "two different builds in one response cannot describe one deployment");
  assert.equal(r.rawText, "");
});

test("a symlinked credential is refused before anything is opened", () => {
  const dir = mkdtempSync(join(tmpdir(), "luak-link-"));
  const real = join(dir, "real");
  writeFileSync(real, FAKE_TOKEN);
  chmodSync(real, 0o600);
  const link = join(dir, "link");
  symlinkSync(real, link);
  // The link is 0777; statSync would follow it and report the target's 0600.
  assert.throws(
    () => readCredential(config({ credential: { kind: "file", path: link } })),
    /symlink/,
  );
});

test("the streaming path is a real code path, not a spare module", async () => {
  nextResponse = {
    status: 200, body: {},
    sse:
      'event: bokahli.identity\ndata: {"requestId":"r","servedIdentity":' +
      `{"digest":"${DIGEST}"}}\n\n` +
      'event: bokahli.delta\ndata: {"text":"{\\"outcome\\":"}\n\n' +
      'event: bokahli.delta\ndata: {"text":"\\"ABSTAINED\\"}"}\n\n' +
      'event: bokahli.done\ndata: {"requestId":"r","outcome":"ROUTED","result":' +
      `{"content":"ignored","finishReason":"stop","servedIdentity":{"modelId":"${MODEL}",` +
      `"digest":"${DIGEST}","runtime":{"engine":"llama.cpp","build":"${BUILD}",` +
      '"executableDigest":null,"cuda":null,"driver":null},"servedContextTokens":32768,' +
      '"attested":true,"attestationMethod":"backend-props-match"}},' +
      '"telemetry":{"promptTokens":12,"completionTokens":6,"timeToFirstTokenMs":9,"totalMs":20,' +
      `"completionTokensPerSecond":50,"runtimeBuild":"${BUILD}"}}\n\n`,
  };
  const r = await ask({ stream: true });
  assert.equal(r.facts.failure, null, JSON.stringify(r.facts.failure));
  assert.equal(r.rawText, '{"outcome":"ABSTAINED"}', "deltas, not the terminal content field");
  assert.equal(r.facts.attested, true);
  assert.equal(r.tokenCountSource, BOKAHLI_TOKEN_PROVENANCE_FLOOR);
  const sent = lastRequest?.body as { stream: boolean };
  assert.equal(sent.stream, true);
});

test("a streamed terminal ESCALATE is never scored, whatever arrived first", async () => {
  nextResponse = {
    status: 200, body: {},
    sse:
      'event: bokahli.delta\ndata: {"text":"a confident wrong answer"}\n\n' +
      'event: bokahli.done\ndata: {"outcome":"ESCALATE","route":{"reason":"RUNTIME_UNHEALTHY"},' +
      '"result":null,"partialTextDiscarded":true}\n\n',
  };
  const r = await ask({ stream: true });
  assert.equal(r.facts.failure?.reason, "RUNTIME_UNHEALTHY");
  assert.equal(r.facts.failure?.attribution, "RUNTIME_PROVIDER");
  assert.equal(r.rawText, "");
});

test("a streamed success that also claims discarded text is contradictory", async () => {
  nextResponse = {
    status: 200, body: {},
    sse:
      'event: bokahli.delta\ndata: {"text":"x"}\n\n' +
      'event: bokahli.done\ndata: {"outcome":"ROUTED","partialTextDiscarded":true,' +
      '"result":{"content":"x"}}\n\n',
  };
  const r = await ask({ stream: true });
  assert.equal(r.facts.failure?.reason, "contradictory_outcome");
  assert.equal(r.rawText, "");
});

test("identity and terminal events must report the same digest", async () => {
  nextResponse = {
    status: 200, body: {},
    sse:
      `event: bokahli.identity\ndata: {"servedIdentity":{"digest":"sha256:${"b".repeat(64)}"}}\n\n` +
      'event: bokahli.delta\ndata: {"text":"x"}\n\n' +
      'event: bokahli.done\ndata: {"outcome":"ROUTED","result":{"content":"x","servedIdentity":' +
      `{"modelId":"${MODEL}","digest":"${DIGEST}","runtime":{"build":"${BUILD}"},"attested":true}}}\n\n`,
  };
  const r = await ask({ stream: true });
  assert.equal(r.facts.failure?.reason, "EXACT_DIGEST_MISMATCH");
  assert.equal(r.rawText, "");
});

test("the stream reader survives hostile framing", async () => {
  const cases: [string, string, string | null][] = [
    ["multiple events in one chunk",
      'event: bokahli.delta\ndata: {"text":"a"}\n\nevent: bokahli.delta\ndata: {"text":"b"}\n\n', "missing_terminal_event"],
    ["unknown event type",
      'event: bokahli.mystery\ndata: {"x":1}\n\n', "missing_terminal_event"],
    ["comment/keepalive frames",
      ': keepalive\n\nevent: bokahli.delta\ndata: {"text":"a"}\n\n', "missing_terminal_event"],
    ["delta after terminal",
      'event: bokahli.done\ndata: {"outcome":"ROUTED","result":{"content":"x"}}\n\n' +
      'event: bokahli.delta\ndata: {"text":"late"}\n\n', null],
  ];
  for (const [label, sse, expected] of cases) {
    const out = await readBokahliStream(
      new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(sse)); c.close(); } }),
      { firstTokenTimeoutMs: 5_000, totalTimeoutMs: 10_000 },
    );
    assert.equal(out.transportEvent, expected, label);
  }
});

test("a stream split across arbitrary TCP chunk boundaries still parses", async () => {
  const whole =
    'event: bokahli.delta\ndata: {"text":"hello"}\n\n' +
    'event: bokahli.done\ndata: {"outcome":"ROUTED","result":{"content":"hello"}}\n\n';
  for (const size of [1, 3, 7, 17, 64]) {
    const chunks: Uint8Array[] = [];
    const bytes = new TextEncoder().encode(whole);
    for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.slice(i, i + size));
    const out = await readBokahliStream(
      new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(ch); c.close(); } }),
      { firstTokenTimeoutMs: 5_000, totalTimeoutMs: 10_000 },
    );
    assert.equal(out.text, "hello", `chunk size ${size}`);
    assert.equal(out.transportEvent, null, `chunk size ${size}`);
  }
});
