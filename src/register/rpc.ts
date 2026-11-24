/**
 * Door 3: the typed RPC, one registration per plugin (contract §9).
 *
 *   POST /api/rpc/<name>/<method>
 *   { "sessionID": "<session>", "input": <the method's input> }
 *
 * The call runs as the session and agent it names, under the session's rules. A read may run when the rule allows it.
 * A non-read method runs only with one of the two confirmations contract §8 names: a permission ask the session's
 * rules resolve to `ask` (OpenCode prompts, and the call waits for the answer), or a host-signed action grant in the
 * envelope's `grant` with the `consumer` it was issued to. An `allow` rule is not a confirmation; without one of the
 * two, the call is refused. This is LD-5.
 *
 * The registration carries the bus's events block (`busEvents(name)`); a second registration with the same id would
 * hide it, so the plugin registers once and wraps it with `createBus(name, registration)`.
 */
import { randomUUID } from "node:crypto"
import type { Plugin } from "@opencode/plugin"
import { methodAction } from "../access.ts"
import { busEvents } from "../bus.ts"
import { verifyGrant, type GrantKeys, type GrantScope, type GrantStore } from "../grant.ts"
import type { JsonSchema } from "../manifest.ts"
import { assertOperations, callEffect } from "./assertions.ts"
import { refusal, refusalOf, RegisterError, type Refusal } from "./errors.ts"
import type { MethodEntry } from "./handlers.ts"
import { execute, prepareCall, type CallEnvironment } from "./invoke.ts"
import { validate } from "./validate.ts"

/** The envelope's failure, as the RPC declares it: the code and the next step beside the message. */
const FAILED = {
  type: "object",
  properties: { code: { type: "string" }, next: { type: "string" } },
  required: ["code", "next"],
  additionalProperties: false,
} as const

/** What the plugin wires into the grant verifier: the host's keys, the audience and the durable ledger. */
export interface GrantWiring {
  /** The public keys the host signs with, by `kid`, and revoked ids. */
  readonly keys: GrantKeys
  /** The plugin's package name, which the grant's `aud` must name. */
  readonly audience: string
  /** Where single use is recorded; the plugin backs it with durable storage. */
  readonly store: GrantStore
  /** The scope the grant must name; `{}` (the whole method) when absent. */
  readonly scope?: GrantScope
  /** The current time in seconds; the real clock when absent. */
  readonly now?: () => number
}

/** A context that can answer a refusal, as OpenCode's RPC call context does. */
export interface RpcCallContext {
  readonly signal: AbortSignal
  error(type: "failed", message: string, data: { readonly code: string; readonly next: string }): unknown
}

/** The part of the plugin context the RPC uses. */
export interface RpcContext {
  readonly session: {
    get(input: { readonly sessionID: string }): Promise<{ readonly agent?: string; readonly permissions?: readonly { readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }[] }>
  }
  readonly agent: {
    get(input: { readonly agentID: string }): Promise<{ readonly data: { readonly permissions: readonly { readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }[] } }>
  }
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
  readonly rpc: {
    register(definition: unknown, handlers: Readonly<Record<string, (input: unknown, context: RpcCallContext) => Promise<unknown>>>): Promise<RpcRegistration>
  }
}

/** One live registration, as OpenCode returns it: a disposer and the events emitter. */
export interface RpcRegistration {
  readonly events: { emit(name: string, data: unknown): Promise<void> }
  dispose(): Promise<void>
}

/**
 * The host's context is assignable to this module's: checked at compile time, so a plugin passes `ctx` as it is. The
 * RPC domain is generic over each method's envelope; this module's structural `register` keeps the published
 * declaration free of the host types and the envelope validator checks every key at runtime.
 */
const hostContextIsRpcContext = (context: Pick<Plugin.Context, "rpc" | "session" | "agent" | "permission">): RpcContext => context
void hostContextIsRpcContext

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** A JSON Schema with a Standard Schema validator attached, so OpenCode refuses unknown envelope keys. */
function strictEnvelope(input: JsonSchema): JsonSchema {
  const schema: JsonSchema = {
    type: "object",
    properties: {
      sessionID: { type: "string", minLength: 1 },
      input,
      grant: { type: "string", minLength: 1 },
      consumer: { type: "string", minLength: 1 },
    },
    required: ["sessionID", "input"],
    additionalProperties: false,
  }
  Object.defineProperty(schema, "~standard", {
    enumerable: false,
    value: {
      version: 1,
      vendor: "plugin-contract",
      validate(value: unknown) {
        const checked = validate(schema, value)
        return checked.ok ? { value: checked.value } : { issues: checked.problems.map((message) => ({ message })) }
      },
    },
  })
  return schema
}

