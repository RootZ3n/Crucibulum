/**
 * Luak — deciding which Bokahli protocol generation a response belongs to.
 *
 * The first version of this consumer inferred the answer: a response carrying
 * `contractVersion` or an `attemptLifetime` object was B2, and one carrying
 * neither was Phase 1. That reads reasonably and it is a downgrade vector.
 * Measured against a real B2 response: deleting exactly two fields flipped it
 * onto the legacy path, and with it `refusesCanonicalAttempt` went from **true
 * to false** — a response that should have been thrown away became an accepted
 * attempt. Deleting only `contractVersion` was worse: the response still
 * derived `runtime_tokenizer`, because the provenance rule never asked which
 * protocol it was reading.
 *
 * Inference is the bug. Absence cannot mean "an older, weaker contract" when
 * absence is also what an attacker, a proxy, a truncation, or a partially
 * deployed rollout produces. So generation is now **declared, pinned, and
 * mandatory**:
 *
 *   - the campaign configuration names the protocol it targets and the exact
 *     contract version it expects;
 *   - in `b2` mode the discriminator is required, must equal the pin, and the
 *     blocks the contract makes non-optional must all be present — a stripped
 *     response is a *protocol failure*, never a legacy response;
 *   - in `legacy` mode the discriminator must be **absent**, so a responder
 *     pointed at an old deployment cannot silently start consuming B2 claims
 *     it was never audited against.
 *
 * Legacy remains available because the deployment this campaign runs against is
 * still Phase 1, and refusing it outright would stop the campaign rather than
 * refuse its export. It is available *by explicit configuration only*, and its
 * evidence stays unexportable either way.
 */

/** Bokahli's `QualificationFacts.contractVersion` — non-optional in its contract. */
export const BOKAHLI_B2_CONTRACT_VERSION = "bokahli.qualification-telemetry.v1" as const;

export type BokahliProtocolMode = "b2" | "legacy";

export interface BokahliProtocolPin {
  readonly mode: BokahliProtocolMode;
  /** Required in `b2` mode. Ignored, and required absent, in `legacy` mode. */
  readonly expectedContractVersion: string;
}

export const DEFAULT_PROTOCOL_PIN: BokahliProtocolPin = Object.freeze({
  mode: "b2",
  expectedContractVersion: BOKAHLI_B2_CONTRACT_VERSION,
});

export type ProtocolVerdict =
  /** The response matches the pinned generation and carries its mandatory shape. */
  | { readonly ok: true; readonly generation: BokahliProtocolMode }
  /** It does not, and the mismatch is reported rather than reinterpreted. */
  | { readonly ok: false; readonly problems: readonly string[] };

function plain(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}
function at(root: unknown, ...keys: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of keys) {
    const o = plain(cur);
    if (o === null) return undefined;
    cur = o[k];
  }
  return cur;
}

/**
 * Blocks Bokahli's contract declares non-optional on a routed B2 response.
 *
 * Each is a `readonly` field on an interface with no `?`, so a genuine B2
 * response always carries it. Requiring them here is what makes the
 * discriminator unstrippable: removing the version fails the version check,
 * and removing the version *and* the blocks fails these.
 */
const REQUIRED_B2_BLOCKS: readonly (readonly [string, readonly string[]])[] = [
  ["qualificationFacts.tokenizer", ["result", "servedIdentity", "qualificationFacts", "tokenizer"]],
  ["qualificationFacts.backendInstance", ["result", "servedIdentity", "qualificationFacts", "backendInstance"]],
  ["qualificationFacts.attestation", ["result", "servedIdentity", "qualificationFacts", "attestation"]],
  ["qualificationFacts.placement", ["result", "servedIdentity", "qualificationFacts", "placement"]],
  ["qualificationFacts.runtime", ["result", "servedIdentity", "qualificationFacts", "runtime"]],
  ["qualificationFacts.template", ["result", "servedIdentity", "qualificationFacts", "template"]],
  ["telemetry.tokenCounts", ["telemetry", "tokenCounts"]],
  ["telemetry.sampler", ["telemetry", "sampler"]],
  ["telemetry.attemptLifetime", ["telemetry", "attemptLifetime"]],
];

/**
 * Resolve the protocol generation of a *routed* response against the pin.
 *
 * Only routed responses carry a served identity, so this is not called for
 * escalations, refusals or capacity outcomes — those are typed by the failure
 * map and never become evidence.
 */
export function resolveProtocol(body: unknown, pin: BokahliProtocolPin): ProtocolVerdict {
  const declared = at(body, "result", "servedIdentity", "qualificationFacts", "contractVersion");
  const declaredVersion = typeof declared === "string" ? declared : null;

  if (pin.mode === "legacy") {
    // A legacy-targeted campaign meeting a B2 deployment is a configuration
    // error, and consuming it silently would mean scoring evidence against
    // rules this mode was never audited under.
    if (declaredVersion !== null) {
      return {
        ok: false,
        problems: [
          `the responder is configured for the legacy Bokahli protocol but the deployment ` +
            `declares "${declaredVersion}"; refusing to consume a contract this mode does not check`,
        ],
      };
    }
    return { ok: true, generation: "legacy" };
  }

  const problems: string[] = [];
  if (declaredVersion === null) {
    problems.push(
      "the response declares no qualificationFacts.contractVersion. Bokahli's contract makes " +
        "it non-optional, so its absence is a stripped, truncated or downgraded response — " +
        "not an older deployment. A legacy deployment is targeted by configuration, never " +
        "inferred from a missing field.",
    );
  } else if (declaredVersion !== pin.expectedContractVersion) {
    problems.push(
      `the deployment declares contract "${declaredVersion}" but this campaign is pinned to ` +
        `"${pin.expectedContractVersion}"`,
    );
  }

  for (const [name, keys] of REQUIRED_B2_BLOCKS) {
    if (plain(at(body, ...keys)) === null) {
      problems.push(`the response is missing the non-optional block ${name}`);
    }
  }

  return problems.length === 0 ? { ok: true, generation: "b2" } : { ok: false, problems };
}
