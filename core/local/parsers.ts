/**
 * Luak — parse model output into the shapes the scorers grade.
 *
 * Strict, and deliberately so. This is the boundary where a model's text
 * becomes a scoreable claim, and every leniency here is a way for a
 * badly-formed answer to be graded as a well-formed one.
 *
 * What it will do: strip a ``` fence, because models wrap JSON in one far more
 * often than they get the JSON wrong, and refusing that would measure prompt
 * compliance under the name of schema validity.
 *
 * What it will not do: repair. No quote-fixing, no trailing-comma tolerance, no
 * inferring a missing field, no re-escaping of a `\u{3e}` the model should have
 * written as `>`. A malformed answer is reported as malformed.
 *
 * ## What changed in 1.1.0, and why
 *
 * Until 1.1.0 every failure here returned `null`, and the runner turned every
 * `null` into `local_harness_parse_failure` attributed to HARNESS_PARSER. The
 * stated reason was that "whether the model produced something unusable or this
 * parser is too strict is not decidable from here". For one of the two cases
 * that was true. For the other it was not, and the difference is decidable
 * precisely here:
 *
 *   - The transport delivered a completion, the completion was extracted, and
 *     `JSON.parse` refused it — or accepted it and the result is not an object,
 *     or is an object whose `outcome` is not one of the two declared values.
 *     Nothing about that is a harness judgement call. The harness read exactly
 *     what arrived; what arrived violates the declared output contract. That is
 *     a MODEL-attributed structured-output failure.
 *
 *   - The extractor itself faulted — it threw, or no parser was configured for
 *     the fixture at all. Nothing was decided about the model, because nothing
 *     got as far as looking at its answer. That is HARNESS_PARSER, and it is the
 *     only thing that is.
 *
 * The concrete cost of conflating them: an IQ3_XXS run emitted `\u{3e}` inside a
 * JSON string, which is not valid JSON. The completion arrived intact and the
 * harness parsed the transport correctly. Luak recorded HARNESS_PARSER, the
 * regime turned that into HARNESS_FAILURE, and the attempt was excluded from the
 * model's capability distribution — a model defect scored as a Luak defect, in
 * the direction that flatters the model. See `tests/local-parse-attribution.test.ts`.
 *
 * There is exactly one structured-output boundary now, and it is
 * `checkStructuredOutput` in `scorers.ts`. Before 1.1.0 there were two
 * implementations of this decision — that one, which was correct and which
 * nothing on the execution path called, and `extractJson` below, which was
 * wired up and which attributed everything to the harness.
 */
import { checkStructuredOutput, type ReconAnswer, type TriageAnswer, type Citation } from "./scorers.js";
import type { LocalFailureCode } from "../../types/local-verdict.js";
import type { ReconFixture, TriageFixture } from "./fixtures/index.js";

/** Bump when the parse boundary's classification changes. Evidence is bound to this. */
export const LOCAL_PARSER_VERSION = "local-parsers-1.1.0" as const;

/**
 * What reading one completion produced.
 *
 * Three outcomes, not two, because "could not be scored" is not one thing. The
 * discriminant carries the attribution with it, so a caller cannot record a
 * contract violation as a harness fault by picking the wrong branch — there is
 * no branch that would let it.
 */
export type StructuredParse<T> =
  | { readonly status: "PARSED"; readonly value: T }
  /**
   * A completion arrived and violates the declared output contract.
   * MODEL-attributed. `failureCode` distinguishes empty, truncated, degenerate
   * and simply-malformed, because those have different causes and different
   * fixes.
   */
  | {
    readonly status: "CONTRACT_VIOLATION";
    readonly failureCode: LocalFailureCode;
    readonly problems: readonly string[];
  }
  /**
   * The extractor faulted. HARNESS_PARSER-attributed, and reserved for that:
   * a thrown exception inside this module, or a fixture reached with no parser
   * configured. Never used for output the model got wrong.
   */
  | { readonly status: "EXTRACTOR_FAULT"; readonly detail: string };

type ContractViolation = Extract<StructuredParse<never>, { status: "CONTRACT_VIOLATION" }>;

