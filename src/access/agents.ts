/**
 * Generating access into every agent's rules, and detecting an agent that lacks them (contract §6 and §11).
 *
 *   const access = await applyAccess(ctx, { manifest, options })
 *   status.unguardedAgents = unguardedAgents((await ctx.agent.list()).data, access.rules)
 *
 * OpenCode appends agent rules after the base policy and the last matching rule wins. The generated rules are inserted
 * after each agent's base allow (the first `*` on `*` with effect `allow`), so a later rule the person or an app adds
 * still decides one method, and the base allow does not override a generated `ask` or `deny`.
 *
 * `applyAccess` patches the agents that exist when the plugin loads. An agent registered later does not receive the
 * rules, because OpenCode gives a transform no event for a later agent; `unguardedAgents` names it for status, and the
 * plugin never patches it behind the person's back. Agent rules are appended after global rules
 * (`core/src/config/plugin/agent.ts:63-72`), so a later config `"*": "allow"` is exactly the widening
 * `unguardedAgents` reports.
 */
import type { Plugin } from "@opencode/plugin"
import { accountsOf } from "../accounts.ts"
import type { Checked } from "../internal/checked.ts"
import type { Manifest } from "../manifest.ts"
import { evaluate, matches, type PermissionRule } from "./fences.ts"
import { accessLevel, aliasesFrom, rulesFor, type AccessLevel } from "./rules.ts"

/** An agent as the transforms and status see it: its id and its ordered rules. */
export interface AgentLike {
  readonly id: string
  readonly permissions: readonly PermissionRule[]
}

/** The editor inside `ctx.agent.transform`, as this module uses it. The host's editor is wider. */
export interface AgentEditor {
  list(): readonly AgentLike[]
  update(id: string, update: (agent: { permissions: PermissionRule[] }) => void): void
}

/** The part of the plugin context access uses: the agent transform. */
export interface AccessContext {
  readonly agent: { readonly transform: (callback: (editor: AgentEditor) => void) => Promise<unknown> }
}

/**
 * The host's context is assignable to this module's: checked at compile time, so a plugin passes `ctx` as it is. The
 * `@opencode/plugin` types stay out of the published declarations (`npm run check:dist`).
 */
const hostContextIsAccessContext = (context: Pick<Plugin.Context, "agent">): AccessContext => context
void hostContextIsAccessContext

/** What access generates for one plugin. */
export interface AccessRegistration {
  /** The level the `access` option names, or `all`. */
  readonly level: AccessLevel
  /** The declared aliases the MCP rules cover, in the options' order. */
  readonly aliases: readonly string[]
  /** The generated rules, one per method (and one per alias for pass-through MCP tools). */
  readonly rules: readonly PermissionRule[]
  /** Why the rules could not be generated, one sentence each. Empty when they were. */
  readonly problems: readonly string[]
  /** Gives the transform back to OpenCode. */
  dispose(): Promise<void>
}

/** What `applyAccess` reads: the manifest and the plugin's options (which carry `access` and `accounts`). */
export interface AccessRequest {
  readonly manifest: Manifest
  readonly options?: Readonly<Record<string, unknown>> | undefined
}

function sameRule(held: PermissionRule, rule: PermissionRule): boolean {
  return held.action === rule.action && held.resource === rule.resource && held.effect === rule.effect
}

/**
 * The rules with `additions` inserted after the base allow and before the agent's own rules. An addition the agent
 * already holds for the same action, resource and effect is not added twice.
 */
export function withRules(permissions: readonly PermissionRule[], additions: readonly PermissionRule[]): PermissionRule[] {
  const missing = additions.filter((addition) => !permissions.some((held) => sameRule(held, addition)))
  if (missing.length === 0) return [...permissions]
  const base = permissions.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
  const at = base + 1
  return [...permissions.slice(0, at), ...missing, ...permissions.slice(at)]
}

const rank = (effect: PermissionRule["effect"]): number => (effect === "allow" ? 2 : effect === "ask" ? 1 : 0)

