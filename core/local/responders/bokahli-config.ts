/**
 * Luak — Bokahli responder configuration.
 *
 * Versioned, validated, and deliberately unforgiving. A responder config names
 * the exact artifact a campaign is about; every laxity here becomes a campaign
 * that measured something other than what it claims.
 *
 * The credential is never part of this file. It is read at request time from an
 * operator-named environment variable or a mode-checked file, and it does not
 * appear in the config object, in evidence, in errors, or in any diagnostic —
 * see `credentials.ts`.
 */

import {
  DEFAULT_PROTOCOL_PIN, type BokahliProtocolPin,
} from "./bokahli-protocol.js";

export const BOKAHLI_RESPONDER_CONFIG_VERSION = "bokahli-responder-config-1.2.0" as const;

export interface BokahliResponderConfig {
  readonly configVersion: typeof BOKAHLI_RESPONDER_CONFIG_VERSION;
  /** Base URL, e.g. http://127.0.0.1:8080. Loopback by default. */
  readonly endpoint: string;
  /** Stable public catalog identity. Never a filesystem path. */
  readonly modelId: string;
  /** Exact artifact digest the campaign is about. */
  readonly artifactDigest: string;
  /** Runtime build the evidence must have been produced on. */
  readonly expectedRuntimeBuild: string;
  /** Context tier this run exercises. Recorded on every attempt. */
  readonly contextTier: string;
  readonly requestTimeoutMs: number;
  readonly firstTokenTimeoutMs: number;
  /**
   * Use Bokahli's SSE stream instead of a buffered response.
   *
   * Optional, default false. Buffered is simpler and enough for a qualification
   * attempt, but the streaming path is a real code path rather than a spare
   * module: a terminal ESCALATE arriving mid-generation is only observable
   * there, and a reader that is never exercised is a reader that has never been
   * shown to work.
   */
  readonly stream?: boolean;
  /**
   * Where the bearer token comes from. Exactly one, never both, and never a
   * literal — a token in a config file ends up in git, in a diff, and in a
   * bug report.
   */
  readonly credential:
    | { readonly kind: "env"; readonly variable: string }
    | { readonly kind: "file"; readonly path: string };
  /**
   * Which Bokahli protocol generation this campaign targets.
   *
   * Optional only for source compatibility; absent means the B2 default. It is
   * never inferred from a response: a stripped B2 body is a protocol failure,
   * not a legacy deployment. Point a campaign at a Phase 1 deployment by saying
   * so here, and its evidence stays unexportable regardless.
   */
  readonly protocol?: BokahliProtocolPin;
  /** Sampler settings sent with each request. Recorded whether or not echoed. */
  readonly sampler: {
    readonly temperature: number;
    readonly topP: number;
    readonly maxTokens: number;
  };
  /**
   * Which generation regime this campaign measures.
   *
   * Optional for source compatibility; absent means `unconstrained`, which is
   * what every earlier config meant. Naming it is what makes a run's results
   * comparable only with results from the same regime — the two measure
   * different capabilities and their numbers must never be pooled.
   *
   * `json_schema` requires `outputSchema`. A regime that names no schema is an
   * unconstrained run wearing the wrong label, and the identity check refuses
   * it rather than letting the label travel.
   */
  readonly regime?: "unconstrained" | "json_schema";
  /**
   * The JSON Schema to constrain generation with, under `json_schema`.
   *
   * Sent to Bokahli verbatim, which sends it to the runtime verbatim. Nothing
   * on the path rewrites it: a schema anyone reshaped would constrain
   * generation to a contract nobody wrote, and every result under it would
   * describe that contract instead of the one the campaign declared.
   */
  readonly outputSchema?: Record<string, unknown>;
}

export class BokahliConfigError extends Error {}

/** The pin in force for a config, with the default applied. */
export function protocolPinOf(c: BokahliResponderConfig): BokahliProtocolPin {
  return c.protocol ?? DEFAULT_PROTOCOL_PIN;
}

/**
 * Whether a field name looks like it holds a secret.
 *
 * Underscores are stripped so `api_key` and `apiKey` are treated alike, and the
 * match is anchored to the end so a name that merely *mentions* a token —
 * `firstTokenTimeoutMs`, `tokenCountSource` — is not a false positive.
 */
export function isSecretBearingKey(key: string): boolean {
  const norm = key.replace(/_/g, "").toLowerCase();
  return /(token|secret|apikey|password|bearer|passphrase)$/.test(norm);
}

const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{0,127}$/;

/**
 * Hosts a qualification campaign may talk to.
 *
 * Bokahli binds loopback and one Tailscale address, and a campaign that reached
 * a wildcard or public host would be measuring something other than the local
 * deployment under test. Loopback is the default because Luak and Bokahli run
 * on the same machine; the tailnet address is permitted for a campaign driven
 * from a peer.
 */
function endpointProblem(endpoint: string): string | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return "not a valid URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "must be http or https";
  if (url.username || url.password) {
    return "must not embed credentials in the URL; use credential.env or credential.file";
  }
  if (url.search || url.hash) return "must not carry a query string or fragment";
  const host = url.hostname;
  if (host === "0.0.0.0" || host === "::" || host === "*") {
    return `"${host}" is a wildcard bind, not a reachable host`;
  }
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  // 100.64.0.0/10 — the CGNAT range Tailscale allocates from.
  const isTailnet = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
  if (!isLoopback && !isTailnet) {
    return `"${host}" is neither loopback nor a tailnet address; a qualification campaign ` +
      "must reach the deployment under test and nothing else";
  }
  return null;
}

