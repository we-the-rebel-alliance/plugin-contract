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
 * A method's `effect` may only narrow the table: `ask` asks where the table allows, `deny` turns it off. It can never
 * widen: there is no `allow`. The rules are inserted after each agent's base allow, in an order OpenCode's last-match
 * wins can read: a wildcard rule (`mcp:*`) comes before a specific one (`mcp:send_message`), so the specific method
 * always decides.
 */
import { DEFAULT_ALIAS, isAlias } from "../accounts/alias.ts"
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

/**
 * OpenCode 2.4.1's tool-name normalisation: every character outside letters, digits, `_` and `-` becomes `_`
 * (`core/src/tool/runtime.ts:300`; the installed core's `chunks/model-resolver-6zneq7kt.js:220-221`).
 */
export function normalizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_")
}

/**
 * The permission action of an MCP tool on `server`, exactly as OpenCode builds its effective tool name: the server is
 * the namespace with dots replaced by underscores, then `_` and the normalised tool name
 * (`core/src/tool/runtime.ts:300`). `mcp:*` keeps its wildcard: server `demo-work` yields `demo-work_*`.
 */
export function toolAction(server: string, tool: string): string {
  const namespace = server.replaceAll(".", "_")
  return tool === "*" ? `${namespace}_*` : `${namespace}_${normalizeToolName(tool)}`
}

/** The effect a method's class and `effect` give under `level`. `effect` only narrows: ask or deny. */
export function effectFor(method: Pick<MethodItem, "class" | "effect">, level: AccessLevel): PermissionRule["effect"] {
  if (method.effect === "deny") return "deny"
  const base: PermissionRule["effect"] = method.class === "read" ? "allow" : level === "all" ? "allow" : level === "ask-changes" ? "ask" : "deny"
  return method.effect === "ask" && base === "allow" ? "ask" : base
}

/**
 * The integration or MCP server name of `alias` (§3, §5): `<name>` for `default`, `<name>-<alias>` otherwise. Refused
 * when `alias` is not one of the plugin's declared aliases, so a rule can never be derived for an account that does not
 * exist. This is the one per-alias derivation: `operationRule`, the access rules and the conformance kit all use it.
 */
export function serverOf(name: string, alias: string, aliases: readonly string[]): Checked<string> {
  if (!isAlias(alias)) return { ok: false, problems: [`"${alias}" is not an account alias: lowercase letters and digits, starting with a letter`] }
  if (!aliases.includes(alias)) return { ok: false, problems: [`the account alias "${alias}" is not one this plugin declares`] }
  return { ok: true, value: alias === DEFAULT_ALIAS ? name : `${name}-${alias}` }
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
 *
 * Wildcard rules come first and specific ones after, because OpenCode's last matching rule wins: a later `mcp:*` must
 * never override a `mcp:send_message`. Two declarations of the same action and resource keep the last manifest entry,
 * as the manifest's own order says.
 */
export function rulesFor(manifest: Manifest, level: AccessLevel, aliases: readonly string[] = [DEFAULT_ALIAS]): readonly PermissionRule[] {
  const name = manifest.plugin.name
  const declared = aliases.length === 0 ? [DEFAULT_ALIAS] : aliases
  const methods = Object.entries(manifest.methods)
  // `mcp:*` is a wildcard action; it goes before every specific MCP tool and every normal method.
  const ordered = [...methods].sort(([left], [right]) => Number(!left.endsWith(":*")) - Number(!right.endsWith(":*")))
  const rules: PermissionRule[] = []
  const push = (rule: PermissionRule) => {
    const existing = rules.findIndex((held) => held.action === rule.action && held.resource === rule.resource)
    if (existing !== -1) rules.splice(existing, 1)
    rules.push(rule)
  }
  for (const [method, item] of ordered) {
    const effect = effectFor(item, level)
    if (isMcpMethod(method)) {
      const tool = method.slice("mcp:".length)
      for (const alias of declared) {
        const server = serverOf(name, alias, declared)
        if (!server.ok) throw new Error(`access: ${server.problems.join("; ")}`)
        push({ action: toolAction(server.value, tool), resource: "*", effect })
      }
      continue
    }
    push({ action: methodAction(name, method), resource: "*", effect })
  }
  return rules
}
