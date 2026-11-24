import { type ErrorCode } from "../internal/events.js";
/** A call that did not run, or whose answer was refused. */
export interface Refusal {
    readonly code: ErrorCode;
    /** What happened, without the code or a final full stop. */
    readonly what: string;
    /** What to do next, one sentence. */
    readonly next: string;
    /** `CODE: what happened. Next step: what to do.` */
    readonly message: string;
}
/** A refusal a handler may throw; the register reads its `refusal`. */
export declare class RegisterError extends Error {
    readonly refusal: Refusal;
    constructor(refusal: Refusal);
}
/** Build a refusal, keeping exactly one full stop between its parts. */
export declare function refusal(code: ErrorCode, what: string, next: string): Refusal;
/** Throw a refusal. */
export declare function refuse(code: ErrorCode, what: string, next: string): never;
/**
 * The refusal an error carries, or undefined for an error with no contract code. `AUTH_REQUIRED` is the old transport's
 * sign-in code and maps to `NEEDS_SIGN_IN`; a code the table does not hold is left undefined, so the caller's fallback
 * is `UNAVAILABLE`.
 */
export declare function refusalOf(error: unknown): Refusal | undefined;
/** The one-line reason of an unknown failure, redacted and cut to 160 characters. */
export declare function reasonOf(error: unknown): string;
