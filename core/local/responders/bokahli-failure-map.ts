/**
 * Luak — Bokahli outcome → local failure mapping.
 *
 * Every way a Bokahli request can end, mapped explicitly to a local failure
 * code and an attribution class. Versioned, exhaustive, and covered by a test
 * that walks each union member — because the single most valuable property of
 * this table is that nothing falls through it into a default.
 *
 * The governing rule: **nothing here is ever attributed to the model.** Every
 * outcome in this file is a routing, transport, identity, capacity, or harness
 * event that happened *instead of* the model answering. Model quality is only
 * measurable after a successful attested response, and it is measured by the
 * scorers, not here. A benchmark that counts an expired token or a full queue
 * as a wrong answer is measuring its own plumbing.
 */
import type { AttributionClass, LocalFailureCode } from "../../../types/local-verdict.js";

export const BOKAHLI_FAILURE_MAP_VERSION = "bokahli-failure-map-1.1.0" as const;

export interface OutcomeMapping {
  readonly code: LocalFailureCode;
  readonly attribution: AttributionClass;
  /** True when a retry against the same deployment could plausibly succeed. */
  readonly transient: boolean;
  readonly why: string;
}

/** Bokahli `ESCALATE` reasons — `RouteOutcome.kind === "ESCALATE"`, HTTP 200. */
export const ESCALATE_MAP: Readonly<Record<string, OutcomeMapping>> = Object.freeze({
  NO_LOCAL_CANDIDATES: {
    code: "local_wrong_served_artifact", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "Bokahli has no installed artifact at all. The campaign is pointed at a deployment " +
      "that cannot serve the model under test.",
  },
  NO_QUALIFIED_LOCAL_ROUTE: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "Qualification was demanded and nothing holds it. During a campaign this should be " +
      "unreachable, because the responder sets requireQualified false — demanding existing " +
      "qualification in order to produce qualification evidence is circular.",
  },
  REQUIREMENTS_UNMET: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "A PROFILE constraint went unmet. Not reachable from an EXACT campaign request.",
  },
  CONTEXT_EXCEEDS_LOCAL_CAPABILITY: {
    code: "local_context_overflow", attribution: "HARNESS_PARSER", transient: false,
    why: "The prompt was larger than any installed artifact can serve. The harness chose the " +
      "tier, so this is a campaign configuration error and not a model result.",
  },
  CAPABILITY_UNSUPPORTED: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "The deployment does not support what was asked for.",
  },
  MODEL_NOT_QUALIFIED_FOR_TASK: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "Bokahli refused for want of qualification. Reaching this during a campaign means " +
      "requireQualified was set, which the responder forbids.",
  },
  RUNTIME_UNHEALTHY: {
    code: "local_runtime_crash", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "llama-server was not answering. Bokahli stayed up and said so; the model never ran.",
  },
});

/** Bokahli `REFUSED` reasons — HTTP 409. */
export const REFUSED_MAP: Readonly<Record<string, OutcomeMapping>> = Object.freeze({
  EXACT_IDENTITY_UNKNOWN: {
    code: "local_wrong_served_artifact", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "The configured modelId is not installed on this deployment. An identity error, " +
      "not a quality one.",
  },
  EXACT_DIGEST_MISMATCH: {
    code: "local_wrong_served_artifact", attribution: "RUNTIME_PROVIDER", transient: false,
    why: "The installed artifact under that identity has a different digest. The campaign " +
      "would have measured a different set of weights; voiding it is the correct outcome.",
  },
  EXACT_IDENTITY_NOT_PUBLIC: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "A path was sent as a model identity. The responder built the request, so this is " +
      "Luak's fault and is attributed accordingly.",
  },
  EXACT_NOT_ATTESTED: {
    code: "local_wrong_served_artifact", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Bokahli could not attest that the live runtime is serving the named artifact. " +
      "Evidence taken here would be about an unverified deployment.",
  },
  INVALID_ROUTE_SPEC: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "Malformed request from this responder.",
  },
  CONTEXT_EXCEEDS_SERVED_LIMIT: {
    code: "local_context_overflow", attribution: "HARNESS_PARSER", transient: false,
    why: "The prompt exceeded the served context. The tier was the harness's choice.",
  },
});

/** Bokahli `CAPACITY_UNAVAILABLE` reasons — HTTP 503. */
export const CAPACITY_MAP: Readonly<Record<string, OutcomeMapping>> = Object.freeze({
  GPU_LEASE_HELD_BY_OTHER: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Another process holds the GPU. Retry when it releases; nothing about the model.",
  },
  QUEUE_FULL: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Admission queue full. The responder runs one request at a time, so this means " +
      "something else is driving the deployment concurrently.",
  },
  QUEUE_TIMEOUT: {
    code: "local_capacity_refused", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Queued past the admission timeout without starting.",
  },
  RUNTIME_UNAVAILABLE: {
    code: "local_runtime_crash", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "The backend was down when the request arrived.",
  },
  RUNTIME_NOT_READY: {
    code: "local_timeout_load", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "The runtime was still loading. Distinguished from a crash because the operator " +
      "response is to wait rather than to investigate.",
  },
});

