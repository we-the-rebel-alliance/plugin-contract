/**
 * A strict JSON reader for a grant's header and claims.
 *
 * `JSON.parse` keeps the last of two duplicate keys, so two readers can see one signed document differently. A grant
 * therefore refuses duplicate keys at any depth before anything reads them, exactly as `docs/grant.md` promises. This
 * reader is small and does no I/O; it is not a general-purpose JSON library.
 */

/** What the header or the claims reader should answer for a document outside the rules. */
export type StrictJsonResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly reason: string }

/** The most objects or arrays a token's header or claims may nest; a token is at most 8 KiB. */
const MAX_JSON_DEPTH = 64

class StrictJsonError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StrictJsonError"
  }
}

const NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/

/**
 * Reads `text` as JSON, refusing duplicate object keys at any depth. `what` names the document in a reason, as in
 * "the grant's header", so the caller can answer its own code without leaking any value.
 */
export function strictJson(text: string, what: string): StrictJsonResult {
  let index = 0

  const fail = (detail: string): never => {
    throw new StrictJsonError(`${what} ${detail}`)
  }
  const duplicate = (): never => {
    throw new StrictJsonError(`${what} holds a duplicate key`)
  }
  const skip = (): void => {
    while (index < text.length) {
      const character = text[index]
      if (character === " " || character === "\t" || character === "\n" || character === "\r") index++
      else break
    }
  }
  const parseString = (): string => {
    if (text[index] !== '"') fail("is not JSON")
    const start = index
    index++
    while (index < text.length) {
      const code = text.charCodeAt(index)
      if (code === 0x22) {
        index++
        try {
          return JSON.parse(text.slice(start, index)) as string
        } catch {
          return fail("is not JSON")
        }
      }
      if (code === 0x5c) {
        index += 2
        continue
      }
      if (code < 0x20) fail("is not JSON")
      index++
    }
    return fail("is not JSON")
  }
  const parseNumber = (): number => {
    const match = NUMBER.exec(text.slice(index))
    if (match === null) return fail("is not JSON")
    index += match[0].length
    return Number(match[0])
  }
  const literal = (word: string, value: unknown): unknown => {
    if (!text.startsWith(word, index)) fail("is not JSON")
    index += word.length
    return value
  }
  const parseArray = (depth: number): unknown[] => {
    if (depth > MAX_JSON_DEPTH) fail("nests too deep")
    index++
    const out: unknown[] = []
    skip()
    if (text[index] === "]") {
      index++
      return out
    }
    while (true) {
      out.push(parseValue(depth + 1))
      skip()
      if (text[index] === ",") {
        index++
        continue
      }
      if (text[index] === "]") {
        index++
        return out
      }
      fail("is not JSON")
    }
  }
  const parseObject = (depth: number): Record<string, unknown> => {
    if (depth > MAX_JSON_DEPTH) fail("nests too deep")
    index++
    const out: Record<string, unknown> = Object.create(null)
    const keys = new Set<string>()
    skip()
    if (text[index] === "}") {
      index++
      return out
    }
    while (true) {
      skip()
      const key = parseString()
      if (keys.has(key)) duplicate()
      keys.add(key)
      skip()
      if (text[index] !== ":") fail("is not JSON")
      index++
      out[key] = parseValue(depth + 1)
      skip()
      if (text[index] === ",") {
        index++
        continue
      }
      if (text[index] === "}") {
        index++
        return out
      }
      fail("is not JSON")
    }
  }
  const parseValue = (depth: number): unknown => {
    skip()
    const character = text[index]
    if (character === "{") return parseObject(depth + 1)
    if (character === "[") return parseArray(depth + 1)
    if (character === '"') return parseString()
    if (character === "t") return literal("true", true)
    if (character === "f") return literal("false", false)
    if (character === "n") return literal("null", null)
    if (character !== undefined && (character === "-" || (character >= "0" && character <= "9"))) return parseNumber()
    return fail("is not JSON")
  }

  try {
    skip()
    const value = parseValue(1)
    skip()
    if (index !== text.length) fail("is not JSON")
    return { ok: true, value }
  } catch (error) {
    if (error instanceof StrictJsonError) return { ok: false, reason: error.message }
    throw error
  }
}
