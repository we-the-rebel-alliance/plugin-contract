/**
 * A synthetic OpenCode 2.4.1 context for the register's tests: agents, tools, sessions, permission asks and the real
 * RPC host fake from `rpc-host.ts`.
 *
 * It follows the host where the contract depends on it: a tool's effective id is `<namespace>_<tool>` with dots in the
 * namespace turned to underscores, agent rules are the base followed by the session's, and an ask waits for an answer
 * (this fake answers unless the test says otherwise). It is not a second implementation of OpenCode; it is the smallest
 * host whose behaviour the tests assert.
 */
import { evaluate, type PermissionRule } from "../../src/access.ts"
import type { RegisterContext } from "../../src/register.ts"
import { makeRpcHost, type RpcHost } from "./rpc-host.ts"

export interface TestAgent {
  readonly id: string
  permissions: PermissionRule[]
}

export interface TestSession {
  readonly agent?: string
  permissions?: PermissionRule[]
}

export interface RecordedTool {
  readonly id: string
  readonly tool: {
    readonly name: string
    readonly description: string
    readonly input: Readonly<Record<string, unknown>>
    readonly output: Readonly<Record<string, unknown>>
    readonly options: Readonly<Record<string, unknown>>
    execute(input: unknown, context: unknown): Promise<{ output?: unknown; content?: string }>
  }
}

export interface Assertion {
  readonly sessionID: string
  readonly agent?: string
  readonly action: string
  readonly resources: readonly string[]
  readonly save?: readonly string[]
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
}

/** One ask the fake host is holding, as `permission.list` reports it. */
export interface PendingAsk {
  readonly id: string
  readonly sessionID: string
  readonly action: string
  readonly resources: readonly string[]
  readonly source?: { readonly type: "tool"; readonly messageID: string; readonly id: string }
}

export interface HarnessOptions {
  readonly agents?: readonly TestAgent[]
  readonly sessions?: Readonly<Record<string, TestSession>>
  readonly options?: Readonly<Record<string, unknown>>
  /** Whether an ask is answered yes. Default true; a test that proves the refusal sets it false. */
  readonly answerAsks?: boolean
  /** Whether an ask waits for `releaseAsks`. Default false; a test that re-records or aborts while the ask waits sets it true. */
  readonly holdAsks?: boolean
}

export interface Harness {
  readonly ctx: RegisterContext
  readonly agents: TestAgent[]
  readonly sessions: Map<string, TestSession>
  readonly tools: Map<string, RecordedTool>
  readonly assertions: Assertion[]
  readonly namespaces: { name: string; description: string }[]
  readonly rpc: RpcHost
  /** The asks currently waiting for an answer, as `permission.list` reports them. */
  readonly pending: () => readonly PendingAsk[]
  /** Flip whether an ask is answered, for a test that refuses first and retries the same plan. */
  readonly setAnswerAsks: (value: boolean) => void
  /** Resolve the next ask that is entered, for a test that acts while the ask waits. */
  readonly waitForAsk: () => Promise<void>
  /** Answer every held ask. */
  readonly releaseAsks: () => void
  /** Flip whether a later ask waits, so a retry can answer at once. */
  readonly setHoldAsks: (value: boolean) => void
}

const sessionRefusal = (sessionID: string) => Object.assign(new Error(`Session not found: ${sessionID}`), { _tag: "Session.NotFoundError" })
const askRefusal = (action: string) => Object.assign(new Error(`Permission denied: ${action}`), { _tag: "Tool.Error" })

