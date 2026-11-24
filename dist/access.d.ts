/**
 * `access`: the default rules a plugin's `access` option generates, and the fenced session rules a grant compiles to
 * (contract §6 and §13).
 *
 *   const access = await applyAccess(ctx, { manifest, options: ctx.options })
 *   status.unguardedAgents = unguardedAgents((await ctx.agent.list()).data, access.rules)
 *
 * `rulesFor` derives one rule per method from the level and each method's `class` and `effect`: `<name>.<method>` on
 * `*`, and `<server>_<tool>` for a pass-through MCP method. `applyAccess` inserts them into every agent after its base
 * allow. An agent that appears later lacks them; `unguardedAgents` names it for status, and nothing patches it.
 *
 * The grant side (`sessionRules`, `actSessionRules`, `detailRules`, `probeRules`) is here because it is the same rules
 * language: a fenced session denies everything, then allows exactly one grant. `docs/access.md` is the guide.
 */
export { ACCESS_LEVELS, DEFAULT_ACCESS, accessLevel, aliasesFrom, effectFor, isMcpMethod, methodAction, rulesFor, serverOf, toolAction, normalizeToolName, } from "./access/rules.js";
export type { AccessLevel } from "./access/rules.js";
export { applyAccess, unguardedAgents, withRules } from "./access/agents.js";
export type { AccessContext, AccessRegistration, AccessRequest, AgentEditor, AgentLike } from "./access/agents.js";
export { ACCOUNT_PATTERN, accountProblem, actSessionRules, DENY_ALL, detailRules, evaluate, grantCovers, namespaceOf, operationRule, probeRules, sessionRules, } from "./access/fences.js";
export type { ActGrant, ActPhase, Grant, PermissionRule } from "./access/fences.js";