function citations(v: unknown, path: string | null): Citation[] {
  if (!Array.isArray(v)) return [];
  const out: Citation[] = [];
  for (const c of v) {
    if (typeof c !== "object" || c === null) continue;
    const o = c as Record<string, unknown>;
    const start = Number(o["startLine"]);
    const end = Number(o["endLine"] ?? o["startLine"]);
    if (!Number.isFinite(start)) continue;
    out.push({
      path: typeof o["path"] === "string" ? o["path"] : path,
      startLine: start,
      endLine: Number.isFinite(end) ? end : start,
      quote: typeof o["quote"] === "string" ? o["quote"] : null,
    });
  }
  return out;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * The `outcome` field is part of the contract, not a shape detail.
 *
 * A body that parses as JSON, carries every required key, and says
 * `outcome: "SUCCESS"` has not answered the question that was asked. It is a
 * contract violation and it is the model's.
 */
function outcomeProblem(o: Record<string, unknown>): string | null {
  const outcome = o["outcome"];
  if (outcome === "ANSWERED" || outcome === "ABSTAINED") return null;
  return `outcome must be "ANSWERED" or "ABSTAINED", not ${JSON.stringify(outcome)}`;
}

/**
 * Read a completion against the declared key set.
 *
 * `requiredKeys` is the same `outputSchemaKeys` the runner carries on
 * `LocalPrompt`, so the bar a model is held to is the bar its prompt named, and
 * neither the parser nor the scorer invents a key the prompt never declared.
 */
function readObject(
  raw: string,
  requiredKeys: readonly string[],
): { readonly ok: true; readonly o: Record<string, unknown> } | ContractViolation {
  const checked = checkStructuredOutput(raw, requiredKeys);
  if (!checked.valid) {
    return {
      status: "CONTRACT_VIOLATION",
      // checkStructuredOutput returns a null code only when it is valid.
      failureCode: checked.failureCode ?? "local_invalid_structured_output",
      problems: checked.problems,
    };
  }
  const o = checked.parsed as Record<string, unknown>;
  const problem = outcomeProblem(o);
  if (problem !== null) {
    return {
      status: "CONTRACT_VIOLATION",
      failureCode: "local_invalid_structured_output",
      problems: [problem],
    };
  }
  return { ok: true, o };
}

/** Keys the triage contract declares. Mirrors `buildTriagePrompt`. */
export const TRIAGE_REQUIRED_KEYS: readonly string[] = ["outcome", "failureGroups", "truncationReported"];
/** Keys the reconnaissance contract declares. Mirrors `buildReconPrompt`. */
export const RECON_REQUIRED_KEYS: readonly string[] = ["outcome", "files", "symbols"];

/**
 * What the *unconstrained* regime requires of a completion, and no more.
 *
 * Empty, deliberately. This change corrects an attribution; it does not raise a
 * bar. The pre-1.1.0 parser accepted any JSON object carrying a valid `outcome`,
 * and so does this one — a model that abstains without an empty `failureGroups`
 * array is not newly a failure because the boundary moved. Tightening the
 * required-key set at the same time as re-attributing failures would make the
 * two indistinguishable in the results, and there would be no way to say which
 * of them moved a number.
 *
 * The declared key sets above are not unused: under the constrained regime they
 * are what the JSON Schema requires, and there the *runtime* enforces them
 * before a token is emitted. Required keys are a property of that regime, and
 * putting them here would have imported one regime's bar into the other's
 * measurement.
 */
const UNCONSTRAINED_REQUIRED_KEYS: readonly string[] = [];

export function parseTriageAnswer(raw: string, _fx: TriageFixture): StructuredParse<TriageAnswer> {
  let read: { readonly ok: true; readonly o: Record<string, unknown> } | ContractViolation;
  try {
    read = readObject(raw, UNCONSTRAINED_REQUIRED_KEYS);
  } catch (err) {
    return { status: "EXTRACTOR_FAULT", detail: `triage extractor threw: ${(err as Error).message}` };
  }
  if (!("ok" in read)) return read;
  const o = read.o;

  try {
    const groupsRaw = Array.isArray(o["failureGroups"]) ? o["failureGroups"] : [];
    return {
      status: "PARSED",
      value: {
        rawText: raw,
        abstained: o["outcome"] === "ABSTAINED",
        groups: groupsRaw.map((g) => {
          const gg = (typeof g === "object" && g !== null ? g : {}) as Record<string, unknown>;
          return {
            classification: typeof gg["classification"] === "string" ? gg["classification"] : "UNCLASSIFIED",
            citations: citations(gg["citations"], null),
            assertedText: typeof gg["observed"] === "string"
              ? gg["observed"]
              : JSON.stringify(gg["observed"] ?? ""),
          };
        }),
        truncationReported: o["truncationReported"] === true,
        statedNeeds: strings(o["needs"]),
      },
    };
  } catch (err) {
    return { status: "EXTRACTOR_FAULT", detail: `triage projection threw: ${(err as Error).message}` };
  }
}

export function parseReconAnswer(raw: string, _fx: ReconFixture): StructuredParse<ReconAnswer> {
  let read: { readonly ok: true; readonly o: Record<string, unknown> } | ContractViolation;
  try {
    read = readObject(raw, UNCONSTRAINED_REQUIRED_KEYS);
  } catch (err) {
    return { status: "EXTRACTOR_FAULT", detail: `recon extractor threw: ${(err as Error).message}` };
  }
  if (!("ok" in read)) return read;
  const o = read.o;

  try {
    const filesRaw = Array.isArray(o["files"]) ? o["files"] : [];
    return {
      status: "PARSED",
      value: {
        rawText: raw,
        abstained: o["outcome"] === "ABSTAINED",
        files: filesRaw.map((f) => {
          const ff = (typeof f === "object" && f !== null ? f : {}) as Record<string, unknown>;
          const p = typeof ff["path"] === "string" ? ff["path"] : "";
          return { path: p, citations: citations(ff["citations"], p) };
        }),
        symbols: strings(o["symbols"]),
        relationships: (Array.isArray(o["relationships"]) ? o["relationships"] : []).map((r) => {
          const rr = (typeof r === "object" && r !== null ? r : {}) as Record<string, unknown>;
          return {
            from: String(rr["from"] ?? ""), to: String(rr["to"] ?? ""),
            kind: String(rr["kind"] ?? ""), basis: String(rr["basis"] ?? "INFERRED"),
          };
        }),
        omissionReported: o["omissionReported"] === true,
        statedNeeds: strings(o["needs"]),
      },
    };
  } catch (err) {
    return { status: "EXTRACTOR_FAULT", detail: `recon projection threw: ${(err as Error).message}` };
  }
}
