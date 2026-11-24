/**
 * A read's failure, in the contract's form: `CODE: what happened. Next step: …` (contract §12).
 *
 * The codes are the one error table in `events` (`ERROR_CODES`). A plugin's own code is read through `canonicalCode`;
 * a code the table does not hold is `UNAVAILABLE`.
 */
import { canonicalCode, ERROR_CODES, type ErrorCode } from "./events.ts"

/** The codes a read answers: the events table. */
export const FAILURE_CODES = ERROR_CODES
export type FailureCode = ErrorCode

/** A read that did not happen, or whose answer was refused. */
export interface ReadFailure {
  readonly code: FailureCode
  /** `CODE: what happened. Next step: …`. */
  readonly message: string
  readonly next: string
  /** With RATE_LIMITED: when to try again. */
  readonly retryAfterSec?: number
}

export function failure(code: FailureCode, what: string, next: string, retryAfterSec?: number): ReadFailure {
  return {
    code,
    message: `${code}: ${what.replace(/[.\s]+$/, "")}. Next step: ${next}`,
    next,
    ...(retryAfterSec === undefined ? {} : { retryAfterSec }),
  }
}

/**
 * A plugin's or a host's error as a read failure: its `code` (or the code its message starts with) when the contract
 * knows it; anything else is UNAVAILABLE, with the message's first line.
 *
 * A plugin's `INPUT_INVALID` or `SOURCE_UNKNOWN` (a malformed input, or a source the plugin does not have) passes
 * through as itself. Trying again will not help, so its fallback next step says to compare the installed plugin with
 * the manifest rather than to try again.
 */
export function failureFromError(error: unknown): ReadFailure {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {}
  const data = typeof record["data"] === "object" && record["data"] !== null ? (record["data"] as Record<string, unknown>) : {}
  const message = typeof record["message"] === "string" ? record["message"] : String(error)
  const raw = [record["code"], data["code"], /^([A-Z][A-Z_]+):/.exec(message)?.[1]].find((code): code is string => typeof code === "string")
  const canonical = raw === undefined ? undefined : canonicalCode(raw)
  const refusedInput = canonical === "INPUT_INVALID" || canonical === "SOURCE_UNKNOWN"
  const code = canonical !== undefined && (FAILURE_CODES as readonly string[]).includes(canonical) ? (canonical as FailureCode) : undefined
  const first = message.split(/\r?\n/, 1)[0]!.slice(0, 300)
  const fallback = refusedInput
    ? "Check the installed plugin against its manifest; if they match, report it to the plugin's maintainers."
    : "Try again later; if it keeps failing, check the plugin's status."
  const next = typeof data["next"] === "string" ? data["next"] : (/Next step: (.*)$/.exec(first)?.[1] ?? fallback)
  const what = first.replace(/^[A-Z][A-Z_]+:\s*/, "").replace(/\s*Next step:.*$/, "")
  const retry = typeof record["retryAfterSec"] === "number" ? record["retryAfterSec"] : typeof data["retryAfterSec"] === "number" ? data["retryAfterSec"] : undefined
  return failure(code ?? "UNAVAILABLE", what || "the read failed", next, retry)
}
