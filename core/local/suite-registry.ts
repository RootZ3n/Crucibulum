/**
 * Luak — local suite registry.
 *
 * The audit of the first local-qualification commit found that the lane was a
 * parallel subsystem: nothing outside `core/local/` imported it, no CLI command
 * reached it, and `core/suite-loader.ts` could not load a local suite by its
 * declared id because that loader indexes by *filename*. Three suite files sat
 * in `suites/` polluting `listSuiteManifests()` while being unreachable by the
 * name they gave themselves.
 *
 * This registry is the fix: a first-class, versioned loader for local suites
 * that is deliberately **separate** from the legacy one. Separation is the
 * point rather than a compromise — the legacy loader's contract (a filename is
 * an id, `pass_threshold` is a number, `families` indexes the historical task
 * inventory) is exactly what local suites must not inherit, and forcing them
 * into it would corrupt the pins that keep historical scores stable.
 *
 * What separation does not license is being unreachable. Local suites are
 * discovered here, validated here, executed through `luak local-qualify`, and
 * exported through `luak export-qualification`.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { LOCAL_REGIME_VERSION } from "./regime.js";
import { LOCAL_SCORER_VERSION } from "./scorers.js";
import { CONTEXT_GENERATOR_VERSION } from "./context-generator.js";

export const LOCAL_SUITE_CONTRACT_VERSION = "local-suite-1.0.0" as const;

const LOCAL_SUITES_DIR =
  process.env["LUAK_LOCAL_SUITES_DIR"] ?? join(process.cwd(), "suites", "local");

/**
 * Adjudication state, replacing a numeric threshold.
 *
 * The first draft wrote `pass_threshold: 0` to mean "this suite measures rather
 * than grades". That was a live exploit, not a comment: `resolvePassThreshold`
 * returned 0 and `score >= 0` is true for every score including a total
 * failure, so any path that adjudicated a local suite would have marked
 * everything passing. A state that cannot be compared against a score cannot
 * be satisfied by one.
 */
export type AdjudicationState =
  /** Measurements only. No pass/fail may be derived, by anyone, for any score. */
  | "EVIDENCE_ONLY"
  /** Thresholds exist but have not been configured for this deployment yet. */
  | "THRESHOLD_UNSET"
  /** An operator has configured versioned thresholds; adjudication is allowed. */
  | "ADJUDICATED";

export interface LocalThresholds {
  readonly thresholdsVersion: string;
  readonly minAttempts: number;
  readonly minPassRate: number;
  readonly maxInfrastructureFailureRate: number;
  readonly minCitationValidRate: number;
  readonly maxHallucinationRate: number;
}

export interface LocalSuite {
  readonly contractVersion: typeof LOCAL_SUITE_CONTRACT_VERSION;
  readonly id: string;
  readonly version: string;
  readonly label: string;
  readonly description: string;
  readonly lane: string;
  readonly requiresLocalIdentity: boolean;
  readonly requiresInterface: "chat" | "tool_calls" | "agentic";
  readonly adjudication: AdjudicationState;
  /** Null unless adjudication is ADJUDICATED. Never defaulted. */
  readonly thresholds: LocalThresholds | null;
  readonly fixtureSuites: readonly { readonly id: string; readonly version: string }[];
  readonly contextTiers: readonly string[];
  /**
   * Versions that bind scoring behaviour to this suite's evidence. Recomputed
   * on load and compared, so evidence produced under one scorer cannot be
   * presented as evidence produced under another.
   */
  readonly boundVersions: {
    readonly regime: string;
    readonly scorers: string;
    readonly generator: string;
  };
  /** Identity of the suite definition itself. */
  readonly suiteHash: string;
  readonly sourcePath: string;
}

