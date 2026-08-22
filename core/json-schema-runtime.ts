import { existsSync, readFileSync } from "node:fs";

type Node = Record<string, unknown>;
const isObject = (value: unknown): value is Node => value !== null && typeof value === "object" && !Array.isArray(value);
let contract: Node | undefined;

function resolveRef(root: Node, ref: string): Node | undefined {
  let value: unknown = root;
  for (const segment of ref.replace(/^#\//, "").split("/")) value = isObject(value) ? value[segment] : undefined;
  return isObject(value) ? value : undefined;
}

function inspect(rule: Node, value: unknown, root: Node, location: string): string[] {
  if (typeof rule.$ref === "string") { const target = resolveRef(root, rule.$ref); return target ? inspect(target, value, root, location) : [`${location} unresolved ${rule.$ref}`]; }
  if (Array.isArray(rule.anyOf)) return rule.anyOf.some((choice) => isObject(choice) && inspect(choice, value, root, location).length === 0) ? [] : [`${location} anyOf mismatch`];
  const errors: string[] = [];
  if (Object.hasOwn(rule, "const") && value !== rule.const) errors.push(`${location} const mismatch`);
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) errors.push(`${location} enum mismatch`);
  const allowed = Array.isArray(rule.type) ? rule.type : rule.type === undefined ? [] : [rule.type];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (allowed.length > 0 && !allowed.includes(actual) && !(actual === "integer" && allowed.includes("number"))) return [...errors, `${location} type mismatch`];
  if (typeof value === "string") {
    if (typeof rule.minLength === "number" && value.length < rule.minLength) errors.push(`${location} minLength`);
    if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(value)) errors.push(`${location} pattern`);
    if (rule.format === "date-time" && !Number.isFinite(Date.parse(value))) errors.push(`${location} date-time`);
  }
  if (typeof value === "number" && typeof rule.minimum === "number" && value < rule.minimum) errors.push(`${location} minimum`);
  if (Array.isArray(value)) {
    if (typeof rule.minItems === "number" && value.length < rule.minItems) errors.push(`${location} minItems`);
    if (rule.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${location} uniqueItems`);
    if (isObject(rule.items)) value.forEach((item, index) => errors.push(...inspect(rule.items as Node, item, root, `${location}[${index}]`)));
  }
  if (isObject(value)) {
    const props = isObject(rule.properties) ? rule.properties : {};
    if (Array.isArray(rule.required)) for (const key of rule.required) if (typeof key === "string" && !(key in value)) errors.push(`${location}.${key} required`);
    if (rule.additionalProperties === false) for (const key of Object.keys(value)) if (!(key in props)) errors.push(`${location}.${key} additional`);
    for (const [key, child] of Object.entries(props)) if (key in value && isObject(child)) errors.push(...inspect(child, value[key], root, `${location}.${key}`));
  }
  return errors;
}

export function validateCommittedHowaSchema(value: unknown): string[] {
  const sourcePath = new URL("../schemas/howa-hermes-daily-driver-receipt.v2.schema.json", import.meta.url);
  const distPath = new URL("../../schemas/howa-hermes-daily-driver-receipt.v2.schema.json", import.meta.url);
  contract ??= JSON.parse(readFileSync(existsSync(sourcePath) ? sourcePath : distPath, "utf8")) as Node;
  return inspect(contract, value, contract, "$" );
}
