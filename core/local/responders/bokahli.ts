/**
 * Luak — Bokahli responder.
 *
 * Executes qualification attempts against Bokahli's authenticated local API,
 * over HTTP, as any other client would. It imports nothing from Bokahli and
 * bypasses none of its checks: the network boundary *is* the contract, and a
 * responder that reached around it would be measuring a Bokahli that no caller
 * actually sees.
 *
 * ## Why EXACT, and why `requireQualified: false`
 *
 * A campaign is about one artifact, so the route names it by identity *and*
 * digest and Bokahli refuses any substitution. But the campaign is being run in
 * order to *produce* qualification evidence, so demanding existing
 * qualification would be circular — the first campaign could never run. The
 * responder therefore sets `requireQualified: false` and records on every
 * attempt that this was an authorised qualification attempt rather than a
 * production-qualified route. Both facts travel together, so nothing downstream
 * can read the run as evidence that the model was already qualified.
 *
 * ## What it refuses to accept
 *
 * `attested: true` is mandatory. An unattested response means Bokahli could not
 * verify that the live runtime is serving the named artifact, and evidence
 * gathered then is about an unverified deployment. The served identity is also
 * checked against the configured digest and runtime build on arrival, so a
 * substitution that somehow passed Bokahli's own checks still cannot be scored.
 */
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { BoundaryObservation, LocalPrompt, LocalResponse, Responder } from "../runner.js";
import { toWireEvidence } from "../evidence.js";
import type { TokenCountSource } from "../regime.js";
import {
  protocolPinOf, validateBokahliConfig, type BokahliResponderConfig,
} from "./bokahli-config.js";
import { resolveProtocol, type BokahliProtocolMode } from "./bokahli-protocol.js";
import { authHeaders, readCredential, redact } from "./credentials.js";
import { lookupOutcome, type OutcomeMapping, type TransportEvent } from "./bokahli-failure-map.js";
import { readBokahliStream } from "./bokahli-stream.js";
import {
  emptyB2Facts, extractB2Facts, refusesCanonicalAttempt, type BokahliB2Facts,
} from "./bokahli-b2-facts.js";
import { deriveTokenProvenance, type TokenProvenanceVerdict } from "./bokahli-provenance.js";

/**
 * Read the trust boundary's own account of a request.
 *
 * Everything here is counts, zones and identities. Matched text is never
 * carried: a record of what an injection said is a record of an injection, and
 * evidence bundles are read by people and by other programs.
 *
 * Returns null when the deployment reported nothing, which is different from
 * reporting that it found nothing, and the campaign validity check treats it
 * that way.
 */
function readBoundary(telemetry: unknown): BoundaryObservation | null {
  if (!telemetry || typeof telemetry !== "object") return null;
  const v = (telemetry as Record<string, unknown>)["velum"];
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const engine = (o["engine"] ?? {}) as Record<string, unknown>;
  const rawPackets = Array.isArray(o["packets"]) ? (o["packets"] as unknown[]) : [];
  const str = (x: unknown): string | null => (typeof x === "string" ? x : null);
  return {
    scannedAll: typeof o["scannedAll"] === "boolean" ? (o["scannedAll"] as boolean) : null,
    decision: str(o["decision"]),
    detectorVersion: str(engine["detectorVersion"]),
    registryPayloadSha256: str(engine["registryPayloadSha256"]),
    packets: rawPackets.flatMap((p) => {
      if (!p || typeof p !== "object") return [];
      const q = p as Record<string, unknown>;
      const id = str(q["id"]);
      const zone = str(q["zone"]);
      if (id === null || zone === null) return [];
      return [{
        id,
        zone,
        findingCount: typeof q["findingCount"] === "number" ? (q["findingCount"] as number) : 0,
        peakSeverity: str(q["peakSeverity"]),
        disposition: str(q["disposition"]),
      }];
    }),
  };
}

export const BOKAHLI_RESPONDER_VERSION = "bokahli-responder-2.0.0" as const;

/**
 * Hard limits on what a response may be.
 *
 * The deployment is trusted-ish, but "the server is ours" is not a size bound.
 * A runaway generation, a degenerate loop, or a mis-set max_tokens produces a
 * body that has to be buffered somewhere, and an evaluation harness that can be
 * OOM-ed by the thing it is evaluating is not a harness. Exceeding a limit is a
 * typed harness failure, never a model score.
 */
