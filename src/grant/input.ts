/**
 * The canonical input a grant's digest binds (contract §8, §13; issue #40).
 *
 * The rules are the ones the family agreed on, so two copies of a verifier cannot disagree about the bytes:
 *
 * - a value is JSON: `null`, a boolean, a string, a **safe integer**, an array or a plain object;
 * - a number that is not a safe integer is refused, never rounded or formatted;
 * - a string with a lone surrogate is refused, never replaced;
 * - at most 16 objects or arrays nest inside one another;
 * - the canonical JSON is at most 64 KiB of UTF-8.
 *
 * The canonical text is deterministic: object keys are sorted by UTF-16 code unit, arrays keep their order, strings are
 * escaped by `JSON.stringify`, and safe integers are written in decimal. `-0` is written `0`, as JSON has one zero.
 *
 * Everything here throws `GrantInputError` on a value outside the rules; `verifyGrant` catches it and answers
 * `GRANT_INPUT_INVALID`. The functions do no I/O.
 */
import { createHash } from "node:crypto"
import { MAX_INPUT_BYTES, MAX_INPUT_DEPTH } from "./constants.ts"
import { isPlainObject, surrogateProblem } from "./text.ts"

/** A scope as grants carry it: a flat map of key to a value or a list of values. */
export type GrantScope = Readonly<Record<string, string | readonly string[]>>

/** A value the grant input cannot carry, with a reason that names no value. */
export class GrantInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "GrantInputError"
  }
}

/** An index an array keeps for itself: `0`, `1`, … and never `01`. */
const INDEX = /^(?:0|[1-9]\d*)$/

/** The most characters a scope key or value takes. */
const MAX_SCOPE_TEXT = 200

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

interface Sink {
  readonly parts: string[]
  bytes: number
}

function emit(sink: Sink, text: string): void {
  sink.bytes += Buffer.byteLength(text, "utf8")
  if (sink.bytes > MAX_INPUT_BYTES) throw new GrantInputError(`the canonical JSON is over ${MAX_INPUT_BYTES} bytes`)
  sink.parts.push(text)
}

function emitString(sink: Sink, text: string): void {
  const surrogate = surrogateProblem(text)
  if (surrogate !== undefined) throw new GrantInputError(`a string ${surrogate}`)
  emit(sink, JSON.stringify(text))
}

function dataProperty(value: object, key: string, what: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor === undefined || !("value" in descriptor)) throw new GrantInputError(`${what} holds an accessor`)
}

function writeArray(value: readonly unknown[], depth: number, sink: Sink): void {
  if (depth > MAX_INPUT_DEPTH) throw new GrantInputError(`the input nests more than ${MAX_INPUT_DEPTH} objects or arrays deep`)
  if (Object.getOwnPropertySymbols(value).length > 0) throw new GrantInputError("an array holds a symbol key")
  const keys = Object.keys(value)
  if (keys.length !== value.length) throw new GrantInputError("an array is sparse")
  if (Object.getOwnPropertyNames(value).length !== keys.length + 1) throw new GrantInputError("an array holds a property that is not an index")
  for (const key of keys) {
    if (!INDEX.test(key)) throw new GrantInputError("an array holds a property that is not an index")
    dataProperty(value, key, "an array")
  }
  emit(sink, "[")
  for (let index = 0; index < value.length; index++) {
    if (index > 0) emit(sink, ",")
    write(value[index], depth + 1, sink)
  }
  emit(sink, "]")
}

function writeObject(value: Record<string, unknown>, depth: number, sink: Sink): void {
  if (depth > MAX_INPUT_DEPTH) throw new GrantInputError(`the input nests more than ${MAX_INPUT_DEPTH} objects or arrays deep`)
  if (Object.getOwnPropertySymbols(value).length > 0) throw new GrantInputError("an object holds a symbol key")
  const keys = Object.keys(value)
  if (Object.getOwnPropertyNames(value).length !== keys.length) throw new GrantInputError("an object holds a non-enumerable property")
  keys.sort()
  emit(sink, "{")
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!
    if (index > 0) emit(sink, ",")
    emitString(sink, key)
    emit(sink, ":")
    dataProperty(value, key, "an object")
    write(value[key], depth + 1, sink)
  }
  emit(sink, "}")
}

function write(value: unknown, depth: number, sink: Sink): void {
  if (value === null) {
    emit(sink, "null")
    return
  }
  switch (typeof value) {
    case "boolean":
      emit(sink, value ? "true" : "false")
      return
    case "number":
      if (!Number.isSafeInteger(value)) throw new GrantInputError("a number is not a safe integer")
      emit(sink, String(value))
      return
    case "string":
      emitString(sink, value)
      return
    case "object":
      break
    default:
      throw new GrantInputError(`a ${typeof value} is not a JSON value`)
  }
  if (Array.isArray(value)) {
    writeArray(value, depth, sink)
    return
  }
  if (isPlainObject(value)) {
    writeObject(value, depth, sink)
    return
  }
  throw new GrantInputError("a value is not a plain object or an array")
}

/**
 * The canonical JSON of a grant input: the exact text a digest binds. Throws `GrantInputError` when the value is not
 * JSON, holds a number outside the safe integers, holds a lone surrogate, nests too deep or is over 64 KiB.
 */
export function canonicalJson(value: unknown): string {
  const sink: Sink = { parts: [], bytes: 0 }
  write(value, 1, sink)
  return sink.parts.join("")
}

/** The input's digest: `sha256:<64 lowercase hex digits>` over the UTF-8 bytes of its canonical JSON. */
export function digestInput(input: unknown): string {
  const digest = createHash("sha256").update(canonicalJson(input), "utf8").digest("hex")
  return `sha256:${digest}`
}

function scopeText(value: string): string {
  if (value.length === 0) throw new GrantInputError("a scope key or value is empty")
  if (value.length > MAX_SCOPE_TEXT) throw new GrantInputError(`a scope key or value is over ${MAX_SCOPE_TEXT} characters`)
  if (CONTROL.test(value)) throw new GrantInputError("a scope key or value holds a control character")
  const surrogate = surrogateProblem(value)
  if (surrogate !== undefined) throw new GrantInputError(`a scope key or value ${surrogate}`)
  return value
}

/**
 * The scope in canonical form: keys sorted, each list sorted with repeats removed, every key and value a non-empty
 * string. An empty list is refused, because an omitted key and an empty list would both mean "none" and "all".
 * Throws `GrantInputError` when the scope is not a flat map of strings or lists of strings.
 */
export function canonicalScope(scope: GrantScope | undefined): GrantScope {
  if (scope === undefined) return {}
  if (!isPlainObject(scope)) throw new GrantInputError("a scope must be a plain object")
  const out: Record<string, string | string[]> = {}
  for (const key of Object.keys(scope).sort()) {
    const value = (scope as Record<string, unknown>)[key]
    const canonicalKey = scopeText(key)
    // A JSON object may hold `__proto__` as an own key; assigning it would change the result's prototype instead.
    if (canonicalKey === "__proto__") throw new GrantInputError("a scope key is reserved")
    if (typeof value === "string") {
      out[canonicalKey] = scopeText(value)
      continue
    }
    if (!Array.isArray(value)) throw new GrantInputError("a scope value is neither a string nor a list of strings")
    if (value.length === 0) throw new GrantInputError("a scope list is empty")
    const items: string[] = []
    for (const item of value) {
      if (typeof item !== "string") throw new GrantInputError("a scope list holds a value that is not a string")
      items.push(scopeText(item))
    }
    out[canonicalKey] = [...new Set(items)].sort()
  }
  return out
}