/** The grant actions: every non-read method needs a confirmation. A read needs no grant. */
function grantActions(environment: CallEnvironment): Readonly<Record<string, "required">> {
  const actions: Record<string, "required"> = {}
  for (const entry of environment.entries) if (entry.item.class !== "read") actions[methodAction(environment.name, entry.name)] = "required"
  return actions
}

/** The refusal a permission assertion's error maps to. */
function permissionRefusal(error: unknown, what: string): Refusal {
  const own = refusalOf(error)
  if (own) return own
  const message = (error instanceof Error ? error.message.split(/\r?\n/, 1)[0] : String(error)) ?? String(error)
  return refusal("PERMISSION_DENIED", `${what} was refused: ${message}`, "Ask the person to allow it, or use a session whose agent allows it.")
}

/** The session's agent and rules: the agent's, then the session's, as OpenCode reads them. */
async function rulesOf(context: RpcContext, sessionID: string): Promise<{ readonly agent: string; readonly rules: readonly { readonly action: string; readonly resource: string; readonly effect: "allow" | "deny" | "ask" }[] }> {
  let info: Awaited<ReturnType<RpcContext["session"]["get"]>>
  try {
    info = await context.session.get({ sessionID })
  } catch {
    throw new RegisterError(refusal("UNAVAILABLE", `there is no session '${sessionID}' in this location`, "Pass a session that exists, or create one first."))
  }
  if (info.agent === undefined || info.agent === "") {
    throw new RegisterError(refusal("PERMISSION_DENIED", `session '${sessionID}' names no agent`, "Use a session with an agent, so its rules can decide the call."))
  }
  let agent: Awaited<ReturnType<RpcContext["agent"]["get"]>>
  try {
    agent = await context.agent.get({ agentID: info.agent })
  } catch {
    throw new RegisterError(refusal("PERMISSION_DENIED", `session '${sessionID}' names the agent '${info.agent}', which does not exist in this location`, "Use a session whose agent exists."))
  }
  return { agent: info.agent, rules: [...agent.data.permissions, ...(info.permissions ?? [])] }
}

/** A verified grant, or a `GRANT_INVALID` refusal. */
async function verify(environment: CallEnvironment, wiring: GrantWiring, request: Record<string, unknown>, entry: MethodEntry, account: string): Promise<Refusal | undefined> {
  const token = request["grant"]
  if (typeof token !== "string" || token === "") return refusal("GRANT_INVALID", "the grant is not a token", "Pass the grant the host signed, or use a permission ask.")
  const consumer = request["consumer"]
  if (typeof consumer !== "string" || consumer === "") return refusal("GRANT_INVALID", "the grant names no consumer", "Pass the consumer the grant was issued to.")
  const checked = await verifyGrant({
    grant: token,
    input: request["input"],
    act: methodAction(environment.name, entry.name),
    actions: grantActions(environment),
    keys: wiring.keys,
    audience: wiring.audience,
    consumer,
    capability: methodAction(environment.name, entry.name),
    account,
    ...(wiring.scope === undefined ? {} : { scope: wiring.scope }),
    manifest: environment.hash,
    now: wiring.now?.() ?? Math.floor(Date.now() / 1000),
    store: wiring.store,
  })
  return checked.ok ? undefined : refusal("GRANT_INVALID", checked.reason, "Ask the host to issue a fresh grant for this action and input.")
}

/**
 * The RPC call: the session's rules, the two confirmations for a non-read, the operation assertions, then the same
 * handler path every door uses.
 */