export const RESPONSE_LIMITS = Object.freeze({
  maxResponseBytes: 8 * 1024 * 1024,
  maxCompletionChars: 1 * 1024 * 1024,
  maxJsonDepth: 64,
});

/**
 * The provenance a response falls back to when it proves nothing.
 *
 * This used to be the *answer*: Bokahli published counts and no statement about
 * which tokenizer produced them, so the responder returned this constant for
 * every attempt. Correct then, and unfalsifiable — a hardcoded verdict cannot
 * improve when the evidence does, and cannot degrade when the evidence goes
 * away either.
 *
 * B2 publishes the proof, so the verdict is now *derived* — see
 * `bokahli-provenance.ts`. The constant survives only as the floor: counts that
 * exist but cannot be attributed. Nothing assigns it unconditionally.
 */
export const BOKAHLI_TOKEN_PROVENANCE_FLOOR: TokenCountSource = "runtime_reported_unknown_tokenizer";

/** What the responder observed, beyond the answer text. */
export interface BokahliAttemptFacts {
  readonly responderVersion: typeof BOKAHLI_RESPONDER_VERSION;
  /** Recorded so no reader can mistake a campaign run for a qualified route. */
  readonly authorizedQualificationAttempt: true;
  readonly requireQualifiedSent: false;
  readonly requestId: string | null;
  readonly outcome: string;
  readonly attested: boolean | null;
  readonly attestationMethod: string | null;
  readonly servedModelId: string | null;
  readonly servedDigest: string | null;
  readonly runtimeEngine: string | null;
  readonly runtimeBuild: string | null;
  /** The same build as reported in telemetry. Cross-checked against the above. */
  readonly telemetryRuntimeBuild: string | null;
  /** Declared by Bokahli's contract but hardcoded null at 00f1508. */
  readonly runtimeExecutableDigest: string | null;
  readonly runtimeCuda: string | null;
  readonly runtimeDriver: string | null;
  readonly servedContextTokens: number | null;
  readonly contextUtilisation: number | null;
  readonly promptTokensPerSecond: number | null;
  readonly completionTokensPerSecond: number | null;
  readonly queueWaitMs: number | null;
  readonly routeMs: number | null;
  /** Whole-GPU snapshot. Not per-process: see the doc on device placement. */
  readonly gpuUsedMiB: number | null;
  readonly gpuTotalMiB: number | null;
  readonly gpuUtilisationPct: number | null;
  /** Sampler as *sent*. Bokahli never echoes what it applied. */
  readonly samplerSent: { temperature: number; topP: number; maxTokens: number };
  /**
   * Prompt-template identity, from Bokahli B2. Null on a Phase 1 response.
   *
   * This is the *configured* template — what the backend holds. It is not a
   * statement that this template rendered this request, and `b2.template`
   * keeps the tiers apart.
   */
  readonly promptTemplateId: string | null;
  /**
   * The B2 attestation, read without flattening. Every field is null on a
   * response that predates it.
   */
  readonly b2: BokahliB2Facts;
  /**
   * The protocol generation this response was accepted as.
   *
   * Declared by configuration and verified against the response, never inferred
   * from which fields happen to be present. Null on any path that did not reach
   * a routed response.
   */
  readonly protocolGeneration: BokahliProtocolMode | null;
  /** Why the counts are provenanced the way they are. */
  readonly tokenProvenance: TokenProvenanceVerdict | null;
  /**
   * Set when Bokahli's own output forbids building a canonical attempt from
   * this response — unattested, instance-unknown, instance-changed. An
   * infrastructure outcome, never a model failure.
   */
  readonly canonicalAttemptRefused: readonly string[];
  readonly failure: (OutcomeMapping & { reason: string; kind: string }) | null;
}

export interface BokahliResponse extends LocalResponse {
  readonly facts: BokahliAttemptFacts;
}

