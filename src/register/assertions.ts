/**
 * The one permission gate every door runs (contract §6 and §13; OpenCode 2.4.1 `ctx.permission.assert`).
 *
 * OpenCode 2.4.1's gate is `ctx.permission.assert` (`@opencode/plugin/dist/promise/permission.d.ts`; its input is
 * `AssertInput.Encoded` in `dist/permission.d.ts`). A tool's `permission` option only hides a fully denied tool, and
 * `tool.add` adds no ask (`core/src/tool.ts:327,500`; `core/src/tool/AGENTS.md:53-55`;
 * `plugin/src/promise/adapter.ts:574`). So every handler invocation calls `ctx.permission.assert` once, with the
 * method's action `<name>.<method>` and the resources its declared operations name (`<alias>:<operation>`, or
 * `<alias>:*` when it declares none). The host evaluates the session's rules and asks when the last matching rule says `ask`; a
 * deny or a rejection rejects. A tool or Code Mode call may save a pattern scoped to this method's action and account
 * (`<account>:*`) so "Always allow" cannot become a project-wide `*`; an RPC call never saves, because its answer
 * applies to that one call only.
 *
 * `callEffect` is the read-only evaluation the RPC cap needs before the gate: it says whether the session's rules will
 * ask, allow or deny the method, without prompting.
 */
import { evaluate, methodAction, type PermissionRule } from "../access.ts"
import type { MethodEntry } from "./handlers.ts"
import { refusal, RegisterError } from "./errors.ts"

/** The part of the plugin context the gate asserts through, and the pending asks it can reject on cancellation. */
export interface GateContext {
  readonly permission: {
    assert(input: {
      readonly sessionID: string
      readonly agent?: string
      readonly action: string
      readonly resources: readonly string[]
      readonly save?: readonly string[]
      readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    }): Promise<void>
    /** The pending asks of a session; OpenCode 2.4.1's `PermissionDomain.list`. */
    list?(input: { readonly sessionID: string }): Promise<readonly { readonly id: string; readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string } | undefined }[]>
    /** Answer a pending ask; a cancellation answers `reject`. OpenCode 2.4.1's `PermissionDomain.reply`. */
    reply?(input: { readonly sessionID: string; readonly requestID: string; readonly decision: "reject"; readonly message?: string | undefined }): Promise<void>
  }
}

/**
 * Reject the ask this call left pending, found by its source id, so a cancelled call leaves nothing on the person's
 * screen. A host without `list` and `reply`, or a transport failure, changes nothing: the cancellation refusal below is
 * still the answer.
 */
async function rejectPendingAsk(context: GateContext, call: { readonly sessionID: string; readonly id: string }): Promise<void> {
  const list = context.permission.list
  const reply = context.permission.reply
  if (list === undefined || reply === undefined) return
  try {
    const pending = await list({ sessionID: call.sessionID })
    const ask = pending.find((request) => request.source?.id === call.id)
    if (ask !== undefined) await reply({ sessionID: call.sessionID, requestID: ask.id, decision: "reject", message: "The call was cancelled." })
  } catch {
    // The host may have removed the ask already, or may not offer the domain. The call's refusal is unchanged.
  }
}

/** The resources a method's gate names: its operations on the account, or `*` when it declares none. */
export function resourcesFor(entry: MethodEntry, account: string): readonly string[] {
  const operations = entry.item.operations ?? []
  // A method with no operations asks for the account's own wildcard, the same pattern a tool-door "Always" saves.
  return operations.length === 0 ? [`${account}:*`] : operations.map((operation) => `${account}:${operation}`)
}

/**
 * The effect the session's rules give a call: the method's action on `*`, narrowed by each declared operation's
 * resource. A deny anywhere wins; otherwise an ask anywhere asks.
 */
export function callEffect(name: string, entry: MethodEntry, account: string, rules: readonly PermissionRule[]): PermissionRule["effect"] {
  const action = methodAction(name, entry.name)
  let effect = evaluate(rules, action, "*")
  for (const resource of resourcesFor(entry, account)) {
    const found = evaluate(rules, action, resource)
    if (found === "deny") return "deny"
    if (found === "ask") effect = "ask"
  }
  return effect
}

/**
 * The one gate. It never reimplements the rules: it asks OpenCode's permission API, which evaluates the agent's and the
 * session's rules with last-match-wins, prompts when the answer is `ask`, and rejects on a deny or a rejection.
 */
export async function gate(
  context: GateContext,
  name: string,
  entry: MethodEntry,
  call: { readonly sessionID: string; readonly agent?: string; readonly messageID: string; readonly id: string; readonly signal?: AbortSignal },
  account: string,
  options: { readonly save: boolean; readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string } },
): Promise<void> {
  const cancelled = () => new RegisterError(refusal("UNAVAILABLE", "the call was cancelled while its permission ask was pending", "Retry the call."))
  const signal = call.signal
  if (signal?.aborted) throw cancelled()
  const pending = context.permission.assert({
    sessionID: call.sessionID,
    ...(call.agent === undefined ? {} : { agent: call.agent }),
    action: methodAction(name, entry.name),
    resources: resourcesFor(entry, account),
    // Save only this method's own action for this account. Never `*`, which would be a project-wide allow.
    ...(options.save ? { save: [`${account}:*`] } : {}),
    ...(options.source === undefined ? {} : { source: options.source }),
  })
  // A late rejection after an abort is not the caller's answer: the abandoned call already lost its race.
  pending.catch(() => undefined)
  if (signal === undefined) {
    await pending
    return
  }
  let onAbort: (() => void) | undefined
  try {
    await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(cancelled())
        signal.addEventListener("abort", onAbort, { once: true })
      }),
    ])
  } catch (error) {
    // The person's screen still shows the ask: reject it before the abandoned call reports its cancellation.
    if (signal.aborted) await rejectPendingAsk(context, call)
    throw error
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort)
  }
}
