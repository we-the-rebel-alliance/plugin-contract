/**
 * The errors the host harness reports: one code, one sentence and a next step, in the contract's shape.
 *
 * A harness failure is the kit's, not a plugin's, so it never uses a contract code a plugin could answer. A test can
 * match the code and the next step, and a conformance finding names both.
 */
export declare class HostError extends Error {
    readonly code: string;
    readonly next: string;
    constructor(code: string, message: string, next: string);
}