function emptyFacts(config: BokahliResponderConfig): BokahliAttemptFacts {
  return {
    responderVersion: BOKAHLI_RESPONDER_VERSION,
    authorizedQualificationAttempt: true,
    requireQualifiedSent: false,
    requestId: null, outcome: "UNKNOWN", attested: null, attestationMethod: null,
    servedModelId: null, servedDigest: null, runtimeEngine: null, runtimeBuild: null,
    telemetryRuntimeBuild: null,
    runtimeExecutableDigest: null, runtimeCuda: null, runtimeDriver: null,
    servedContextTokens: null, contextUtilisation: null,
    promptTokensPerSecond: null, completionTokensPerSecond: null,
    queueWaitMs: null, routeMs: null,
    gpuUsedMiB: null, gpuTotalMiB: null, gpuUtilisationPct: null,
    samplerSent: { ...config.sampler },
    promptTemplateId: null,
    b2: emptyB2Facts(),
    protocolGeneration: null,
    tokenProvenance: null,
    canonicalAttemptRefused: [],
    failure: null,
  };
}

function fail(
  config: BokahliResponderConfig,
  kind: string,
  reason: string,
  mapping: OutcomeMapping | null,
  detail: string,
): BokahliResponse {
  const m: OutcomeMapping = mapping ?? {
    // An outcome the versioned map does not know is a harness failure, loudly.
    // Defaulting it to a model failure would launder a protocol change into a
    // capability claim; defaulting it to infrastructure would hide one.
    code: "local_harness_parse_failure",
    attribution: "HARNESS_PARSER",
    transient: false,
    why: `unmapped Bokahli outcome ${kind}/${reason}; the failure map needs updating`,
  };
  const rf = runtimeFailureFor(m);
  return {
    rawText: "",
    promptTokens: null, completionTokens: null, tokenCountSource: "unknown",
    timeToFirstTokenMs: null, decodeTokensPerSecond: null, wallTimeMs: null,
    // Spread rather than assigned: under exactOptionalPropertyTypes an explicit
    // `undefined` is not the same as an absent key, and only a genuinely
    // runtime-side failure may put this field on the record at all.
    ...(rf ? { runtimeFailure: rf } : {}),
    facts: {
      ...emptyFacts(config),
      outcome: kind,
      failure: { ...m, reason, kind },
    },
  };
}

/** Only genuinely runtime-side failures become a runtime failure on the record. */
function runtimeFailureFor(m: OutcomeMapping): LocalResponse["runtimeFailure"] {
  if (m.attribution !== "RUNTIME_PROVIDER") return undefined;
  switch (m.code) {
    case "local_timeout_load": return { code: "timeout_load", detail: m.why };
    case "local_timeout_prefill": return { code: "timeout_prefill", detail: m.why };
    case "local_timeout_decode": return { code: "timeout_decode", detail: m.why };
    case "local_resource_exhausted": return { code: "oom", detail: m.why };
    case "local_capacity_refused": return { code: "capacity", detail: m.why };
    default: return { code: "crash", detail: m.why };
  }
}

