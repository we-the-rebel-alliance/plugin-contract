/**
 * The fenced session rules a grant compiles to (contract §6 and §13), kept beside the access levels that decide what
 * an agent may call in the first place.
 *
 * Every read or act runs in a session limited to these rules. OpenCode checks each inner tool call a plugin makes
 * against the calling session's rules, and the last matching rule wins, so the rules are a deny of everything, then one
 * allow per action and resource the source declares:
 *
 *   [{ action: "*", resource: "*", effect: "deny" },
 *    { action: "gws.events_list", resource: "*", effect: "allow" },
 *    { action: "gws.read", resource: "ana@example.com:gmail.users.messages.list", effect: "allow" }, …]
 *
 * The method's action is allowed on `*`, because a grant resolves a method before dispatch on `*`. Each operation is
 * allowed as the conformance kit reads it (`operationRule`): a dotted operation as `<namespace>.read` on
 * `<account>:<operation>`, and a bare one, an MCP tool, as `<server>_<operation>` on `*`, where the server is the
 * plugin's name for the `default` account and `<plugin>-<alias>` for any other (§5: MCP tools are
 * `<name>-<alias>_<tool>`). The namespace is the source id's first segment.
 *
 * The broker and a project may only narrow these rules, and the plugin's own `access` setting stays final.
 */
import type { Checked } from "../internal/checked.ts"
import type { ActionItem, Manifest, SourceItem } from "../manifest.ts"
import { findMethod } from "../manifest.ts"
import { serverOf, toolAction } from "./rules.ts"

/** One OpenCode permission rule, as a session or an agent holds it. */
export interface PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: "allow" | "deny" | "ask"
}

/**
 * A person's grant: one consumer may read one source, for one account, within one scope (contract §6 and §13).
 */
export interface Grant {
  /** Who reads: a consumer, such as `notes` or `notes.home`, or an app with its viewer. */
  readonly consumer: string
  /** The source id. */
  readonly source: string
  /** The account the person confirmed. */
  readonly account: string
  /** The scope the person confirmed, by scope key: channel ids, label names. Absent for a source without a scope. */
  readonly scope?: Readonly<Record<string, readonly string[]>>
  /** The manifest hash the person consented to; a changed manifest asks again. */
  readonly manifestHash: string
  /** The person turned this binding off: a read answers SOURCE_DISABLED, which is not an error state. */
  readonly disabled?: boolean
}

/**
 * A person's grant for one action: one consumer may preview and commit one action, for one account, against the
 * manifest hash they consented to. The same shape as a read grant, for an action id.
 */
export interface ActGrant {
  /** Who acts: a consumer, such as `notes`, or an app with its viewer. */
  readonly consumer: string
  /** The action id. */
  readonly action: string
  /** The account the person confirmed. */
  readonly account: string
  /** The manifest hash the person consented to; a changed manifest asks again. */
  readonly manifestHash: string
  /** The person turned this binding off. An action then answers SOURCE_DISABLED, the table's existing code. */
  readonly disabled?: boolean
}

/** Which call a fenced action session allows. Preview never allows the commit action. */
export type ActPhase = "preview" | "commit"

/** The first rule of every fenced session: nothing is allowed that a later rule does not allow. */
export const DENY_ALL: PermissionRule = { action: "*", resource: "*", effect: "deny" }

/**
 * An account a rule may name: no wildcard (`*`, `?`), no `:` (it separates account and operation), no whitespace or
 * control character, at most 320 characters. A wildcard here would widen the grant to other accounts.
 */
export const ACCOUNT_PATTERN = /^[^\s*?:\u0000-\u001f\u007f]{1,320}$/

/** The wildcard characters OpenCode's rules read: an action or operation with one would widen a rule. */
const WILDCARD = /[*?]/

/** Why `account` cannot be named in a rule, or undefined when it can. */
export function accountProblem(account: unknown): string | undefined {
  if (typeof account !== "string" || !ACCOUNT_PATTERN.test(account)) {
    return "the account must be 1 to 320 characters with no wildcard (* or ?), no colon and no whitespace"
  }
  return undefined
}

const allow = (action: string, resource: string): PermissionRule => ({ action, resource, effect: "allow" })

/** A source's namespace: its id's first segment, which every action of the source begins with. */
export function namespaceOf(source: Pick<SourceItem, "id">): string {
  return source.id.split(".")[0] ?? source.id
}

/**
 * The rule that allows one operation for `account`: a dotted operation as `<namespace>.read` on
 * `<account>:<operation>`, a bare one (an MCP tool) as `<server>_<operation>` on `*`. The same derivation as the
 * conformance kit, so declared equals asserted means the same thing in a plugin's CI and in a consumer's session.
 *
 * The alias is the grant's own account, which the app resolved from the plugin's manifest before it issued the grant;
 * `serverOf` in `./rules.ts` is the deriving form that also refuses an alias the plugin does not declare.
 */
export function operationRule(
  source: Pick<SourceItem, "id">,
  operation: string,
  account: string,
  aliases: readonly string[] = [],
  kind: "operation" | "tool" = operation.includes(".") ? "operation" : "tool",
): Checked<PermissionRule> {
  if (!aliases.includes(account)) return { ok: false, problems: [`the account alias "${account}" is not one this plugin declares`] }
  const namespace = namespaceOf(source)
  if (kind === "operation") return { ok: true, value: allow(`${namespace}.read`, `${account}:${operation}`) }
  const server = serverOf(namespace, account, aliases)
  if (!server.ok) return { ok: false, problems: server.problems }
  return { ok: true, value: allow(toolAction(server.value, operation), "*") }
}

