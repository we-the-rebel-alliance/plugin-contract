/**
 * A read's failure, in the contract's form: `CODE: what happened. Next step: …` (contract §12).
 *
 * The codes are the one error table in `events` (`ERROR_CODES`). A plugin's own code is read through `errorCodeOf`; a
 * code the table does not hold is `UNAVAILABLE`.
 */
import { type ErrorCode } from "./events.js";
/** The codes a read answers: the events table. */
export declare const FAILURE_CODES: readonly ["NEEDS_SIGN_IN", "SCOPE_MISSING", "ACCOUNT_REQUIRED", "ACCOUNT_UNKNOWN", "ACCOUNT_MISMATCH", "CURSOR_INVALID", "CURSOR_EXPIRED", "RATE_LIMITED", "BUDGET_EXCEEDED", "SOURCE_DISABLED", "TOO_LARGE", "INPUT_INVALID", "SOURCE_UNKNOWN", "SCHEMA_VIOLATION", "PERMISSION_DENIED", "PLAN_INVALID", "PLAN_USED", "GRANT_INVALID", "HOST_UNTESTED", "OPTIONS_INVALID", "UNAVAILABLE"];
export type FailureCode = ErrorCode;
/** A read that did not happen, or whose answer was refused. */
export interface ReadFailure {
    readonly code: FailureCode;
    /** `CODE: what happened. Next step: …`. */
    readonly message: string;
    readonly next: string;
    /** With RATE_LIMITED: when to try again. */
    readonly retryAfterSec?: number;
}
export declare function failure(code: FailureCode, what: string, next: string, retryAfterSec?: number): ReadFailure;
/**
 * A plugin's or a host's error as a read failure: its `code` (or the code its message starts with) when the contract
 * knows it; anything else is UNAVAILABLE, with the message's first line.
 *
 * A plugin's `INPUT_INVALID` or `SOURCE_UNKNOWN` (a malformed input, or a source the plugin does not have) passes
 * through as itself. Trying again will not help, so its fallback next step says to compare the installed plugin with
 * the manifest rather than to try again.
 */
export declare function failureFromError(error: unknown): ReadFailure;