export class LocalSuiteError extends Error {}

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function parse(raw: string, path: string): LocalSuite {
  let d: Record<string, unknown>;
  try {
    d = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    throw new LocalSuiteError(`${path}: not valid JSON: ${(err as Error).message}`);
  }
  const need = (k: string): unknown => {
    if (d[k] === undefined || d[k] === null) throw new LocalSuiteError(`${path}: missing ${k}`);
    return d[k];
  };

  const id = String(need("id"));
  if (!ID_RE.test(id)) throw new LocalSuiteError(`${path}: id "${id}" is not a safe suite id`);

  const adjudication = String(need("adjudication")) as AdjudicationState;
  if (!["EVIDENCE_ONLY", "THRESHOLD_UNSET", "ADJUDICATED"].includes(adjudication)) {
    throw new LocalSuiteError(`${path}: adjudication must be EVIDENCE_ONLY, THRESHOLD_UNSET or ADJUDICATED`);
  }
  const thresholds = (d["thresholds"] ?? null) as LocalThresholds | null;
  // The two halves must agree, in both directions. A suite that claims to be
  // adjudicated without thresholds would adjudicate on nothing; one that
  // carries thresholds while claiming to be evidence-only invites a later
  // reader to use them.
  if (adjudication === "ADJUDICATED" && !thresholds) {
    throw new LocalSuiteError(`${path}: adjudication is ADJUDICATED but no thresholds are configured`);
  }
  if (adjudication !== "ADJUDICATED" && thresholds) {
    throw new LocalSuiteError(
      `${path}: thresholds are present but adjudication is ${adjudication}. ` +
        "Configure adjudication: \"ADJUDICATED\" deliberately, or remove them.",
    );
  }
  if (thresholds && !thresholds.thresholdsVersion) {
    throw new LocalSuiteError(`${path}: thresholds must carry a thresholdsVersion`);
  }

  // `pass_threshold` is refused outright. It is the legacy loader's numeric
  // contract, and 0 in that contract means "everything passes".
  if ("scoring" in d || "pass_threshold" in d) {
    throw new LocalSuiteError(
      `${path}: local suites must not carry scoring.pass_threshold. Adjudication is a ` +
        "state, not a number, precisely because 0 is a satisfiable threshold.",
    );
  }

  const bound = (d["boundVersions"] ?? {}) as Record<string, string>;
  for (const [k, actual] of [
    ["regime", LOCAL_REGIME_VERSION],
    ["scorers", LOCAL_SCORER_VERSION],
    ["generator", CONTEXT_GENERATOR_VERSION],
  ] as const) {
    if (bound[k] !== actual) {
      throw new LocalSuiteError(
        `${path}: boundVersions.${k} is ${JSON.stringify(bound[k])} but this build is ` +
          `${actual}. Evidence is bound to scoring behaviour; a mismatch means the suite ` +
          "definition and the code that would score it disagree.",
      );
    }
  }

  return {
    contractVersion: LOCAL_SUITE_CONTRACT_VERSION,
    id,
    version: String(need("version")),
    label: String(need("label")),
    description: String(need("description")),
    lane: String(need("lane")),
    requiresLocalIdentity: need("requiresLocalIdentity") === true,
    requiresInterface: String(need("requiresInterface")) as LocalSuite["requiresInterface"],
    adjudication,
    thresholds,
    fixtureSuites: (d["fixtureSuites"] ?? []) as LocalSuite["fixtureSuites"],
    contextTiers: (d["contextTiers"] ?? []) as readonly string[],
    boundVersions: { regime: LOCAL_REGIME_VERSION, scorers: LOCAL_SCORER_VERSION, generator: CONTEXT_GENERATOR_VERSION },
    suiteHash: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    sourcePath: path,
  };
}

/** Load one local suite by its **declared id**, which is also its filename. */
export function loadLocalSuite(suiteId: string): LocalSuite | null {
  if (!ID_RE.test(suiteId)) return null;
  const path = join(LOCAL_SUITES_DIR, `${suiteId}.json`);
  const resolved = resolve(path);
  if (!resolved.startsWith(resolve(LOCAL_SUITES_DIR))) return null;
  if (!existsSync(resolved)) return null;
  const suite = parse(readFileSync(resolved, "utf-8"), resolved);
  if (suite.id !== suiteId) {
    throw new LocalSuiteError(
      `${resolved}: declares id "${suite.id}" but is named "${suiteId}.json". ` +
        "A suite that cannot be loaded by the name it gives itself is unreachable.",
    );
  }
  return suite;
}

/** Every local suite, in a stable order. Never mixed with the legacy inventory. */
export function listLocalSuites(): readonly LocalSuite[] {
  if (!existsSync(LOCAL_SUITES_DIR)) return [];
  return readdirSync(LOCAL_SUITES_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => parse(readFileSync(join(LOCAL_SUITES_DIR, f), "utf-8"), join(LOCAL_SUITES_DIR, f)));
}

/**
 * Whether a suite may produce a pass/fail verdict at all.
 *
 * Called before anything adjudicates. Returns false for every suite shipped
 * today, and will keep doing so until an operator writes versioned thresholds.
 */
export function canAdjudicate(suite: LocalSuite): boolean {
  return suite.adjudication === "ADJUDICATED" && suite.thresholds !== null;
}