function fenced(rules: readonly PermissionRule[]): Checked<readonly PermissionRule[]> {
  const loose = rules.find((rule) => WILDCARD.test(rule.action) || (rule.resource !== "*" && WILDCARD.test(rule.resource)))
  if (loose) return { ok: false, problems: [`the rule for ${loose.action} on ${loose.resource} has a wildcard, which would widen the grant`] }
  const seen = new Set<string>()
  const unique = rules.filter((rule) => {
    const key = `${rule.action}\u0000${rule.resource}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return { ok: true, value: [DENY_ALL, ...unique] }
}

/** The method action a source's read asserts: `<namespace>.<method>`. */
function methodAction(source: SourceItem): string {
  return `${namespaceOf(source)}.${source.method}`
}

/**
 * The session rules for reading `source` under `grant`: deny everything, then allow the method and each declared
 * operation for the granted account. Refused when the grant is for another source or its account cannot be named in a
 * rule.
 */
export function sessionRules(source: SourceItem, grant: Pick<Grant, "source" | "account">, aliases: readonly string[] = []): Checked<readonly PermissionRule[]> {
  if (grant.source !== source.id) return { ok: false, problems: [`the grant is for ${grant.source}, not ${source.id}`] }
  const problem = accountProblem(grant.account)
  if (problem) return { ok: false, problems: [problem] }
  const method = methodAction(source)
  const operations = source.operations ?? []
  const checked = operations.map((operation) => operationRule(source, operation, grant.account, aliases))
  const failed = checked.find((rule) => !rule.ok)
  if (failed && !failed.ok) return { ok: false, problems: failed.problems }
  return fenced([allow(method, "*"), ...checked.flatMap((rule) => (rule.ok ? [rule.value] : []))])
}

/**
 * The session rules for one phase of `act` under `grant`: deny everything, then allow that phase's action and each
 * declared operation for the granted account. A preview session allows the preview action and not the commit action,
 * so the commit method cannot run while previewing. Operations are derived like a source's (`operationRule`).
 */
export function actSessionRules(manifest: Manifest, act: Pick<ActionItem, "id" | "preview" | "commit">, grant: Pick<ActGrant, "action" | "account">, phase: ActPhase, aliases: readonly string[] = []): Checked<readonly PermissionRule[]> {
  if (grant.action !== act.id) return { ok: false, problems: [`the grant is for ${grant.action}, not ${act.id}`] }
  const problem = accountProblem(grant.account)
  if (problem) return { ok: false, problems: [problem] }
  const method = phase === "preview" ? act.preview : act.commit
  const declared = findMethod(manifest, method)
  if (declared === undefined) return { ok: false, problems: [`${act.id} names no declared method ${method}`] }
  const action = `${namespaceOf(act)}.${method}`
  const operations = declared.operations ?? []
  const checked = operations.map((operation) => operationRule(act, operation, grant.account, aliases))
  const failed = checked.find((rule) => !rule.ok)
  if (failed && !failed.ok) return { ok: false, problems: failed.problems }
  return fenced([allow(action, "*"), ...checked.flatMap((rule) => (rule.ok ? [rule.value] : []))])
}

/**
 * The session rules for one detail read of `source` under `grant`: the source's own rules, plus the detail's declared
 * method. Refused when the source declares no such detail.
 */
export function detailRules(source: SourceItem, detailId: string, grant: Pick<Grant, "source" | "account">, aliases: readonly string[] = []): Checked<readonly PermissionRule[]> {
  const detail = source.details?.find((entry) => entry.id === detailId)
  if (detail === undefined) return { ok: false, problems: [`${source.id} declares no detail read ${detailId}`] }
  const rules = sessionRules(source, grant, aliases)
  if (!rules.ok) return rules
  return fenced([...rules.value.slice(1), allow(`${namespaceOf(source)}.${detail.method}`, "*")])
}

/**
 * The session rules for the source's `probe` on `account`: deny everything, then allow the probe's action and its
 * identity operations. That a probe reads no content is the kit's check of its answer.
 */
export function probeRules(source: SourceItem, account: string, identityOperations: readonly string[], probeAction?: string, aliases: readonly string[] = []): Checked<readonly PermissionRule[]> {
  const problem = accountProblem(account)
  if (problem) return { ok: false, problems: [problem] }
  const method = probeAction ?? methodAction(source)
  const checked = identityOperations.map((operation) => operationRule(source, operation, account, aliases))
  const failed = checked.find((rule) => !rule.ok)
  if (failed && !failed.ok) return { ok: false, problems: failed.problems }
  return fenced([allow(method, "*"), ...checked.flatMap((rule) => (rule.ok ? [rule.value] : []))])
}

/**
 * How OpenCode decides an action on a resource under `rules`: the last rule whose action and resource match wins (`*`
 * matches any run of characters and `?` one), and no match asks. The same evaluation the register and the tools RPC run.
 */
export function evaluate(rules: readonly PermissionRule[], action: string, resource = "*"): PermissionRule["effect"] {
  return rules.findLast((rule) => wildcard(rule.action, action) && wildcard(rule.resource, resource))?.effect ?? "ask"
}

/** True when `pattern` matches `value` with OpenCode's `*` and `?` wildcards. */
export function matches(pattern: string, value: string): boolean {
  return wildcard(pattern, value)
}

const wildcard = (pattern: string, value: string) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(value)

/** True when `grant` covers a read of `source` for `account` within `scope`: the same source and account, and every scope value granted. */
export function grantCovers(grant: Grant, request: { readonly source: string; readonly account: string; readonly scope?: Readonly<Record<string, readonly string[]>> }): boolean {
  if (grant.source !== request.source || grant.account !== request.account) return false
  for (const [key, values] of Object.entries(request.scope ?? {})) {
    const granted = grant.scope?.[key]
    if (!granted || values.some((value) => !granted.includes(value))) return false
  }
  return true
}
