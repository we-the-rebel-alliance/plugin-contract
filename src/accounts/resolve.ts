/**
 * Resolving the `account` of a call (contract §5).
 *
 * Every method declared `accounts: "optional"` takes an `account`. With one account it may be left out; with more than
 * one, leaving it out is `ACCOUNT_REQUIRED`, whose next step lists the aliases. An alias the plugin does not have is
 * `ACCOUNT_UNKNOWN`. A plugin that signs in to nothing has no aliases; a call may still leave `account` out, and its
 * internal account is `default`.
 */
import type { AccountProfile } from "./profiles.ts"
import { DEFAULT_ALIAS } from "./alias.ts"

/** Why an account could not be resolved. */
export type AccountCode = "ACCOUNT_REQUIRED" | "ACCOUNT_UNKNOWN"

/** The alias a call runs as, or the code and the next step for a refusal. */
export type ResolvedAccount =
  | { readonly ok: true; readonly alias: string }
  | { readonly ok: false; readonly code: AccountCode; readonly what: string; readonly next: string }

/** The aliases as a sentence lists them: `work, personal or family`. */
function listOf(aliases: readonly string[]): string {
  if (aliases.length === 0) return "none"
  if (aliases.length === 1) return aliases[0]!
  return `${aliases.slice(0, -1).join(", ")} or ${aliases.at(-1)}`
}

/** The alias for a call, or `ACCOUNT_REQUIRED` / `ACCOUNT_UNKNOWN` with a next step that names the aliases. */
export function resolveAccount(accounts: readonly AccountProfile[], input: { readonly account?: unknown } = {}): ResolvedAccount {
  const aliases = accounts.map((account) => account.alias)
  const named = input.account
  if (named !== undefined && named !== null) {
    if (typeof named !== "string" || !aliases.includes(named)) {
      return {
        ok: false,
        code: "ACCOUNT_UNKNOWN",
        what: typeof named === "string" ? `this plugin has no account "${named}"` : "account must be an alias, such as work",
        next: aliases.length === 0 ? "Leave account out: this plugin signs in to no accounts." : `Pass account, one of: ${aliases.join(", ")}.`,
      }
    }
    return { ok: true, alias: named }
  }
  if (accounts.length === 0) return { ok: true, alias: DEFAULT_ALIAS }
  if (accounts.length === 1) return { ok: true, alias: accounts[0]!.alias }
  return {
    ok: false,
    code: "ACCOUNT_REQUIRED",
    what: `this plugin has ${accounts.length} accounts and the call names none`,
    next: `Pass account, one of: ${aliases.join(", ")}.`,
  }
}

/** The aliases as a refusal's next step lists them. Exported for a plugin's own `ACCOUNT_REQUIRED`. */
export function aliasesSentence(accounts: readonly AccountProfile[]): string {
  return `Pass account, one of: ${listOf(accounts.map((account) => account.alias))}.`
}
