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
 * inferring a missing field. A parse failure returns null, the runner records
 * `local_harness_parse_failure` attributed to HARNESS_PARSER, and the reason is
 * that whether the model produced something unusable or this parser is too
 * strict is not decidable from here — and guessing in the model's disfavour is
 * how a benchmark quietly measures its own client.
 */
import type { ReconAnswer, TriageAnswer, Citation } from "./scorers.js";
import type { ReconFixture, TriageFixture } from "./fixtures/index.js";

function extractJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim();
  if (text.length === 0) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  try {
    const v = JSON.parse(candidate) as unknown;
    return typeof v === "object" && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

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

export function parseTriageAnswer(raw: string, _fx: TriageFixture): TriageAnswer | null {
  const o = extractJson(raw);
  if (!o) return null;
  const outcome = o["outcome"];
  if (outcome !== "ANSWERED" && outcome !== "ABSTAINED") return null;

  const groupsRaw = Array.isArray(o["failureGroups"]) ? o["failureGroups"] : [];
  return {
    rawText: raw,
    abstained: outcome === "ABSTAINED",
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
  };
}

export function parseReconAnswer(raw: string, _fx: ReconFixture): ReconAnswer | null {
  const o = extractJson(raw);
  if (!o) return null;
  const outcome = o["outcome"];
  if (outcome !== "ANSWERED" && outcome !== "ABSTAINED") return null;

  const filesRaw = Array.isArray(o["files"]) ? o["files"] : [];
  return {
    rawText: raw,
    abstained: outcome === "ABSTAINED",
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
  };
}