interface JsonLike {
  requestId?: string;
  outcome?: string;
  route?: { kind?: string; reason?: string; detail?: string };
  result?: {
    content?: string;
    finishReason?: string;
    servedIdentity?: Record<string, unknown>;
  } | null;
  telemetry?: Record<string, unknown>;
  error?: { code?: string; message?: string };
  partialTextDiscarded?: boolean;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Build facts from a successful routed response.
 *
 * Reads only fields Bokahli actually emits at 00f1508. Anything it does not
 * expose stays `null` rather than being derived — a derived value here would be
 * a Luak guess wearing a Bokahli label.
 */
function factsFromRouted(config: BokahliResponderConfig, body: JsonLike): BokahliAttemptFacts {
  const si = (body.result?.servedIdentity ?? {}) as Record<string, unknown>;
  const rt = (si["runtime"] ?? {}) as Record<string, unknown>;
  const t = (body.telemetry ?? {}) as Record<string, unknown>;
  const gpu = (t["gpu"] ?? {}) as Record<string, unknown>;
  // Read from the body rather than from `si`/`t` above: the B2 reader walks the
  // whole response defensively, and a Phase 1 body simply yields nulls.
  const b2 = extractB2Facts(body);
  return {
    ...emptyFacts(config),
    b2,
    promptTemplateId: b2.template.configuredTemplateId,
    requestId: str(body.requestId),
    outcome: str(body.outcome) ?? "ROUTED",
    attested: typeof si["attested"] === "boolean" ? (si["attested"] as boolean) : null,
    attestationMethod: str(si["attestationMethod"]),
    servedModelId: str(si["modelId"]),
    servedDigest: str(si["digest"]),
    runtimeEngine: str(rt["engine"]),
    runtimeBuild: str(rt["build"]),
    telemetryRuntimeBuild: str(t["runtimeBuild"]),
    runtimeExecutableDigest: str(rt["executableDigest"]),
    runtimeCuda: str(rt["cuda"]),
    runtimeDriver: str(rt["driver"]),
    servedContextTokens: num(si["servedContextTokens"]) ?? num(t["servedContextTokens"]),
    contextUtilisation: num(t["contextUtilisation"]),
    promptTokensPerSecond: num(t["promptTokensPerSecond"]),
    completionTokensPerSecond: num(t["completionTokensPerSecond"]),
    queueWaitMs: num(t["queueWaitMs"]),
    routeMs: num(t["routeMs"]),
    gpuUsedMiB: num(gpu["usedMiB"]),
    gpuTotalMiB: num(gpu["totalMiB"]),
    gpuUtilisationPct: num(gpu["utilisationPct"]),
  };
}

/**
 * Check the served identity against what the campaign is about.
 *
 * Belt and braces over Bokahli's own EXACT checks. If a substitution ever got
 * past them, evidence would be attributed to the wrong weights, and that error
 * is silent and permanent. Cheap to check here; impossible to detect later.
 */
function identityProblem(
  config: BokahliResponderConfig,
  f: BokahliAttemptFacts,
): { reason: string; detail: string } | null {
  if (f.attested !== true) {
    return {
      reason: "EXACT_NOT_ATTESTED",
      detail: `served identity reports attested=${String(f.attested)}; evidence from an ` +
        "unattested runtime is about an unverified deployment",
    };
  }
  if (f.servedModelId !== config.modelId) {
    return {
      reason: "EXACT_IDENTITY_UNKNOWN",
      detail: `served modelId "${f.servedModelId}" is not the configured "${config.modelId}"`,
    };
  }
  if (f.servedDigest !== config.artifactDigest) {
    return {
      reason: "EXACT_DIGEST_MISMATCH",
      detail: `served digest ${f.servedDigest} is not the configured ${config.artifactDigest}`,
    };
  }
  if (f.runtimeBuild !== config.expectedRuntimeBuild) {
    return {
      reason: "EXACT_NOT_ATTESTED",
      detail: `served runtime build "${f.runtimeBuild}" is not the expected ` +
        `"${config.expectedRuntimeBuild}"; a build change invalidates the evidence`,
    };
  }
  // Bokahli reports the build twice — on the served identity and in telemetry.
  // They come from the same probe, so a disagreement means the response was
  // assembled from two different runs or edited in transit. Either way the
  // attempt cannot be attributed to one deployment.
  if (f.telemetryRuntimeBuild !== null && f.telemetryRuntimeBuild !== f.runtimeBuild) {
    return {
      reason: "EXACT_NOT_ATTESTED",
      detail: `servedIdentity.runtime.build "${f.runtimeBuild}" disagrees with ` +
        `telemetry.runtimeBuild "${f.telemetryRuntimeBuild}"`,
    };
  }
  return null;
}

/** Depth of a parsed JSON value, bounded so the walk itself cannot blow up. */
function jsonDepth(v: unknown, depth = 0): number {
  if (depth > RESPONSE_LIMITS.maxJsonDepth + 1) return depth;
  if (v === null || typeof v !== "object") return depth;
  let worst = depth;
  for (const child of Object.values(v as Record<string, unknown>)) {
    worst = Math.max(worst, jsonDepth(child, depth + 1));
    if (worst > RESPONSE_LIMITS.maxJsonDepth + 1) return worst;
  }
  return worst;
}

/** Read a body, giving up rather than buffering without limit. */
async function readBounded(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return await res.text().catch(() => "");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) return null;
      out += decoder.decode(value, { stream: true });
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock?.();
  }
  return out;
}

/**
 * Whether HTTP status, header and body tell the same story.
 *
 * Bokahli's mapping, from its own source: ESCALATE → 200, REFUSED → 409,
 * CAPACITY_UNAVAILABLE → 503, ROUTED → 200. Anything else is a contradiction.
 */
