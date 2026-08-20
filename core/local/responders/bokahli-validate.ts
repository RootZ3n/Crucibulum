/**
 * Luak — bounded runtime validation of a Bokahli response.
 *
 * The pinned TypeScript contract in `types/bokahli-contract` describes what
 * Bokahli *intends* to send. It is erased at runtime and it validates nothing:
 * a `readonly canarySuiteId: string | null` is a comment as far as a JSON body
 * is concerned. Everything that crosses the network is therefore re-checked
 * here, by value, before it can become a fact, an attempt, a score, or evidence.
 *
 * Bounds are part of validation, not politeness. An evaluation harness that can
 * be made to allocate by the thing it is evaluating is not a harness, and an
 * identifier whose length is chosen by the responder's subject is a field that
 * can inflate every record in a campaign.
 *
 * Nothing here coerces. A value that is not what it claims to be becomes null
 * and its check fails; it never becomes a nearby value that happens to parse.
 */

/** Runtime-supplied identifiers are labels, not payloads. */
export const MAX_IDENTIFIER_CHARS = 256;
/** Reason strings are prose, and prose from a peer still needs a ceiling. */
export const MAX_REASON_CHARS = 2_000;
export const MAX_REASON_ITEMS = 64;
/** Deeper than any shape Bokahli declares; shallow enough to walk cheaply. */
export const MAX_JSON_DEPTH = 64;

const DIGEST = /^sha256:[0-9a-f]{64}$/;

/** Keys that must never be copied out of a parsed body into an object we build. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * A plain JSON object.
 *
 * Arrays are excluded deliberately: `[]` passes `typeof === "object"`, and a
 * response that puts an array where an object belongs is malformed rather than
 * empty.
 */
export function plainObject(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function readPath(root: unknown, ...keys: readonly string[]): unknown {
  let cur: unknown = root;
  for (const k of keys) {
    const o = plainObject(cur);
    if (o === null) return undefined;
    cur = o[k];
  }
  return cur;
}

/** Literal `true` only. `1`, `"true"` and truthy objects are not booleans. */
export function strictTrue(v: unknown): boolean {
  return v === true;
}

/** Tri-state: absent stays null, so a missing field never reads as a denial. */
export function strictBoolean(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function boundedString(v: unknown, max = MAX_IDENTIFIER_CHARS): string | null {
  return typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
}

/** A digest is a shape, not just a string. A malformed one is not a digest. */
export function digestString(v: unknown): string | null {
  return typeof v === "string" && DIGEST.test(v) ? v : null;
}

/** Counts and generations: non-negative, integral, and inside the safe range. */
export function safeCount(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** Durations and rates: finite and non-negative. Time does not run backwards. */
export function safeDuration(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

/** Any finite number, for measurements that legitimately go negative. */
export function finiteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function boundedStrings(v: unknown, maxItems = MAX_REASON_ITEMS): readonly string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    if (out.length >= maxItems) break;
    if (typeof x === "string") out.push(x.slice(0, MAX_REASON_CHARS));
  }
  return Object.freeze(out);
}

/**
 * A map of finite numbers, built on a null-prototype object.
 *
 * `JSON.parse` creates `__proto__` as an own property, so copying entries
 * straight across can reach `Object.prototype` through the assignment's setter.
 * The keys are skipped and the target has no prototype to reach.
 */
export function numberMap(v: unknown): Readonly<Record<string, number>> | null {
  const o = plainObject(v);
  if (o === null) return null;
  const out: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [k, val] of Object.entries(o)) {
    if (FORBIDDEN_KEYS.has(k)) continue;
    if (k.length > MAX_IDENTIFIER_CHARS) continue;
    const num = finiteNumber(val);
    if (num !== null) out[k] = num;
  }
  return Object.freeze(out);
}

/** Depth of a parsed value, bounded so the walk itself cannot blow the stack. */
export function jsonDepth(v: unknown, depth = 0): number {
  if (depth > MAX_JSON_DEPTH + 1) return depth;
  if (v === null || typeof v !== "object") return depth;
  let worst = depth;
  for (const child of Object.values(v as Record<string, unknown>)) {
    worst = Math.max(worst, jsonDepth(child, depth + 1));
    if (worst > MAX_JSON_DEPTH + 1) return worst;
  }
  return worst;
}

/** An ISO instant Bokahli emitted, or null. Never a partially parsed date. */
export function instantString(v: unknown): string | null {
  const s = boundedString(v, 64);
  if (s === null) return null;
  return Number.isFinite(Date.parse(s)) ? s : null;
}
