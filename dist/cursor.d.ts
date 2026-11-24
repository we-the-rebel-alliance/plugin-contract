/** The most characters a cursor takes. */
export declare const MAX_CURSOR_LENGTH = 1024;
/** The cursor format's version. */
export declare const CURSOR_VERSION = 2;
/** The keys the codec keeps for itself: a plugin's state never uses them. */
export declare const RESERVED_STATE_KEYS: readonly string[];
/** A scope as a source receives it: each key a value or a list of values (labels, channels, repositories). */
export type Scope = Readonly<Record<string, string | readonly string[]>>;
/** What a cursor is bound to. `scope` absent or `{}` is the whole source. */
export interface CursorBinding {
    /** The plugin's id (`gws`), as its manifest names it. */
    readonly plugin: string;
    /** The source's name within the plugin (`gmail`), as `events_list`'s `source` input names it. */
    readonly source: string;
    /** The account the source read, `default` included. */
    readonly account: string;
    readonly scope?: Scope;
}
/**
 * A scope in one canonical form: keys sorted, each list's values sorted and without repeats, a one-value list kept as
 * a list (so `{label: "A"}` and `{label: ["A"]}` differ, as the source may read them differently). Empty lists and
 * an empty scope stay. Throws on a value that is not a string or a list of strings.
 */
export declare function canonicalScope(scope: Scope | undefined): Record<string, string | string[]>;
/** The binding's hash: the first 16 hex digits of SHA-256 over its canonical JSON. */
export declare function bindingHash(binding: CursorBinding): string;
/**
 * A cursor for `binding` holding `state`. Throws when the state uses a reserved key (`v`, `s`, `b`) or the cursor
 * would be longer than 1024 characters: both are bugs in the source.
 */
export declare function encodeBoundCursor(binding: CursorBinding, state: Readonly<Record<string, unknown>>): string;
/** Why a cursor did not decode. `malformed`: not a cursor at all. `foreign`: another binding's. */
export type CursorRefusal = "malformed" | "foreign";
export type DecodedCursor = {
    readonly ok: true;
    readonly state: Record<string, unknown>;
} | {
    readonly ok: false;
    readonly reason: CursorRefusal;
};
/**
 * The state `encodeBoundCursor` stored for `binding`. A cursor of another plugin, source, account or scope is
 * `foreign`; one that is not base64url JSON of an object is `malformed`. Either refusal is `CURSOR_INVALID` to the
 * caller.
 *
 * The binding hash catches mix-ups (a cursor sent to the wrong source, account or scope); it is not a signature. A
 * consumer that holds a cursor can forge another binding's, so a source still checks the cursor's state against what
 * it reads, and the grant, not the cursor, decides what may be read.
 */
export declare function decodeBoundCursor(binding: CursorBinding, cursor: string): DecodedCursor;
