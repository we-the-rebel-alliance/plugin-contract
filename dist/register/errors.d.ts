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
 * The refusal an error carries, or undefined for an error with no contract code. A code the table does not hold is left
 * undefined, so the caller's fallback is `UNAVAILABLE`; a sign-in must use the table's `NEEDS_SIGN_IN`.
 */
export declare function refusalOf(error: unknown): Refusal | undefined;
/** The refusal a permission assertion's error maps to: its own contract code, or PERMISSION_DENIED. */
export declare function permissionRefusal(error: unknown, what: string): Refusal;
/** The one-line reason of an unknown failure, redacted and cut to 160 characters. */
export declare function reasonOf(error: unknown): string;
