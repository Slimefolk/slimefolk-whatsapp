// A small JSON Schema checker for the files in ./schema, so the Worker can validate requests without a dependency (the usual
// validators compile code at runtime, which Workers forbid). It supports the keywords the contract uses and nothing else:
// $ref (to a schema file in the registry), type, enum, const, properties, required, additionalProperties, items, prefixItems,
// minItems, maxItems, minimum, maximum, minLength, maxLength, pattern, oneOf, anyOf. Unknown keywords are ignored.

export type Schema = { [key: string]: unknown };
/** Schema documents by file name, as `defs.json` or `actions/status.request.json`. */
export type Registry = Record<string, Schema>;

const typeOf = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isType = (v: unknown, t: string): boolean => (t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === t || (t === "array" && Array.isArray(v)) || (t === "null" && v === null) || (t === "object" && typeof v === "object" && v !== null && !Array.isArray(v)));

function resolve(registry: Registry, doc: string, ref: string): { schema: Schema; doc: string } {
  const [file, pointer = ""] = ref.split("#");
  let name = doc;
  if (file) {
    const base = doc.includes("/") ? doc.slice(0, doc.lastIndexOf("/") + 1) : "";
    const parts = (file.startsWith("/") ? file.slice(1) : base + file).split("/");
    const out: string[] = [];
    for (const p of parts) p === ".." ? out.pop() : p !== "." && out.push(p);
    name = out.join("/");
  }
  let node: unknown = registry[name];
  if (!node) throw new Error(`schema ${name} is not in the registry`);
  for (const seg of pointer.split("/").filter(Boolean)) node = (node as Schema)[decodeURIComponent(seg.replace(/~1/g, "/").replace(/~0/g, "~"))];
  if (!node || typeof node !== "object") throw new Error(`cannot resolve ${ref}`);
  return { schema: node as Schema, doc: name };
}

/** The first problem, as `path: message`, or null when the value fits. */
export function check(registry: Registry, doc: string, schema: Schema, value: unknown, path = "$"): string | null {
  if (typeof schema.$ref === "string") {
    const r = resolve(registry, doc, schema.$ref);
    return check(registry, r.doc, r.schema, value, path);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => isType(value, t))) return `${path}: expected ${types.join(" or ")}, got ${typeOf(value)}`;
  }
  if ("const" in schema && value !== schema.const) return `${path}: must be ${JSON.stringify(schema.const)}`;
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${path}: must be one of ${schema.enum.map((e) => JSON.stringify(e)).join(", ")}`;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return `${path}: shorter than ${schema.minLength} characters`;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return `${path}: longer than ${schema.maxLength} characters`;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) return `${path}: does not match ${schema.pattern}`;
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return `${path}: below ${schema.minimum}`;
    if (typeof schema.maximum === "number" && value > schema.maximum) return `${path}: above ${schema.maximum}`;
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return `${path}: needs at least ${schema.minItems} items`;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return `${path}: takes at most ${schema.maxItems} items`;
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as Schema[]) : [];
    for (let i = 0; i < value.length; i++) {
      const s = i < prefix.length ? prefix[i] : schema.items;
      if (s && typeof s === "object") {
        const bad = check(registry, doc, s as Schema, value[i], `${path}[${i}]`);
        if (bad) return bad;
      }
    }
  }
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    for (const k of (schema.required as string[] | undefined) ?? []) if (o[k] === undefined) return `${path}: missing ${k}`;
    const props = (schema.properties as Record<string, Schema> | undefined) ?? {};
    for (const [k, v] of Object.entries(o)) {
      if (v === undefined) continue;
      if (props[k]) {
        const bad = check(registry, doc, props[k], v, `${path}.${k}`);
        if (bad) return bad;
      } else if (schema.additionalProperties === false) return `${path}: unknown property ${k}`;
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        const bad = check(registry, doc, schema.additionalProperties as Schema, v, `${path}.${k}`);
        if (bad) return bad;
      }
    }
  }
  if (Array.isArray(schema.anyOf)) {
    const problems = (schema.anyOf as Schema[]).map((s) => check(registry, doc, s, value, path));
    if (!problems.includes(null)) return `${path}: does not fit any allowed shape (${problems.filter((p) => !p!.endsWith("expected null, got " + typeOf(value))).join("; ")})`;
  }
  if (Array.isArray(schema.oneOf)) {
    const fits = (schema.oneOf as Schema[]).filter((s) => check(registry, doc, s, value, path) === null).length;
    if (fits !== 1) return `${path}: must fit exactly one allowed shape (fits ${fits})`;
  }
  return null;
}