function outcomeDisagreement(
  status: number,
  headerOutcome: string | null,
  bodyOutcome: string | null,
  parsed: JsonLike,
): string | null {
  if (parsed.error?.code) return null; // error envelope: handled separately
  if (headerOutcome && bodyOutcome && headerOutcome !== bodyOutcome) {
    return `x-bokahli-outcome "${headerOutcome}" disagrees with body outcome "${bodyOutcome}"`;
  }
  const claimed = bodyOutcome ?? headerOutcome;
  if (!claimed) return `HTTP ${status} response states no outcome`;
  const expected: Record<string, number[]> = {
    ROUTED: [200], ESCALATE: [200], REFUSED: [409], CAPACITY_UNAVAILABLE: [503],
  };
  const allowed = expected[claimed];
  if (!allowed) return null; // unknown kind: the failure map reports it loudly
  if (!allowed.includes(status)) {
    return `outcome "${claimed}" arrived with HTTP ${status}; Bokahli sends ` +
      `${allowed.join("/")} for that outcome`;
  }
  return null;
}

export interface BokahliResponderOptions {
  readonly config: BokahliResponderConfig;
  /** Injected for tests. Defaults to global fetch. */
  readonly fetchImpl?: typeof fetch;
  /** Injected for tests so timeouts are deterministic. */
  readonly now?: () => number;
}

/**
 * Build the responder.
 *
 * Returns a function the runner calls once per attempt, sequentially. There is
 * no concurrency here on purpose: Bokahli serves one active request, and
 * overlapping calls would turn queue behaviour into apparent model latency.
 */
