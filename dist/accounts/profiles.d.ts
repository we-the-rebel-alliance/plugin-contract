import type { Checked } from "../internal/checked.js";
import type { AccountMechanism, Manifest } from "../manifest/types.js";
/** One account: an alias, its profile, and, for a local account, the machine identity. */
export interface AccountProfile {
    readonly alias: string;
    /** The profile the person filled in, checked against the plugin's profile schema. */
    readonly profile?: Readonly<Record<string, unknown>> | undefined;
    /** For `local`: `os-user:<user>@<host>`. */
    readonly identity?: string | undefined;
}
/** The accounts one plugin has, and how it signs in to them. */
export interface AccountsPlan {
    readonly plugin: string;
    /** `integration`, `mcp`, `local`, or undefined when the plugin declares no accounts. */
    readonly mechanism: AccountMechanism | undefined;
    /** In the order the options name them, or one `default` account. Empty when the plugin signs in to nothing. */
    readonly accounts: readonly AccountProfile[];
}
/** The identity of a local account: `os-user:<user>@<host>`. */
export declare function localIdentity(identity?: {
    readonly user?: string;
    readonly host?: string;
}): string;
/**
 * The accounts the plugin has under `options`. Never throws: a bad `accounts` option is a problem, one sentence each,
 * and the rest of the options are ignored.
 */
export declare function accountsOf(manifest: Manifest, options?: Readonly<Record<string, unknown>>): Checked<AccountsPlan>;
/** True when `alias` is one of the plan's accounts. */
export declare function hasAccount(plan: Pick<AccountsPlan, "accounts">, alias: unknown): boolean;