/**
 * Validate a config.
 *
 * Every problem is reported, not just the first, because an operator fixing a
 * campaign config should see the whole list rather than one error per attempt.
 */
export function validateBokahliConfig(raw: unknown): {
  ok: true; config: BokahliResponderConfig;
} | {
  ok: false; problems: readonly { field: string; detail: string }[];
} {
  const problems: { field: string; detail: string }[] = [];
  const add = (field: string, detail: string): void => {
    problems.push({ field, detail });
  };

  if (typeof raw !== "object" || raw === null) {
    return { ok: false, problems: [{ field: "$", detail: "config must be an object" }] };
  }
  const c = raw as Record<string, unknown>;

  if (c["configVersion"] !== BOKAHLI_RESPONDER_CONFIG_VERSION) {
    add("configVersion", `must be ${BOKAHLI_RESPONDER_CONFIG_VERSION}`);
  }

  const endpoint = c["endpoint"];
  if (typeof endpoint !== "string" || endpoint.length === 0) {
    add("endpoint", "required");
  } else {
    const p = endpointProblem(endpoint);
    if (p) add("endpoint", p);
  }

  const modelId = c["modelId"];
  if (typeof modelId !== "string" || !MODEL_ID_RE.test(modelId)) {
    add("modelId", "must be a stable catalog identity: lowercase, no path separators");
  } else if (/[\\/]|\.(gguf|safetensors|bin|onnx)$/i.test(modelId)) {
    add("modelId", "must not be a filesystem path or artifact filename");
  }

  const digest = c["artifactDigest"];
  if (typeof digest !== "string" || !DIGEST_RE.test(digest)) {
    add("artifactDigest", "must be sha256:<64 lowercase hex>");
  }

  if (typeof c["expectedRuntimeBuild"] !== "string" || !c["expectedRuntimeBuild"]) {
    add("expectedRuntimeBuild", "required: evidence is bound to an exact runtime build");
  }
  if (typeof c["contextTier"] !== "string" || !c["contextTier"]) {
    add("contextTier", "required");
  }

  if ("stream" in c && typeof c["stream"] !== "boolean") {
    add("stream", "must be a boolean when present");
  }

  for (const k of ["requestTimeoutMs", "firstTokenTimeoutMs"]) {
    const v = c[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) add(k, "must be a positive number");
  }

  const cred = c["credential"] as Record<string, unknown> | undefined;
  if (!cred || typeof cred !== "object") {
    add("credential", "required: { kind: \"env\", variable } or { kind: \"file\", path }");
  } else if (cred["kind"] === "env") {
    if (typeof cred["variable"] !== "string" || !cred["variable"]) {
      add("credential.variable", "required");
    }
    if (Object.keys(cred).some(isSecretBearingKey) || "value" in cred) {
      add("credential", "must not carry a literal token; name the variable, not the secret");
    }
  } else if (cred["kind"] === "file") {
    if (typeof cred["path"] !== "string" || !cred["path"]) add("credential.path", "required");
  } else {
    add("credential.kind", 'must be "env" or "file"');
  }

  const sampler = c["sampler"] as Record<string, unknown> | undefined;
  if (!sampler || typeof sampler !== "object") {
    add("sampler", "required");
  } else {
    for (const k of ["temperature", "topP", "maxTokens"]) {
      const v = sampler[k];
      if (typeof v !== "number" || !Number.isFinite(v)) add(`sampler.${k}`, "must be a number");
    }
  }

  // The regime, and the schema it is meaningless without.
  //
  // Absent means `unconstrained`, which is what every pre-1.2.0 config meant, so
  // an old file keeps its exact meaning rather than acquiring a new one.
  const regime = c["regime"];
  if (regime !== undefined && regime !== "unconstrained" && regime !== "json_schema") {
    add("regime", 'must be "unconstrained" or "json_schema" when present');
  }
  const schema = c["outputSchema"];
  if (regime === "json_schema") {
    if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
      add("outputSchema", "required under the json_schema regime: a regime that names no schema " +
        "is an unconstrained run wearing the wrong label");
    }
  } else if (schema !== undefined) {
    // Refused rather than ignored. A config carrying a schema the run will not
    // send is a config whose author believes generation is constrained.
    add("outputSchema", 'only meaningful under regime "json_schema"');
  }

  // A stray secret anywhere in the object is refused outright rather than
  // ignored: a config that once held one has leaked it already, and the refusal
  // is what makes that visible instead of silent.
  //
  // Matched on the *end* of the key, not as a substring. A substring test
  // rejects `firstTokenTimeoutMs`, which is a timeout, and a guard that fires
  // on ordinary field names gets loosened by the next person who hits it —
  // which is how the check stops working at all.
  for (const key of Object.keys(c)) {
    if (isSecretBearingKey(key)) {
      add(key, "configs must not carry secrets; use credential.env or credential.file");
    }
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: c as unknown as BokahliResponderConfig };
}

/** A loopback default for the common case: Luak and Bokahli on the same host. */
export function defaultLoopbackConfig(
  modelId: string,
  artifactDigest: string,
  expectedRuntimeBuild: string,
): BokahliResponderConfig {
  return {
    configVersion: BOKAHLI_RESPONDER_CONFIG_VERSION,
    endpoint: "http://127.0.0.1:8080",
    modelId,
    artifactDigest,
    expectedRuntimeBuild,
    contextTier: "control",
    requestTimeoutMs: 120_000,
    firstTokenTimeoutMs: 60_000,
    credential: { kind: "file", path: "~/.config/bokahli/token" },
    sampler: { temperature: 0, topP: 1, maxTokens: 1024 },
  };
}
