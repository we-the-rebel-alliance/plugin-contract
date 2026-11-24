/**
 * The default access rules a plugin's `access` option generates (contract §6).
 *
 * Every method is one rule: action `<name>.<method>` on `*`, with the effect the person's level and the method's class
 * and `effect` decide. A pass-through MCP method (`mcp:<tool>` or `mcp:*`) is one rule per account, on the MCP tool's
 * own action `<server>_<tool>`, because that is what OpenCode checks when the server's tool runs (§3, §5).
 *
 *   level       read     any other class
 *   all         allow    allow
 *   ask-changes allow    ask
 *   read-only   allow    deny
 *
 * A method's `effect` is the person's per-method choice and wins over the table: `allow` runs, `ask` asks, `deny` is
 * off. The rules are inserted after each agent's base allow, so a later agent or session rule can narrow or widen one
 * method without touching the plugin's setting; the plugin's setting is the ceiling a host may only narrow.
 */
import { DEFAULT_ALIAS, isAlias } from "../accounts/alias.ts"
import { accountName } from "../accounts/names.ts"
import type { Checked } from "../internal/checked.ts"
import type { Manifest, MethodItem } from "../manifest.ts"
import type { PermissionRule } from "./fences.ts"

/** The three levels of the `access` option (contract §6), in the order the table lists them. */
export const ACCESS_LEVELS = ["all", "ask-changes", "read-only"] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

/** The level when the option is absent. */
export const DEFAULT_ACCESS: AccessLevel = "all"

/** The `access` option, or `all` when it is absent; refused when it is not one of the three levels. */
export function accessLevel(options: Readonly<Record<string, unknown>> = {}): Checked<AccessLevel> {
  const value = options["access"]
  if (value === undefined) return { ok: true, value: DEFAULT_ACCESS }
  if (typeof value === "string" && (ACCESS_LEVELS as readonly string[]).includes(value)) return { ok: true, value: value as AccessLevel }
  return { ok: false, problems: [`options.access: must be one of ${ACCESS_LEVELS.join(", ")}`] }
}

/** True for a manifest method that classifies a pass-through MCP tool (`mcp:<tool>` or `mcp:*`). */
export function isMcpMethod(method: string): boolean {
  return method.startsWith("mcp:")
}

/** The permission action of a plugin's own method (contract §3): `<name>.<method>`. */
export function methodAction(name: string, method: string): string {
  return `${name}.${method}`
}

/** The effect a method's class and `effect` give under `level`. */
export function effectFor(method: Pick<MethodItem, "class" | "effect">, level: AccessLevel): PermissionRule["effect"] {
  if (method.effect !== undefined) return method.effect
  if (method.class === "read") return "allow"
  if (level === "all") return "allow"
  return level === "ask-changes" ? "ask" : "deny"
}

/**
 * The integration or MCP server name of `alias` (§3, §5): `<name>` for `default`, `<name>-<alias>` otherwise. Refused
 * when `alias` is not one of the plugin's declared aliases, so a rule can never be derived for an account that does not
 * exist. This is the one per-alias derivation: `operationRule`, the access rules and the conformance kit all use it.
 */
export function serverOf(name: string, alias: string, aliases: readonly string[]): Checked<string> {
  if (!isAlias(alias)) return { ok: false, problems: [`"${alias}" is not an account alias: lowercase letters, digits and underscores, starting with a letter`] }
  if (!aliases.includes(alias)) return { ok: false, problems: [`the account alias "${alias}" is not one this plugin declares`] }
  return { ok: true, value: accountName(name, alias) }
}

/**
 * The per-alias name without the declared-alias check, for a grant whose account the app already resolved from the
 * manifest. Everything that derives a name from configuration uses `serverOf` instead.
 */
export function serverName(name: string, alias: string): string {
  // The same naming rule as `accounts` (`accountName`), without its alias validation: a grant's account is already the
  // person's confirmed account string, and a fence must not throw while deriving a rule from it.
  return alias === DEFAULT_ALIAS ? name : `${name}-${alias}`
}

/** The declared aliases from the plugin's options, or `default` when the plugin has no accounts option. */
export function aliasesFrom(options: Readonly<Record<string, unknown>> = {}): readonly string[] {
  const raw = options["accounts"]
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [DEFAULT_ALIAS]
  const aliases = Object.keys(raw).filter(isAlias)
  return aliases.length === 0 ? [DEFAULT_ALIAS] : aliases
}

/**
 * The rules `level` generates for `manifest`, one per method and, for pass-through MCP tools, one per alias: every
 * alias gets its own `<server>_<tool>` rule, so a rule for `work` can never reach another alias's tools.
 */
export function rulesFor(manifest: Manifest, level: AccessLevel, aliases: readonly string[] = [DEFAULT_ALIAS]): readonly PermissionRule[] {
  const name = manifest.plugin.name
  const declared = aliases.length === 0 ? [DEFAULT_ALIAS] : aliases
  const rules: PermissionRule[] = []
  // A later declaration of the same action and resource replaces the earlier one, so the last rule stays the winner,
  // as OpenCode reads the list.
  const push = (rule: PermissionRule) => {
    const existing = rules.findIndex((held) => held.action === rule.action && held.resource === rule.resource)
    if (existing !== -1) rules.splice(existing, 1)
    rules.push(rule)
  }
  for (const [method, item] of Object.entries(manifest.methods)) {
    const effect = effectFor(item, level)
    if (isMcpMethod(method)) {
      const tool = method.slice("mcp:".length)
      for (const alias of declared) push({ action: `${serverName(name, alias)}_${tool}`, resource: "*", effect })
      continue
    }
    push({ action: methodAction(name, method), resource: "*", effect })
  }
  return rules
}
