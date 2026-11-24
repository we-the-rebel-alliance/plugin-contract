/**
 * Small shape checks shared by the token, the claims and the verifier's request.
 *
 * Every check answers a reason, never a value: a reason is safe to log and can be handed to a person. The reasons are
 * ours, so no token content can reach a log or a message through them.
 */

/** Characters a claim, an action id or a scope key never holds: C0 and C1 controls. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** An account alias: contract §5. */
const ACCOUNT_ALIAS = /^[a-z][a-z0-9_]{0,31}$/

/** A key id: letters, digits, dot, underscore, colon and hyphen, starting with a letter or a digit. */
const KID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/

/** A single-use key: the same alphabet as a key id, at most 128 characters. */
const JTI = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/

/** A hash as the manifest and input digests write it. */
const HASH = /^sha256:[0-9a-f]{64}$/

/** A plain object: a JSON object, never an array, a class instance or a built-in such as a Map. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** Why a string is not well-formed Unicode, or nothing: a lone surrogate is refused, never replaced. */
export function surrogateProblem(text: string): string | undefined {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return "holds a lone surrogate"
      index++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return "holds a lone surrogate"
    }
  }
  return undefined
}

/** Why a claim is not a plain text value, or nothing. `what` names it, as in "the audience". */
export function textProblem(value: unknown, what: string, max = 200): string | undefined {
  if (typeof value !== "string") return `${what} is not a string`
  if (value.length === 0) return `${what} is empty`
  if (value.length > max) return `${what} is over ${max} characters`
  if (CONTROL.test(value)) return `${what} holds a control character`
  const surrogate = surrogateProblem(value)
  if (surrogate !== undefined) return `${what} ${surrogate}`
  return undefined
}

/** Why an account is not an alias, or nothing. */
export function accountProblem(value: unknown): string | undefined {
  const text = textProblem(value, "the account", 32)
  if (text !== undefined) return text
  return ACCOUNT_ALIAS.test(value as string) ? undefined : "the account is not an alias: lowercase letters, digits and underscores, starting with a letter"
}

/** Why a key id is not usable, or nothing. */
export function kidProblem(value: unknown): string | undefined {
  const text = textProblem(value, "the key id", 64)
  if (text !== undefined) return text
  return KID.test(value as string) ? undefined : "the key id holds a character other than letters, digits, dot, underscore, colon or hyphen"
}

/** Why a single-use key is not usable, or nothing. */
export function jtiProblem(value: unknown): string | undefined {
  const text = textProblem(value, "the grant id", 128)
  if (text !== undefined) return text
  return JTI.test(value as string) ? undefined : "the grant id holds a character other than letters, digits, dot, underscore, colon or hyphen"
}

/** Why a hash is not `sha256:<64 lowercase hex digits>`, or nothing. */
export function hashProblem(value: unknown, what: string): string | undefined {
  return typeof value === "string" && HASH.test(value) ? undefined : `${what} is not a sha256:<64 lowercase hex digits> hash`
}