/** Bokahli error-envelope codes, by HTTP status. */
export const HTTP_ERROR_MAP: Readonly<Record<string, OutcomeMapping>> = Object.freeze({
  UNAUTHORIZED: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "Authentication failed. A credential problem is a campaign-configuration problem; " +
      "counting it against the model would be absurd, and easy to do by accident.",
  },
  BAD_REQUEST: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "Bokahli rejected the request shape. The responder built it.",
  },
  NOT_FOUND: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "Wrong route. A configuration error.",
  },
  METHOD_NOT_ALLOWED: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "Wrong method. A configuration error.",
  },
  PAYLOAD_TOO_LARGE: {
    code: "local_context_overflow", attribution: "HARNESS_PARSER", transient: false,
    why: "The prompt exceeded Bokahli's request-size limit. The harness chose the fixture " +
      "and the tier.",
  },
  UPSTREAM_UNAVAILABLE: {
    code: "local_runtime_crash", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Bokahli could not reach its backend.",
  },
  INTERNAL: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: true,
    why: "Bokahli raised an internal error. Not the model's doing, and worth surfacing " +
      "rather than folding into a generic failure.",
  },
});

/** Transport-level events, below the application protocol. */
export type TransportEvent =
  | "connection_refused"
  | "connection_reset"
  | "dns_failure"
  | "tls_error"
  | "timeout_before_first_token"
  | "timeout_during_generation"
  | "malformed_event"
  | "missing_terminal_event"
  | "duplicate_terminal_event"
  | "unexpected_close"
  | "oversized_response"
  | "redirect_refused"
  | "contradictory_outcome";

export const TRANSPORT_MAP: Readonly<Record<TransportEvent, OutcomeMapping>> = Object.freeze({
  connection_refused: {
    code: "local_runtime_crash", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Nothing listening. Bokahli is down, which is a deployment fact.",
  },
  connection_reset: {
    code: "local_runtime_crash", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "The connection dropped mid-request.",
  },
  dns_failure: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "The configured endpoint does not resolve. A configuration error.",
  },
  tls_error: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "TLS negotiation failed. A configuration error.",
  },
  timeout_before_first_token: {
    code: "local_timeout_prefill", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "No first token within the deadline: prompt processing did not finish. Separated " +
      "from a decode timeout because the operator fix differs — context size and batching, " +
      "not throughput.",
  },
  timeout_during_generation: {
    code: "local_timeout_decode", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "Generation stalled after the first token.",
  },
  malformed_event: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "An SSE frame this client could not parse. Attributed to the harness rather than " +
      "to the model: whether Bokahli emitted something odd or this parser is too strict is " +
      "not decidable here, and guessing in the model's disfavour is how a benchmark quietly " +
      "measures its own client.",
  },
  missing_terminal_event: {
    code: "local_truncated_completion", attribution: "HARNESS_PARSER", transient: true,
    why: "The stream ended without bokahli.done. Whatever text arrived is not a completion " +
      "and must never be scored as one.",
  },
  duplicate_terminal_event: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "Two terminal events. The protocol allows exactly one; the second is refused rather " +
      "than allowed to overwrite the first.",
  },
  unexpected_close: {
    code: "local_runtime_crash", attribution: "RUNTIME_PROVIDER", transient: true,
    why: "The socket closed before the response completed.",
  },
  oversized_response: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "The response exceeded a hard bound. Attributed to the harness rather than the model " +
      "because the bound is Luak's choice — but recorded rather than truncated, since a " +
      "silently cut completion scored as an answer is exactly what must not happen.",
  },
  redirect_refused: {
    code: "local_harness_parse_failure", attribution: "HARNESS_PARSER", transient: false,
    why: "A 3xx was returned and refused. A campaign names one deployment; measuring whatever " +
      "a redirect points at would be measuring something else under the same evidence key.",
  },
  contradictory_outcome: {
    code: "local_harness_parse_failure", attribution: "COMPOSITE", transient: false,
    why: "HTTP status, x-bokahli-outcome and the body disagreed. COMPOSITE because it cannot " +
      "be told from here whether the server, a proxy, or this client is wrong — and a 409 " +
      "refusal carrying a ROUTED body must never be readable as a completion.",
  },
});

/** Every mapping in one place, for the exhaustiveness test and for audit. */
export const ALL_MAPS = Object.freeze({
  escalate: ESCALATE_MAP,
  refused: REFUSED_MAP,
  capacity: CAPACITY_MAP,
  http: HTTP_ERROR_MAP,
  transport: TRANSPORT_MAP,
});

/**
 * Look up an outcome, refusing to invent one.
 *
 * A reason this table does not know is `null`, and the caller turns that into a
 * loud harness failure. Defaulting an unrecognised outcome to "model failure"
 * would be the exact laundering the whole taxonomy exists to prevent, and
 * defaulting it to "infrastructure" would hide a real protocol change.
 */
export function lookupOutcome(
  kind: "ESCALATE" | "REFUSED" | "CAPACITY_UNAVAILABLE" | "HTTP" | "TRANSPORT",
  reason: string,
): OutcomeMapping | null {
  const table =
    kind === "ESCALATE" ? ESCALATE_MAP
      : kind === "REFUSED" ? REFUSED_MAP
        : kind === "CAPACITY_UNAVAILABLE" ? CAPACITY_MAP
          : kind === "HTTP" ? HTTP_ERROR_MAP
            : (TRANSPORT_MAP as Readonly<Record<string, OutcomeMapping>>);
  return table[reason] ?? null;
}

/** No mapping in this file attributes anything to the model. Asserted by test. */
export function anyModelAttributed(): readonly string[] {
  const bad: string[] = [];
  for (const [name, table] of Object.entries(ALL_MAPS)) {
    for (const [reason, m] of Object.entries(table as Record<string, OutcomeMapping>)) {
      if (m.attribution === "MODEL") bad.push(`${name}.${reason}`);
    }
  }
  return bad;
}
