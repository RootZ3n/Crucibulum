/**
 * Luak — safe JSON parsing + lightweight schema validation.
 *
 * Every JSON.parse over untrusted input (bundles, suites, oracles, persisted
 * conversations, manifests) previously cast the result with pure wishful
 * typing. This module adds two cheap, dependency-free guards (audit H5):
 *
 *   - parseJsonSafe / assertNoPrototypePollution: reject payloads carrying
 *     `__proto__`, `constructor`, or `prototype` keys anywhere in the tree, so
 *     a crafted document can't seed a prototype-pollution gadget downstream.
 *   - validateSchema: a minimal structural validator for the few hot shapes,
 *     so an unexpected type surfaces as a clear error instead of an
 *     undefined-property crash deep in scoring.
 */

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Throw if `value` (or anything nested in it) uses a prototype-pollution key.
 * Cheap recursive walk; arrays and plain objects only.
 */
export function assertNoPrototypePollution(value: unknown, path = "$"): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPrototypePollution(v, `${path}[${i}]`));
    return;
  }
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new Error(`Unsafe JSON: forbidden key "${key}" at ${path}`);
    }
    assertNoPrototypePollution((value as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

/**
 * JSON.parse + prototype-pollution rejection. Throws on invalid JSON (same as
 * JSON.parse) or on a forbidden key.
 */
export function parseJsonSafe<T = unknown>(raw: string): T {
  const parsed = JSON.parse(raw);
  assertNoPrototypePollution(parsed);
  return parsed as T;
}

export type SchemaSpec =
  | { type: "string" | "number" | "boolean" }
  | { type: "array"; items?: SchemaSpec }
  | { type: "object"; required?: string[]; properties?: Record<string, SchemaSpec> };

/**
 * Minimal structural validator. Returns a list of human-readable errors (empty
 * = valid). Intentionally small — it checks types and required keys, not a full
 * JSON-Schema feature set.
 */
export function validateSchema(data: unknown, schema: SchemaSpec, path = "$"): string[] {
  const errors: string[] = [];
  const typeOf = (v: unknown): string => (Array.isArray(v) ? "array" : v === null ? "null" : typeof v);

  switch (schema.type) {
    case "string":
    case "number":
    case "boolean":
      if (typeOf(data) !== schema.type) errors.push(`${path}: expected ${schema.type}, got ${typeOf(data)}`);
      break;
    case "array":
      if (!Array.isArray(data)) { errors.push(`${path}: expected array, got ${typeOf(data)}`); break; }
      if (schema.items) data.forEach((item, i) => errors.push(...validateSchema(item, schema.items!, `${path}[${i}]`)));
      break;
    case "object":
      if (!data || typeof data !== "object" || Array.isArray(data)) {
        errors.push(`${path}: expected object, got ${typeOf(data)}`);
        break;
      }
      for (const req of schema.required ?? []) {
        if (!(req in (data as Record<string, unknown>))) errors.push(`${path}: missing required key "${req}"`);
      }
      for (const [key, sub] of Object.entries(schema.properties ?? {})) {
        if (key in (data as Record<string, unknown>)) {
          errors.push(...validateSchema((data as Record<string, unknown>)[key], sub, `${path}.${key}`));
        }
      }
      break;
  }
  return errors;
}
