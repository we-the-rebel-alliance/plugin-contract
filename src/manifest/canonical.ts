/**
 * Canonical JSON and the manifest hash (contract §4).
 *
 * A manifest is hashed as `sha256:` plus the hex digest of its canonical JSON. Canonical JSON is one form for one
 * value, so key order cannot change a hash:
 *
 * - object keys are sorted by UTF-16 code unit at every depth;
 * - arrays keep their order;
 * - members whose value is `undefined` are left out of an object (as `JSON.stringify` would);
 * - `undefined` inside an array becomes `null` (as `JSON.stringify` would);
 * - strings use JSON's escaping; numbers must be finite; `-0` is written `0`.
 *
 * Values a manifest can hold are JSON values, so the last three rules only matter to a caller hashing something a
 * plugin computed. A value canonical JSON cannot represent (a function, a `bigint`, a `Symbol`, a cycle) throws.
 */
import { createHash } from "node:crypto"

/** The canonical JSON of `value`. Throws for a value JSON cannot represent. */
export function canonicalJson(value: unknown): string {
  return write(value, new Set())
}

function write(value: unknown, seen: Set<object>): string {
  if (value === null) return "null"
  switch (typeof value) {
    case "string":
      return JSON.stringify(value)
    case "boolean":
      return value ? "true" : "false"
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonical JSON cannot represent a number that is not finite")
      return Object.is(value, -0) ? "0" : JSON.stringify(value)
    case "undefined":
      return "null"
    case "object":
      break
    default:
      throw new Error(`canonical JSON cannot represent a ${typeof value}`)
  }
  const object = value as object
  if (seen.has(object)) throw new Error("canonical JSON cannot represent a cycle")
  seen.add(object)
  try {
    if (Array.isArray(value)) return `[${value.map((item) => write(item, seen)).join(",")}]`
    const record = value as Record<string, unknown>
    const entries: string[] = []
    for (const key of Object.keys(record).sort()) {
      const item = record[key]
      if (item === undefined) continue
      entries.push(`${JSON.stringify(key)}:${write(item, seen)}`)
    }
    return `{${entries.join(",")}}`
  } finally {
    seen.delete(object)
  }
}

/** The manifest hash: `sha256:` and the hex digest of the canonical JSON of `value`. Key order does not change it. */
export function manifestHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`
}
