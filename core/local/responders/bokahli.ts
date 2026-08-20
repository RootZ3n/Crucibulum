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
import { setTimeout as delay } from "node:timers/promises";
import type { LocalPrompt, LocalResponse, Responder } from "../runner.js";
import type { TokenCountSource } from "../regime.js";
import { validateBokahliConfig, type BokahliResponderConfig } from "./bokahli-config.js";
import { authHeaders, readCredential, redact } from "./credentials.js";
import { lookupOutcome, type OutcomeMapping, type TransportEvent } from "./bokahli-failure-map.js";

export const BOKAHLI_RESPONDER_VERSION = "bokahli-responder-1.0.0" as const;

/**
 * Tokenizer provenance for counts Bokahli returns.
 *
 * Bokahli's `RequestTelemetry` carries `promptTokens` and `completionTokens`
 * but **no field stating which tokenizer produced them**. They originate in
 * llama.cpp's own `usage`/`timings` block and are almost certainly exact — but
 * "almost certainly" is not provenance, and the rule is that a count may only
 * be called a runtime-tokenizer measurement when the runtime says so.
 *
 * So the responder reports `runtime_reported_unknown_tokenizer`. The campaign
 * runs, the counts are recorded and usable for analysis, and the exporter
 * refuses a qualification export with a typed reason. Closing this needs one
 * field on Bokahli's side; see docs/local/BOKAHLI-RESPONDER.md.
 */
export const BOKAHLI_TOKEN_PROVENANCE: TokenCountSource = "runtime_reported_unknown_tokenizer";

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
  /** Bokahli exposes no prompt-template identity at this commit. */
  readonly promptTemplateId: null;
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
    runtimeExecutableDigest: null, runtimeCuda: null, runtimeDriver: null,
    servedContextTokens: null, contextUtilisation: null,
    promptTokensPerSecond: null, completionTokensPerSecond: null,
    queueWaitMs: null, routeMs: null,
    gpuUsedMiB: null, gpuTotalMiB: null, gpuUtilisationPct: null,
    samplerSent: { ...config.sampler },
    promptTemplateId: null,
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
  return {
    ...emptyFacts(config),
    requestId: str(body.requestId),
    outcome: str(body.outcome) ?? "ROUTED",
    attested: typeof si["attested"] === "boolean" ? (si["attested"] as boolean) : null,
    attestationMethod: str(si["attestationMethod"]),
    servedModelId: str(si["modelId"]),
    servedDigest: str(si["digest"]),
    runtimeEngine: str(rt["engine"]),
    runtimeBuild: str(rt["build"]),
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
      maxTokens: config.sampler.maxTokens,
      temperature: config.sampler.temperature,
      topP: config.sampler.topP,
      stream: false,
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
      });
    } catch (err) {
      globalThis.clearTimeout(timer);
      const event = classifyTransportError(err as Error, controller.signal.aborted);
      return fail(config, "TRANSPORT", event, lookupOutcome("TRANSPORT", event),
        redact((err as Error).message));
    } finally {
      globalThis.clearTimeout(timer);
    }

    const text = await res.text().catch(() => "");
    let parsed: JsonLike;
    try {
      parsed = JSON.parse(text) as JsonLike;
    } catch {
      return fail(config, "TRANSPORT", "malformed_event",
        lookupOutcome("TRANSPORT", "malformed_event"),
        `HTTP ${res.status} body was not JSON`);
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

    const t = (parsed.telemetry ?? {}) as Record<string, unknown>;
    const promptTokens = num(t["promptTokens"]);
    const completionTokens = num(t["completionTokens"]);

    return {
      rawText: parsed.result?.content ?? "",
      promptTokens,
      completionTokens,
      // Never upgraded on the basis of the counts looking plausible.
      tokenCountSource:
        promptTokens === null && completionTokens === null ? "unknown" : BOKAHLI_TOKEN_PROVENANCE,
      timeToFirstTokenMs: num(t["timeToFirstTokenMs"]),
      decodeTokensPerSecond: num(t["completionTokensPerSecond"]),
      wallTimeMs: num(t["totalMs"]) ?? clock() - started,
      facts,
    };
  };

  return Object.assign(responder, { version: BOKAHLI_RESPONDER_VERSION });
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