async function invoke(
  context: RpcContext,
  environment: CallEnvironment,
  entry: MethodEntry,
  wiring: GrantWiring | undefined,
  raw: unknown,
  rpc: RpcCallContext,
): Promise<unknown> {
  try {
    if (!plain(raw)) throw new RegisterError(refusal("INPUT_INVALID", "the RPC envelope must be an object", 'Pass {"sessionID":"<session>","input":<the method\'s input>}.'))
    const sessionID = raw["sessionID"]
    if (typeof sessionID !== "string" || sessionID === "") throw new RegisterError(refusal("INPUT_INVALID", "the RPC envelope needs a sessionID", "Pass the session the call runs as."))
    const input = raw["input"]
    if (!plain(input)) throw new RegisterError(refusal("INPUT_INVALID", "the RPC envelope needs an input object", "Pass the method's input as the envelope's input."))
    const resolved = await rulesOf(context, sessionID)
    const prepared = prepareCall(entry, input, environment.accounts)
    const effect = callEffect(environment.name, entry, prepared.account, resolved.rules)
    const nonRead = entry.item.class !== "read"
    if (nonRead) {
      if (effect === "deny") {
        throw new RegisterError(refusal("PERMISSION_DENIED", `${environment.name}.${entry.name} is denied for this session's agent`, "Use a session whose agent allows it."))
      }
      if (raw["grant"] !== undefined) {
        if (wiring === undefined) throw new RegisterError(refusal("GRANT_INVALID", "this plugin has no grant verifier, so it cannot accept a grant", "Use a permission ask in a session, or configure the plugin's grant verifier."))
        const failed = await verify(environment, wiring, raw, entry, prepared.account)
        if (failed !== undefined) throw new RegisterError(failed)
      } else if (effect === "ask") {
        try {
          await context.permission.assert({ sessionID, agent: resolved.agent, action: methodAction(environment.name, entry.name), resources: ["*"], save: ["*"] })
        } catch (error) {
          throw new RegisterError(permissionRefusal(error, `${environment.name}.${entry.name}`))
        }
      } else {
        throw new RegisterError(refusal("PERMISSION_DENIED", `${environment.name}.${entry.name} is a ${entry.item.class} and an allow rule is not a confirmation for RPC`, "A non-read method over RPC needs a permission ask or a host-signed action grant."))
      }
    } else if (effect === "deny") {
      throw new RegisterError(refusal("PERMISSION_DENIED", `${environment.name}.${entry.name} is denied for this session's agent`, "Use a session whose agent allows it."))
    } else if (effect === "ask") {
      try {
        await context.permission.assert({ sessionID, agent: resolved.agent, action: methodAction(environment.name, entry.name), resources: ["*"], save: ["*"] })
      } catch (error) {
        throw new RegisterError(permissionRefusal(error, `${environment.name}.${entry.name}`))
      }
    }
    try {
      await assertOperations(context, environment.name, entry, { sessionID, agent: resolved.agent, messageID: "msg_rpc", id: `rpc:${entry.name}` }, prepared.account)
    } catch (error) {
      throw new RegisterError(permissionRefusal(error, `${environment.name}.${entry.name}`))
    }
    const messageID = "msg_rpc"
    const id = `rpc:${randomUUID()}`
    const value = await execute(entry, prepared, { sessionID, agent: resolved.agent, messageID, id, signal: rpc.signal, progress: async () => {}, door: "rpc" })
    return value === undefined ? null : JSON.parse(JSON.stringify(value))
  } catch (error) {
    const own = refusalOf(error)
    const failure = own ?? refusal("UNAVAILABLE", "the RPC call failed", "Try again; if it keeps failing, check the plugin's status.")
    return rpc.error("failed", failure.message, { code: failure.code, next: failure.next })
  }
}

/** The RPC definition and handlers, and the one registration that carries the bus events. */
export async function installRpc(context: RpcContext, environment: CallEnvironment, wiring?: GrantWiring): Promise<RpcRegistration> {
  const methods: Record<string, unknown> = {}
  const handlers: Record<string, (input: unknown, call: RpcCallContext) => Promise<unknown>> = {}
  for (const entry of environment.entries) {
    methods[entry.name] = { input: strictEnvelope(entry.input), output: entry.output, errors: { failed: FAILED } }
    handlers[entry.name] = (raw: unknown, call: RpcCallContext) => invoke(context, environment, entry, wiring, raw, call)
  }
  // Only the events the manifest declares: an undeclared bus event must not be publishable (contract §10 and §16).
  const events = Object.fromEntries(Object.entries(busEvents(environment.name)).filter(([event]) => Object.hasOwn(environment.manifest.events, event)))
  const definition = { id: environment.name, methods, events }
  return context.rpc.register(definition, handlers)
}
