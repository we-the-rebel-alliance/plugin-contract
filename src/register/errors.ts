/**
 * Refusals in the contract's one form (contract §12): `CODE: What happened. Next step: What to do.`
 *
 * A handler may throw a `RegisterError`, or any error carrying `code`, `next` and `what` (or a message that starts with
 * a code). The register maps it to the table: a code the table does not hold is `UNAVAILABLE`, and a sign-in failure
 * uses the contract's own `NEEDS_SIGN_IN`. There is no alias for an older transport's code. An unknown error is
 * `UNAVAILABLE`; both its what and its next step are cut to one line and redacted, so nothing echoes a credential.
 */
import { redactReason } from "../accounts.ts"
import { errorCodeOf, type ErrorCode } from "../internal/events.ts"

/** A call that did not run, or whose answer was refused. */
export interface Refusal {
  readonly code: ErrorCode
  /** What happened, without the code or a final full stop. */
  readonly what: string
  /** What to do next, one sentence. */
  readonly next: string
  /** `CODE: what happened. Next step: what to do.` */
  readonly message: string
}

/** A refusal a handler may throw; the register reads its `refusal`. */
export class RegisterError extends Error {
  readonly refusal: Refusal

  constructor(refusal: Refusal) {
    super(refusal.message)
    this.name = "RegisterError"
    this.refusal = refusal
  }
}

/** Build a refusal, keeping exactly one full stop between its parts. */
export function refusal(code: ErrorCode, what: string, next: string): Refusal {
  const clean = what.replace(/[.\s]+$/, "")
  return { code, what: clean, next, message: `${code}: ${clean}. Next step: ${next}` }
}

/** Throw a refusal. */
export function refuse(code: ErrorCode, what: string, next: string): never {
  throw new RegisterError(refusal(code, what, next))
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/**
 * The refusal an error carries, or undefined for an error with no contract code. A code the table does not hold is left
 * undefined, so the caller's fallback is `UNAVAILABLE`; a sign-in must use the table's `NEEDS_SIGN_IN`.
 */
export function refusalOf(error: unknown): Refusal | undefined {
  if (error instanceof RegisterError) return error.refusal
  if (!plain(error) && !(error instanceof Error)) return undefined
  const record = error as unknown as Record<string, unknown>
  const data = plain(record["data"]) ? record["data"] : {}
  const message = typeof record["message"] === "string" ? record["message"] : String(error)
  const raw = [record["code"], data["code"], /^([A-Z][A-Z0-9_]*):/.exec(message)?.[1]].find((code): code is string => typeof code === "string")
  if (raw === undefined) return undefined
  const code = errorCodeOf(raw)
  if (code === undefined) return undefined
  const next = typeof record["next"] === "string" ? record["next"] : typeof data["next"] === "string" ? data["next"] : undefined
  const fromMessage = /^[A-Z][A-Z0-9_]*:\s*([^]*?)(?:\.\s*Next step:\s*([^]*))?$/.exec(message.split(/\r?\n/, 1)[0] ?? "")
  const what = typeof record["what"] === "string" ? record["what"] : (fromMessage?.[1] ?? message.replace(/^[A-Z][A-Z0-9_]*:\s*/, ""))
  const step = next ?? fromMessage?.[2]
  if (step === undefined || step.trim() === "") return undefined
  return refusal(code, redactReason(what), redactReason(step))
}

/** The refusal a permission assertion's error maps to: its own contract code, or PERMISSION_DENIED. */
export function permissionRefusal(error: unknown, what: string): Refusal {
  const own = refusalOf(error)
  if (own) return own
  const message = (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)) ?? String(error)
  return refusal("PERMISSION_DENIED", `${what} was refused: ${message}`, "Ask the person to allow it, or use a session whose agent allows it.")
}

/** The one-line reason of an unknown failure, redacted and cut to 160 characters. */
export function reasonOf(error: unknown): string {
  return redactReason(error instanceof Error ? error.message : String(error))
}
