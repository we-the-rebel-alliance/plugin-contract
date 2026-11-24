/**
 * The permission checks around one call (contract §6, §9 and §13).
 *
 * The method's own action is `<name>.<method>`. A method that declares dotted provider operations also asserts that
 * action on `<alias>:<operation>`, so a grant or an agent rule can narrow one operation. A bare operation is an MCP
 * tool, whose action is `<server>_<tool>` on `*`, with the server derived per alias: a rule for `work` can never reach
 * another alias's tools.
 */
import { evaluate, methodAction, serverName, type PermissionRule } from "../access.ts"
import type { MethodEntry } from "./handlers.ts"

/** The part of the plugin context a call asserts through. */
export interface AssertContext {
  readonly permission: {
    assert(input: {
      readonly sessionID: string
      readonly agent?: string
      readonly action: string
      readonly resources: readonly string[]
      readonly save?: readonly string[]
      readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
    }): Promise<void>
  }
}

/** One permission assertion a call makes. */
export interface OperationAssertion {
  readonly action: string
  readonly resources: readonly string[]
}

const dotted = (operation: string): boolean => operation.includes(".")

/** The assertions one call makes beyond its own tool permission: the method's dotted operations, then its bare ones. */
export function assertionsFor(name: string, entry: MethodEntry, account: string): readonly OperationAssertion[] {
  const operations = entry.item.operations ?? []
  const action = methodAction(name, entry.name)
  const assertions: OperationAssertion[] = []
  const dottedOperations = operations.filter(dotted)
  if (dottedOperations.length > 0) assertions.push({ action, resources: dottedOperations.map((operation) => `${account}:${operation}`) })
  for (const operation of operations.filter((held) => !dotted(held))) {
    assertions.push({ action: `${serverName(name, account)}_${operation}`, resources: ["*"] })
  }
  return assertions
}

/**
 * The effect of a call under `rules`: the method's action on `*`, narrowed by every declared operation's resource. A
 * deny anywhere wins; otherwise an ask anywhere asks.
 */
export function callEffect(name: string, entry: MethodEntry, account: string, rules: readonly PermissionRule[]): PermissionRule["effect"] {
  const action = methodAction(name, entry.name)
  let effect = evaluate(rules, action, "*")
  for (const assertion of assertionsFor(name, entry, account)) {
    for (const resource of assertion.resources) {
      const found = evaluate(rules, assertion.action, resource)
      if (found === "deny") return "deny"
      if (found === "ask") effect = "ask"
    }
  }
  return effect
}

/** Assert every operation the method declares, as the session's agent. A refusal propagates as OpenCode's error. */
export async function assertOperations(
  context: AssertContext,
  name: string,
  entry: MethodEntry,
  call: { readonly sessionID: string; readonly agent: string; readonly messageID: string; readonly id: string },
  account: string,
): Promise<void> {
  for (const assertion of assertionsFor(name, entry, account)) {
    await context.permission.assert({
      sessionID: call.sessionID,
      agent: call.agent,
      action: assertion.action,
      resources: assertion.resources,
      save: ["*"],
      source: { type: "tool", messageID: call.messageID, id: call.id },
    })
  }
}