export function createBokahliResponder(opts: BokahliResponderOptions): Responder & {
  readonly version: typeof BOKAHLI_RESPONDER_VERSION;
} {
  const validated = validateBokahliConfig(opts.config);
  if (!validated.ok) {
    throw new Error(
      "invalid Bokahli responder config:\n" +
        validated.problems.map((p) => `  ${p.field}: ${p.detail}`).join("\n"),
    );
  }
  const config = validated.config;
  const doFetch = opts.fetchImpl ?? fetch;
  const clock = opts.now ?? (() => Date.now());

  const responder = async (prompt: LocalPrompt): Promise<BokahliResponse> => {
    // Read the credential per request and hold it in a local. Nothing that
    // outlives this function ever sees it.
    let token: string;
    try {
      token = readCredential(config);
    } catch (err) {
      return fail(config, "HTTP", "UNAUTHORIZED", lookupOutcome("HTTP", "UNAUTHORIZED"),
        redact((err as Error).message));
    }

    const body = {
      route: {
        mode: "EXACT",
        modelId: config.modelId,
        artifactDigest: config.artifactDigest,
        // Deliberately false: a campaign produces qualification evidence and
        // cannot presuppose it.
        requireQualified: false,
      },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      // The correction. Untrusted fixture material travels here and only here,
      // so Bokahli assigns it the untrusted-evidence zone and fences it. Before
      // this, the log was interpolated into the `user` message above, which
      // made it the caller's own speech: Velum saw the injection, correctly
      // declined to fence a trusted principal's instruction, and the campaign
      // measured a boundary it had never invoked.
      evidence: toWireEvidence(prompt.evidence),
      maxTokens: config.sampler.maxTokens,
      temperature: config.sampler.temperature,
      topP: config.sampler.topP,
      stream: config.stream === true,
    };

    const started = clock();
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), config.requestTimeoutMs);

    let res: Response;
    try {
      res = await doFetch(`${config.endpoint}/v1/bokahli/chat`, {
        method: "POST",
        headers: authHeaders(token),
        body: JSON.stringify(body),
        signal: controller.signal,
        // Never follow a redirect. A 3xx can move the request to another host,
        // and even where the Authorization header is dropped, silently
        // measuring a different endpoint than the one configured is worse than
        // failing. The campaign names exactly one deployment.
        redirect: "manual",
      });
    } catch (err) {
      globalThis.clearTimeout(timer);
      const event = classifyTransportError(err as Error, controller.signal.aborted);
      return fail(config, "TRANSPORT", event, lookupOutcome("TRANSPORT", event),
        redact((err as Error).message));
    } finally {
      globalThis.clearTimeout(timer);
    }

    const declaredLength = Number(res.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_LIMITS.maxResponseBytes) {
      return fail(config, "TRANSPORT", "oversized_response",
        lookupOutcome("TRANSPORT", "oversized_response"),
        `content-length ${declaredLength} exceeds ${RESPONSE_LIMITS.maxResponseBytes}`);
    }

    if (config.stream === true && res.status === 200 && res.body) {
      return await consumeStream(config, res, clock, started);
    }

    if (res.status >= 300 && res.status < 400) {
      return fail(config, "TRANSPORT", "redirect_refused",
        lookupOutcome("TRANSPORT", "redirect_refused"),
        `HTTP ${res.status} redirect to ${res.headers.get("location") ?? "(no location)"}`);
    }

    const text = await readBounded(res, RESPONSE_LIMITS.maxResponseBytes);
    if (text === null) {
      return fail(config, "TRANSPORT", "oversized_response",
        lookupOutcome("TRANSPORT", "oversized_response"),
        `response body exceeded ${RESPONSE_LIMITS.maxResponseBytes} bytes`);
    }

    let parsed: JsonLike;
    try {
      parsed = JSON.parse(text) as JsonLike;
    } catch {
      return fail(config, "TRANSPORT", "malformed_event",
        lookupOutcome("TRANSPORT", "malformed_event"),
        `HTTP ${res.status} body was not JSON`);
    }
    if (jsonDepth(parsed) > RESPONSE_LIMITS.maxJsonDepth) {
      return fail(config, "TRANSPORT", "malformed_event",
        lookupOutcome("TRANSPORT", "malformed_event"),
        `response nesting exceeded ${RESPONSE_LIMITS.maxJsonDepth} levels`);
    }

    // The three channels must agree before anything is scored.
    //
    // Bokahli states its outcome three times — HTTP status, the
    // x-bokahli-outcome header, and the body — and a disagreement means one of
    // them is lying or a proxy rewrote the exchange. Trusting the body alone
    // let a 409 REFUSED carrying a ROUTED body be scored as a real completion,
    // which is the worst available failure: a refusal read as an answer.
    const headerOutcome = res.headers.get("x-bokahli-outcome");
    const bodyOutcome = parsed.route?.kind ?? parsed.outcome ?? null;
    const disagreement = outcomeDisagreement(res.status, headerOutcome, bodyOutcome, parsed);
    if (disagreement) {
      return fail(config, "TRANSPORT", "contradictory_outcome",
        lookupOutcome("TRANSPORT", "contradictory_outcome"), disagreement);
    }

    // Error envelope: {error:{code,message,requestId}}
    if (parsed.error?.code) {
      return fail(config, "HTTP", parsed.error.code,
        lookupOutcome("HTTP", parsed.error.code), redact(parsed.error.message ?? ""));
    }

    const kind = parsed.route?.kind ?? parsed.outcome ?? "UNKNOWN";
    if (kind !== "ROUTED") {
      const reason = parsed.route?.reason ?? "UNKNOWN";
      return fail(config, kind, reason, lookupOutcome(
        kind as "ESCALATE" | "REFUSED" | "CAPACITY_UNAVAILABLE", reason,
      ), redact(parsed.route?.detail ?? ""));
    }

    const facts = factsFromRouted(config, parsed);
    const problem = identityProblem(config, facts);
    if (problem) {
      return fail(config, "REFUSED", problem.reason,
        lookupOutcome("REFUSED", problem.reason), problem.detail);
    }

    // Which protocol is this? Declared, not inferred.
    //
    // Before this gate, deleting two fields from a real B2 response moved it
    // onto the legacy path and turned an attempt that must be discarded into
    // one that is kept. A stripped response is a protocol failure.
    const pin = protocolPinOf(config);
    const protocol = resolveProtocol(parsed, pin);
    if (!protocol.ok) {
      return fail(config, "TRANSPORT", "protocol_mismatch",
        lookupOutcome("TRANSPORT", "protocol_mismatch"), protocol.problems.join("; "));
    }

    // Bokahli says a completion happened. Whether it can be attributed is a
    // separate question, and one this responder must answer before scoring:
    // an unattested or discontinuous attempt is an infrastructure event, and
    // counting it against the model would score a restart as a wrong answer.
    const canonical = refusesCanonicalAttempt(facts.b2, facts.attested, protocol.generation);
    if (canonical.refuse) {
      return fail(config, "ESCALATE", "ATTEMPT_NOT_ATTRIBUTABLE",
        lookupOutcome("ESCALATE", "ATTEMPT_NOT_ATTRIBUTABLE"),
        canonical.reasons.join("; "));
    }

    const t = (parsed.telemetry ?? {}) as Record<string, unknown>;
    const promptTokens = num(t["promptTokens"]);
    const completionTokens = num(t["completionTokens"]);

    const content = parsed.result?.content ?? "";
    if (content.length > RESPONSE_LIMITS.maxCompletionChars) {
      return fail(config, "TRANSPORT", "oversized_response",
        lookupOutcome("TRANSPORT", "oversized_response"),
        `completion of ${content.length} characters exceeds ${RESPONSE_LIMITS.maxCompletionChars}`);
    }

    // Derived from what the response proves, not asserted. A body that labels
    // its own counts `runtime_tokenizer` without the supporting object gets the
    // floor, exactly as one that says nothing does.
    const provenance = deriveTokenProvenance({
      body: parsed,
      expectedModelId: config.modelId,
      expectedArtifactDigest: config.artifactDigest,
      expectedContractVersion: pin.expectedContractVersion,
      protocolGeneration: protocol.generation,
      // The exact bytes, so the verdict cannot be re-sealed onto a doctored
      // record without also doctoring the response it claims to describe.
      rawResponseSha256: `sha256:${createHash("sha256").update(text).digest("hex")}`,
    });

    return {
      rawText: content,
      boundary: readBoundary(parsed["telemetry"]),
      promptTokens,
      completionTokens,
      tokenCountSource: provenance.source,
      timeToFirstTokenMs: num(t["timeToFirstTokenMs"]),
      decodeTokensPerSecond: num(t["completionTokensPerSecond"]),
      wallTimeMs: num(t["totalMs"]) ?? clock() - started,
      facts: {
        ...facts,
        protocolGeneration: protocol.generation,
        tokenProvenance: provenance,
        canonicalAttemptRefused: [],
      },
    };
  };

  return Object.assign(responder, { version: BOKAHLI_RESPONDER_VERSION });
}

