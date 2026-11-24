/**
 * The README's errors table. The codes are the contract's one table (`ERROR_CODES`, contract §12); the kit writes what
 * each code means for a person reading a plugin's README. A plugin's own code is added beside the table by hand until
 * the manifest can declare one.
 */
import { ERROR_CODES } from "../events.ts"

/** What each contract code means, in the words a README uses. */
export const ERROR_MEANINGS: Readonly<Record<string, string>> = Object.freeze({
  NEEDS_SIGN_IN: "The account needs sign-in before this call can run.",
  SCOPE_MISSING: "The account has not confirmed a scope this call needs.",
  ACCOUNT_REQUIRED: "The plugin has more than one account, and the call named none.",
  ACCOUNT_UNKNOWN: "The call named an account alias the plugin does not have.",
  ACCOUNT_MISMATCH: "The account is not the one the grant or cursor belongs to.",
  CURSOR_INVALID: "The cursor is not one this plugin issued, or it was bound to other values.",
  CURSOR_EXPIRED: "The cursor is too old; read again from the restart the error names.",
  RATE_LIMITED: "The provider asked the plugin to wait; the error says how long.",
  BUDGET_EXCEEDED: "The account's budget for this provider is spent.",
  SOURCE_DISABLED: "The source is turned off in the plugin's options.",
  TOO_LARGE: "The answer is larger than the source's byte limit.",
  INPUT_INVALID: "The input does not match the method's schema.",
  SOURCE_UNKNOWN: "The plugin has no source by that id.",
  SCHEMA_VIOLATION: "The provider's answer does not fit the contract's shape.",
  PERMISSION_DENIED: "The person's grant, or the plugin's access setting, does not allow this call.",
  PLAN_INVALID: "The plan is unknown, expired, or not this method's.",
  GRANT_INVALID: "The action grant is malformed, expired, already used, or for another manifest or account.",
  HOST_UNTESTED: "The plugin does not run on this OpenCode release and refused cleanly.",
  OPTIONS_INVALID: "The plugin's options do not validate; status names the option.",
  UNAVAILABLE: "The provider could not be reached, or answered something the plugin does not understand.",
})

/** The errors table, one row per contract code, in the contract's order. */
export function errorsTable(): string {
  return [
    "| Code | What it means |",
    "| --- | --- |",
    ...ERROR_CODES.map((code) => `| \`${code}\` | ${ERROR_MEANINGS[code] ?? "See the contract's error table."} |`),
  ].join("\n")
}
