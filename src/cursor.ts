/**
 * The cursor codec: opaque, versioned, and bound to `(plugin, capability, account, scope)` (contract §7).
 *
 * A cursor is base64url JSON of at most 1024 characters. It carries a 16-hex-digit hash of its canonical binding, so
 * a cursor from another plugin, source, account or scope is refused as `foreign`, never restarted. The plugin still
 * adds what only it knows, such as an owner hash, to the state.
 *
 * Dependency-free: `node:crypto` and `Buffer` only.
 */
import { createHash } from "node:crypto"

/** The most characters a cursor takes. */
export const MAX_CURSOR_LENGTH = 1024

/** The cursor format's version. */
export const CURSOR_VERSION = 2

/** The keys the codec keeps for itself: a plugin's state never uses them. */
export const RESERVED_STATE_KEYS: readonly string[] = ["v", "s", "b"]

const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

const BASE64URL = /^[A-Za-z0-9_-]+$/

function parse(cursor: string): Record<string, unknown> | undefined {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH || !BASE64URL.test(cursor)) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"))
    return plainObject(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** A scope as a source receives it: each key a value or a list of values (labels, channels, repositories). */
export type Scope = Readonly<Record<string, string | readonly string[]>>

/** What a cursor is bound to. `scope` absent or `{}` is the whole source. */
export interface CursorBinding {
  /** The plugin's id (`gws`), as its manifest names it. */
  readonly plugin: string
  /** The source's name within the plugin (`gmail`), as `events_list`'s `source` input names it. */
  readonly source: string
  /** The account the source read, `default` included. */
  readonly account: string
  readonly scope?: Scope
}

/**
 * A scope in one canonical form: keys sorted, each list's values sorted and without repeats, a one-value list kept as
 * a list (so `{label: "A"}` and `{label: ["A"]}` differ, as the source may read them differently). Empty lists and
 * an empty scope stay. Throws on a value that is not a string or a list of strings.
 */
export function canonicalScope(scope: Scope | undefined): Record<string, string | string[]> {
  if (scope === undefined) return {}
  if (!plainObject(scope)) throw new Error("cursor: a scope must be an object")
  const out: Record<string, string | string[]> = {}
  for (const key of Object.keys(scope).sort()) {
    const value = scope[key]
    if (typeof value === "string") out[key] = value
    else if (Array.isArray(value) && value.every((item) => typeof item === "string")) out[key] = [...new Set(value as string[])].sort()
    else throw new Error(`cursor: the scope key "${key}" must be a string or a list of strings`)
  }
  return out
}

/** The binding's hash: the first 16 hex digits of SHA-256 over its canonical JSON. */
export function bindingHash(binding: CursorBinding): string {
  const canonical = JSON.stringify([binding.plugin, binding.source, binding.account, canonicalScope(binding.scope)])
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16)
}

/**
 * A cursor for `binding` holding `state`. Throws when the state uses a reserved key (`v`, `s`, `b`) or the cursor
 * would be longer than 1024 characters: both are bugs in the source.
 */
export function encodeBoundCursor(binding: CursorBinding, state: Readonly<Record<string, unknown>>): string {
  const reserved = Object.keys(state).find((key) => RESERVED_STATE_KEYS.includes(key))
  if (reserved !== undefined) throw new Error(`cursor: the state key "${reserved}" is reserved`)
  const cursor = Buffer.from(JSON.stringify({ v: CURSOR_VERSION, s: binding.source, b: bindingHash(binding), ...state }), "utf8").toString("base64url")
  if (cursor.length > MAX_CURSOR_LENGTH) throw new Error(`cursor: a cursor for ${binding.plugin}/${binding.source} is ${cursor.length} characters, over ${MAX_CURSOR_LENGTH}`)
  return cursor
}

/** Why a cursor did not decode. `malformed`: not a cursor at all. `foreign`: another binding's. */
export type CursorRefusal = "malformed" | "foreign"

export type DecodedCursor = { readonly ok: true; readonly state: Record<string, unknown> } | { readonly ok: false; readonly reason: CursorRefusal }

/**
 * The state `encodeBoundCursor` stored for `binding`. A cursor of another plugin, source, account or scope is
 * `foreign`; one that is not base64url JSON of an object is `malformed`. Either refusal is `CURSOR_INVALID` to the
 * caller.
 *
 * The binding hash catches mix-ups (a cursor sent to the wrong source, account or scope); it is not a signature. A
 * consumer that holds a cursor can forge another binding's, so a source still checks the cursor's state against what
 * it reads, and the grant, not the cursor, decides what may be read.
 */
export function decodeBoundCursor(binding: CursorBinding, cursor: string): DecodedCursor {
  const parsed = parse(cursor)
  if (!parsed) return { ok: false, reason: "malformed" }
  if (parsed["v"] !== CURSOR_VERSION || parsed["s"] !== binding.source || parsed["b"] !== bindingHash(binding)) return { ok: false, reason: "foreign" }
  const { v: _v, s: _s, b: _b, ...state } = parsed
  return { ok: true, state }
}