/**
 * Consume the SSE path.
 *
 * Everything the buffered path checks is checked here too — identity, digest,
 * runtime build, attestation — because a stream is not a weaker contract, only
 * a different transport. Text that arrived before a non-ROUTED terminal is
 * already discarded by the reader and never reaches this function.
 */
async function consumeStream(
  config: BokahliResponderConfig,
  res: Response,
  clock: () => number,
  started: number,
): Promise<BokahliResponse> {
  const out = await readBokahliStream(res.body as ReadableStream<Uint8Array>, {
    firstTokenTimeoutMs: config.firstTokenTimeoutMs,
    totalTimeoutMs: config.requestTimeoutMs,
    now: clock,
  });

  if (out.transportEvent) {
    return fail(config, "TRANSPORT", out.transportEvent,
      lookupOutcome("TRANSPORT", out.transportEvent),
      `stream ended on ${out.transportEvent} after ${out.deltaCount} delta(s)`);
  }
  const terminal = out.terminal as JsonLike | null;
  if (!terminal) {
    return fail(config, "TRANSPORT", "missing_terminal_event",
      lookupOutcome("TRANSPORT", "missing_terminal_event"), "no terminal event");
  }
  // The buffered path bounds nesting; the streamed one did not, so a terminal
  // frame could carry arbitrarily deep JSON into every reader downstream.
  if (jsonDepth(terminal) > RESPONSE_LIMITS.maxJsonDepth) {
    return fail(config, "TRANSPORT", "malformed_event",
      lookupOutcome("TRANSPORT", "malformed_event"),
      `terminal event nesting exceeded ${RESPONSE_LIMITS.maxJsonDepth} levels`);
  }
  if (terminal.outcome !== "ROUTED") {
    const reason = terminal.route?.reason ?? "UNKNOWN";
    const kind = terminal.outcome ?? "UNKNOWN";
    return fail(config, kind, reason, lookupOutcome(
      kind as "ESCALATE" | "REFUSED" | "CAPACITY_UNAVAILABLE", reason,
    ), redact(terminal.route?.detail ?? ""));
  }
  // A success that also claims text was discarded is self-contradictory, and
  // the safe reading is the pessimistic one.
  if (terminal.partialTextDiscarded === true) {
    return fail(config, "TRANSPORT", "contradictory_outcome",
      lookupOutcome("TRANSPORT", "contradictory_outcome"),
      "terminal claims ROUTED and partialTextDiscarded together");
  }

  // The identity event and the terminal event must describe one deployment.
  const identityServed = (out.identity?.["servedIdentity"] ?? null) as Record<string, unknown> | null;
  // `?? null` rather than leaving it undefined: under exactOptionalPropertyTypes
  // an absent key and an explicit undefined are different types, and "no result"
  // should be one thing, not two.
  const mergedResult: JsonLike["result"] =
    terminal.result ?? (identityServed ? { servedIdentity: identityServed } : null);
  const merged: JsonLike = { ...terminal, result: mergedResult };
  if (identityServed && terminal.result?.servedIdentity) {
    const a = identityServed["digest"];
    const b = terminal.result.servedIdentity["digest"];
    if (a !== b) {
      return fail(config, "REFUSED", "EXACT_DIGEST_MISMATCH",
        lookupOutcome("REFUSED", "EXACT_DIGEST_MISMATCH"),
        "the identity event and the terminal event report different digests");
    }
  }

  const facts = factsFromRouted(config, merged);
  const problem = identityProblem(config, facts);
  if (problem) {
    return fail(config, "REFUSED", problem.reason,
      lookupOutcome("REFUSED", problem.reason), problem.detail);
  }
  if (out.text.length > RESPONSE_LIMITS.maxCompletionChars) {
    return fail(config, "TRANSPORT", "oversized_response",
      lookupOutcome("TRANSPORT", "oversized_response"),
      `streamed completion of ${out.text.length} characters exceeds the bound`);
  }

  // A stream is not a weaker contract, only a different transport: the protocol
  // gate and the attribution rule apply to the terminal event it produced.
  const pin = protocolPinOf(config);
  const protocol = resolveProtocol(merged, pin);
  if (!protocol.ok) {
    return fail(config, "TRANSPORT", "protocol_mismatch",
      lookupOutcome("TRANSPORT", "protocol_mismatch"), protocol.problems.join("; "));
  }

  const canonical = refusesCanonicalAttempt(facts.b2, facts.attested, protocol.generation);
  if (canonical.refuse) {
    return fail(config, "ESCALATE", "ATTEMPT_NOT_ATTRIBUTABLE",
      lookupOutcome("ESCALATE", "ATTEMPT_NOT_ATTRIBUTABLE"),
      canonical.reasons.join("; "));
  }

  const t = (merged.telemetry ?? {}) as Record<string, unknown>;
  const promptTokens = num(t["promptTokens"]);
  const completionTokens = num(t["completionTokens"]);
  const provenance = deriveTokenProvenance({
    body: merged,
    expectedModelId: config.modelId,
    expectedArtifactDigest: config.artifactDigest,
    expectedContractVersion: pin.expectedContractVersion,
    protocolGeneration: protocol.generation,
    // The terminal event as received. A stream has no single body, so the
    // terminal frame is what the seal binds to.
    rawResponseSha256: `sha256:${createHash("sha256")
      .update(JSON.stringify(terminal))
      .digest("hex")}`,
  });
  return {
    rawText: out.text,
    boundary: readBoundary((terminal as Record<string, unknown>)["telemetry"]),
    promptTokens,
    completionTokens,
    tokenCountSource: provenance.source,
    timeToFirstTokenMs: num(t["timeToFirstTokenMs"]),
    decodeTokensPerSecond: num(t["completionTokensPerSecond"]),
    wallTimeMs: num(t["totalMs"]) ?? clock() - started,
    facts: {
      ...facts,
      protocolGeneration: protocol.generation,
      tokenProvenance: provenance,
      canonicalAttemptRefused: [],
    },
  };
}

/** Classify a transport error without letting an unfamiliar one become a model result. */
export function classifyTransportError(err: Error, aborted: boolean): TransportEvent {
  if (aborted) return "timeout_before_first_token";
  const s = `${err.name} ${err.message} ${(err as { code?: string }).code ?? ""}`.toLowerCase();
  if (s.includes("econnrefused")) return "connection_refused";
  if (s.includes("econnreset")) return "connection_reset";
  if (s.includes("enotfound") || s.includes("eai_again")) return "dns_failure";
  if (s.includes("cert") || s.includes("tls") || s.includes("ssl")) return "tls_error";
  if (s.includes("timeout") || s.includes("etimedout")) return "timeout_during_generation";
  return "unexpected_close";
}

/** Re-exported so a caller can await between attempts without importing timers. */
export { delay };