export function makeHarness(options: HarnessOptions = {}): Harness {
  const agents: TestAgent[] = (options.agents ?? [{ id: "build", permissions: [{ action: "*", resource: "*", effect: "allow" }] }]).map((agent) => ({ id: agent.id, permissions: [...agent.permissions] }))
  const sessions = new Map(Object.entries(options.sessions ?? { s1: { agent: "build" } }))
  const tools = new Map<string, RecordedTool>()
  const assertions: Assertion[] = []
  const namespaces: { name: string; description: string }[] = []
  let answerAsks = options.answerAsks ?? true
  let holdAsks = options.holdAsks ?? false
  const askListeners: (() => void)[] = []
  const heldAsks = new Map<string, { ask: PendingAsk; resolve: () => void; reject: (error: unknown) => void }>()
  let askCount = 0
  const rpc = makeRpcHost()

  const rulesFor = (sessionID: string, agentID?: string): readonly PermissionRule[] => {
    const session = sessions.get(sessionID)
    if (session === undefined) throw sessionRefusal(sessionID)
    const agent = agents.find((held) => held.id === (agentID ?? session.agent))
    return [...(agent?.permissions ?? []), ...(session.permissions ?? [])]
  }

  const ctx: RegisterContext = {
    ...(options.options === undefined ? {} : { options: options.options }),
    agent: {
      async transform(callback) {
        callback({
          list: () => agents,
          update(id, update) {
            const agent = agents.find((held) => held.id === id)
            if (agent !== undefined) update(agent as { permissions: PermissionRule[] })
          },
        })
        return { dispose: async () => {} }
      },
      async get(input) {
        const agent = agents.find((held) => held.id === input.agentID)
        if (agent === undefined) throw Object.assign(new Error(`Agent not found: ${input.agentID}`), { _tag: "Agent.NotFoundError" })
        return { data: { permissions: agent.permissions } }
      },
    },
    tool: {
      async transform(callback) {
        const added: string[] = []
        let namespace: string | undefined
        callback({
          namespace(value: { readonly name: string; readonly description: string }) {
            namespace = value.name
            namespaces.push(value)
          },
          add(tool: { readonly name: string }) {
            const id = namespace === undefined ? tool.name : `${namespace.replaceAll(".", "_")}_${tool.name}`
            tools.set(id, { id, tool: tool as RecordedTool["tool"] })
            added.push(id)
          },
        })
        return {
          async dispose() {
            for (const id of added) tools.delete(id)
          },
        }
      },
    },
    session: {
      async get(input) {
        const session = sessions.get(input.sessionID)
        if (session === undefined) throw sessionRefusal(input.sessionID)
        return session
      },
    },
    permission: {
      async hook() {
        return { dispose: async () => {} }
      },
      async assert(input) {
        assertions.push({
          sessionID: input.sessionID,
          ...(input.agent === undefined ? {} : { agent: input.agent }),
          action: input.action,
          resources: input.resources,
          ...(input.save === undefined ? {} : { save: input.save }),
          ...(input.source === undefined ? {} : { source: input.source }),
        })
        for (const listener of askListeners.splice(0)) listener()
        const rules = rulesFor(input.sessionID, input.agent)
        let effect: PermissionRule["effect"] = "allow"
        for (const resource of input.resources.length === 0 ? ["*"] : input.resources) {
          const found = evaluate(rules, input.action, resource)
          if (found === "deny") throw askRefusal(input.action)
          if (found === "ask") effect = "ask"
        }
        if (effect === "ask" && !answerAsks) throw askRefusal(input.action)
        if (effect === "ask" && holdAsks) {
          const ask: PendingAsk = {
            id: `ask_${++askCount}`,
            sessionID: input.sessionID,
            action: input.action,
            resources: input.resources,
            ...(input.source === undefined ? {} : { source: input.source }),
          }
          await new Promise<void>((resolve, reject) => heldAsks.set(ask.id, { ask, resolve, reject }))
        }
      },
      async list(input) {
        return [...heldAsks.values()].map((held) => held.ask).filter((ask) => ask.sessionID === input.sessionID)
      },
      async reply(input) {
        const held = heldAsks.get(input.requestID)
        if (held === undefined) return
        heldAsks.delete(input.requestID)
        if (input.decision === "reject") held.reject(askRefusal(held.ask.action))
        else held.resolve()
      },
    },
    rpc: {
      register: (definition, handlers) => rpc.register(definition as never, handlers as never),
    },
  }

  return {
    ctx,
    agents,
    sessions,
    tools,
    assertions,
    namespaces,
    rpc,
    pending: () => [...heldAsks.values()].map((held) => held.ask),
    setAnswerAsks: (value) => void (answerAsks = value),
    waitForAsk: () => new Promise<void>((resolve) => askListeners.push(resolve)),
    releaseAsks: () => {
      for (const [id, held] of [...heldAsks]) {
        heldAsks.delete(id)
        held.resolve()
      }
    },
    setHoldAsks: (value) => void (holdAsks = value),
  }
}

/** The permission rules the fake agent holds, for a test that checks the generated access. */
export function agentRules(harness: Harness, id = "build"): readonly PermissionRule[] {
  return harness.agents.find((agent) => agent.id === id)?.permissions ?? []
}
