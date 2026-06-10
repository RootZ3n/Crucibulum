/**
 * Luak — H5 regression: untrusted JSON is validated on deserialization.
 *
 * Covers the shared json-safe helpers (prototype-pollution rejection +
 * validateSchema) and their wiring into bundle loading and oracle integrity
 * (hash now unconditionally required — no hash_required:false bypass).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseJsonSafe, assertNoPrototypePollution, validateSchema, type SchemaSpec } from "../utils/json-safe.js";
import { loadVerifiedBundle } from "../core/bundle.js";
import { verifyOracleIntegrity } from "../core/oracle.js";
import type { TaskManifest } from "../adapters/base.js";

describe("prototype-pollution rejection (H5)", () => {
  it("parseJsonSafe rejects __proto__ / constructor / prototype keys", () => {
    assert.throws(() => parseJsonSafe('{"__proto__": {"polluted": true}}'), /forbidden key/);
    assert.throws(() => parseJsonSafe('{"a": {"constructor": {"x": 1}}}'), /forbidden key/);
    assert.throws(() => parseJsonSafe('{"nested": [{"prototype": 1}]}'), /forbidden key/);
  });

  it("parseJsonSafe accepts ordinary JSON", () => {
    assert.deepEqual(parseJsonSafe('{"a": 1, "b": [2, 3]}'), { a: 1, b: [2, 3] });
  });

  it("assertNoPrototypePollution walks arrays and nested objects", () => {
    assert.doesNotThrow(() => assertNoPrototypePollution({ a: [{ b: 1 }], c: "x" }));
    // `{ __proto__: {} }` as a literal sets the prototype, not an own key — the
    // real attack arrives via JSON.parse, which DOES create an own "__proto__".
    assert.throws(() => assertNoPrototypePollution(JSON.parse('{"deep":{"deeper":{"__proto__":{}}}}')), /forbidden key/);
    // `constructor` as a literal key IS an own property and must be caught too.
    assert.throws(() => assertNoPrototypePollution({ deep: { deeper: { constructor: 1 } } }), /forbidden key/);
  });

  it("loadVerifiedBundle rejects a bundle JSON carrying a prototype-pollution key", () => {
    const payload = '{"bundle_id":"x","bundle_hash":"sha256:y","score":{},"trust":{},"__proto__":{"evil":1}}';
    assert.equal(loadVerifiedBundle(payload), null);
  });
});

describe("validateSchema (H5)", () => {
  it("reports type and required-key errors", () => {
    const schema: SchemaSpec = { type: "object", required: ["id", "n"], properties: { id: { type: "string" }, n: { type: "number" } } };
    assert.deepEqual(validateSchema({ id: "a", n: 1 }, schema), []);
    const errs = validateSchema({ id: 5 }, schema);
    assert.ok(errs.some((e) => /missing required key "n"/.test(e)));
    assert.ok(errs.some((e) => /\$\.id: expected string/.test(e)));
  });

  it("validates array item types", () => {
    const schema: SchemaSpec = { type: "array", items: { type: "number" } };
    assert.deepEqual(validateSchema([1, 2, 3], schema), []);
    assert.ok(validateSchema([1, "two"], schema).length === 1);
  });
});

describe("oracle hash is unconditionally required (H5)", () => {
  function manifest(over: Record<string, unknown>): TaskManifest {
    return { id: "t", oracle_ref: over } as unknown as TaskManifest;
  }
  it("hash_required:false no longer bypasses verification (missing hash → not valid)", () => {
    const integrity = verifyOracleIntegrity(manifest({ hash_required: false }), "some oracle bytes");
    assert.notEqual(integrity.oracle_hash_status, "not_required");
    assert.notEqual(integrity.oracle_hash_status, "valid");
    assert.equal(integrity.oracle_hash_verified, false);
  });
});
