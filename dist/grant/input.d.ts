/** A scope as grants carry it: a flat map of key to a value or a list of values. */
export type GrantScope = Readonly<Record<string, string | readonly string[]>>;
/** A value the grant input cannot carry, with a reason that names no value. */
export declare class GrantInputError extends Error {
    constructor(message: string);
}
/**
 * The canonical JSON of a grant input: the exact text a digest binds. Throws `GrantInputError` when the value is not
 * JSON, holds a number outside the safe integers, holds a lone surrogate, nests too deep or is over 64 KiB.
 */
export declare function canonicalJson(value: unknown): string;
/** The input's digest: `sha256:<64 lowercase hex digits>` over the UTF-8 bytes of its canonical JSON. */
export declare function digestInput(input: unknown): string;
/**
 * The scope in canonical form: keys sorted, each list sorted with repeats removed, every key and value a non-empty
 * string. An empty list is refused, because an omitted key and an empty list would both mean "none" and "all".
 * Throws `GrantInputError` when the scope is not a flat map of strings or lists of strings.
 */
export declare function canonicalScope(scope: GrantScope | undefined): GrantScope;