/** A concrete action a wildcard rule speaks about, for the last-match check: `demo-work_*` becomes `demo-work_x`. */
const concrete = (action: string): string => action.replaceAll("*", "x").replaceAll("?", "x")

/**
 * True when the agent's rules no longer give `rule` the effect it generated. OpenCode's last matching rule wins, so a
 * later `{ action: "*", resource: "*", effect: "allow" }` appended by configuration widens a generated `ask` or `deny`;
 * a later narrower rule is the person's choice and does not unguard the agent.
 */
function overridden(agent: AgentLike, rule: PermissionRule): boolean {
  const index = agent.permissions.findIndex((held) => sameRule(held, rule))
  if (index === -1) return true
  const action = concrete(rule.action)
  if (rank(evaluate(agent.permissions, action, rule.resource)) > rank(rule.effect)) return true
  // A later rule on a specific resource can widen the generated rule for that resource even though `*` still reads the
  // generated effect. Name the agent too; a narrower later rule is the person's choice.
  for (const later of agent.permissions.slice(index + 1)) {
    if (rank(later.effect) <= rank(rule.effect)) continue
    if (later.resource === "*") continue
    if (matches(later.action, action) || matches(rule.action, concrete(later.action))) return true
  }
  return false
}

/**
 * The agent ids whose rules no longer give every generated rule its effect. An agent registered after the plugin
 * loaded, or one whose later rule widens a generated `ask` or `deny`, is named here; status reports it and the plugin
 * never patches it.
 */
export function unguardedAgents(agents: readonly AgentLike[], rules: readonly PermissionRule[]): readonly string[] {
  return agents
    .filter((agent) => rules.some((rule) => overridden(agent, rule)))
    .map((agent) => agent.id)
    .sort()
}

/** The accounts the plugin declares, in the options' order; refused when the options are not a valid accounts map. */
function aliasesOf(manifest: Manifest, options: Readonly<Record<string, unknown>>): Checked<readonly string[]> {
  if (manifest.accounts === undefined) return { ok: true, value: ["default"] }
  const plan = accountsOf(manifest, options)
  if (!plan.ok) return plan
  const aliases = plan.value.accounts.map((account) => account.alias)
  return { ok: true, value: aliases.length === 0 ? aliasesFrom(options) : aliases }
}

/**
 * Generates the rules from `access` and `methods`, then inserts them into every agent the host has. Never throws for a
 * bad option or a failing transform: the problems are returned for status, and `register` refuses to start when they
 * are not empty.
 */
export async function applyAccess(context: AccessContext, request: AccessRequest): Promise<AccessRegistration> {
  const options = request.options ?? {}
  const level = accessLevel(options)
  const aliases = aliasesOf(request.manifest, options)
  const problems: string[] = []
  if (!level.ok) problems.push(...level.problems.map((problem) => `OPTIONS_INVALID: ${problem}. Next step: set access to all, ask-changes or read-only.`))
  if (!aliases.ok) problems.push(...aliases.problems.map((problem) => `OPTIONS_INVALID: ${problem}. Next step: fix the accounts option.`))
  if (!level.ok || !aliases.ok) {
    return { level: "all", aliases: ["default"], rules: [], problems, dispose: async () => {} }
  }
  const rules = rulesFor(request.manifest, level.value, aliases.value)
  let registration: { dispose(): Promise<void> } | undefined
  try {
    registration = (await context.agent.transform((editor) => {
      for (const agent of editor.list()) {
        const updated = withRules(agent.permissions, rules)
        if (updated.length !== agent.permissions.length) editor.update(agent.id, (target) => void (target.permissions = updated))
      }
    })) as { dispose(): Promise<void> }
  } catch (error) {
    problems.push(`UNAVAILABLE: the access rules could not be added to the agents: ${error instanceof Error ? error.message : String(error)}. Next step: check the agent configuration and reload the plugin.`)
  }
  return {
    level: level.value,
    aliases: aliases.value,
    rules,
    problems,
    async dispose() {
      await registration?.dispose().catch(() => undefined)
    },
  }
}
