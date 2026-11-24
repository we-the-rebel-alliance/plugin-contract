/**
 * Resolving the `account` of a call (contract §5).
 *
 * Every method declared `accounts: "optional"` takes an `account`. With one account it may be left out; with more than
 * one, leaving it out is `ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias the plugin does not have is
 * `ACCOUNT_UNKNOWN`. A plugin that signs in to nothing has no aliases; a call may still leave `account` out, and its
 * internal account is `default`.
 */
import type { AccountProfile } from "./profiles.js";
/** Why an account could not be resolved. */
export type AccountCode = "ACCOUNT_REQUIRED" | "ACCOUNT_UNKNOWN";
/** The alias a call runs as, or the code and the next step for a refusal. */
export type ResolvedAccount = {
    readonly ok: true;
    readonly alias: string;
} | {
    readonly ok: false;
    readonly code: AccountCode;
    readonly what: string;
    readonly next: string;
};
/** The alias for a call, or `ACCOUNT_REQUIRED` / `ACCOUNT_UNKNOWN` with a next step that names the aliases. */
export declare function resolveAccount(accounts: readonly AccountProfile[], input?: {
    readonly account?: unknown;
}): ResolvedAccount;
/** The aliases as a refusal's next step lists them. Exported for a plugin's own `ACCOUNT_REQUIRED`. */
export declare function aliasesSentence(accounts: readonly AccountProfile[]): string;
