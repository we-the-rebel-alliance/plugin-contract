/**
 * Account aliases (contract §5): `^[a-z][a-z0-9]{0,31}$`, and `default` for the account with no alias.
 *
 * A hyphen separates a plugin's name from an alias (`slack-work`), so an alias itself has none. An alias is the key of
 * a profile in the `accounts` option, the last segment of an integration or MCP server name, and the first half of a
 * permission resource (`work:conversations.history`).
 */

/** The one alias every plugin's unnamed account uses. */
export const DEFAULT_ALIAS = "default"

/** An alias: one lowercase letter, then up to 31 lowercase letters or digits. No underscore: a hyphen separates names. */
export const ALIAS_PATTERN = /^[a-z][a-z0-9]{0,31}$/

/** True when `value` is an alias. */
export function isAlias(value: unknown): value is string {
  return typeof value === "string" && ALIAS_PATTERN.test(value)
}

/** Why `value` is not an alias, or undefined when it is. `where` names it in the sentence. */
export function aliasProblem(value: unknown, where = "the account alias"): string | undefined {
  if (typeof value !== "string") return `${where} must be a string`
  if (!ALIAS_PATTERN.test(value)) return `${where} must match ${ALIAS_PATTERN.source}: one lowercase letter, then up to 31 lowercase letters or digits`
  return undefined
}
