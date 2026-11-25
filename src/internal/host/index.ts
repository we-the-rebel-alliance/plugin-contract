/**
 * The real OpenCode 2.4.1 host, owned by conformance and used by `plugin-kit`.
 *
 * T1 never invents a host context. It loads the plugin with the real `@opencode/plugin` resolver, puts it in the
 * embedded `@opencode/sdk` host, creates a session, prompts once so the SDK acquires the location's plugin instance,
 * waits for activation, and records what the plugin did through the real `ctx`: tools, the namespace, the RPC
 * registration, agent rules and permission asks. The six behaviours standard §8 lists are handled here:
 *
 * 1. activation is awaited before the first RPC (`activation.ts`);
 * 2. the embedded host never runs automations, and with `allowScheduler` a test can override that (`automation.ts`);
 * 3. `experimental.schedule` is gone; automations go through `ctx.experimental.automation.create` (`automation.ts`);
 * 4. MCP discovery sends `server/discover` first, and a 401 or 403 ends the attempt (`mcp.ts`);
 * 5. a nested Code Mode call has its own id and `codemode: true` (`codemode.ts`);
 * 6. a turn's first tool step can arrive before the turn start (`turn.ts`).
 *
 * `@opencode/sdk` and `@opencode/plugin` are devDependencies of a plugin repository (standard §3). They are imported
 * with a computed specifier at T1 time, not bundled into `dist/`: a plugin's own bundle and this package's `dist/` stay
 * free of runtime dependencies.
 */
import type { PermissionRule } from "../../access.ts"
import { secretKinds } from "../secrets.ts"
import { waitForActivation } from "./activation.ts"
import { HostError } from "./errors.ts"

export { waitForActivation, type ActivationOptions } from "./activation.ts"
export { createCodeMode, type CodeModeHarness, type CodeModeSession, type ToolCall, type ToolCallInput, type ToolCallLike } from "./codemode.ts"
export { connectMcpServer, mcpAddress, type McpConnection, type McpProtocol, type McpServerConfig, type McpTransport } from "./mcp.ts"
export { automationApi, createAutomation, type AutomationAction, type AutomationApi, type AutomationClient, type AutomationHost, type AutomationResult, type AutomationSpec, type AutomationTrigger, type HostKind } from "./automation.ts"
export { TurnLog, type TurnEvent } from "./turn.ts"
export { HostError } from "./errors.ts"

/** The plugin definition OpenCode loads: `Plugin.define({ id, setup })`. */
export interface PluginDefinition {
  readonly id: string
  setup(context: unknown): unknown
}

/** One tool the real context registered, as the proxy saw it. */
export interface RecordedTool {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly namespace: string
  readonly permission: string
  readonly input: unknown
  readonly output: unknown
  readonly codemode: boolean | { readonly pinned?: boolean; readonly description?: string; readonly input?: unknown; readonly output?: unknown }
}

/** The real RPC registration, as the proxy saw it. */
export interface RecordedRpc {
  readonly id: string
  readonly methods: readonly string[]
  readonly events: readonly string[]
}

/** One agent's real rules after the plugin's transforms. */
export interface RecordedAgent {
  readonly id: string
  readonly permissions: readonly PermissionRule[]
}

/** What one real-host run recorded. */
export interface HostRun {
  readonly host: "embedded-sdk"
  readonly version: string
  readonly entry?: string | undefined
  readonly definition?: PluginDefinition | undefined
  readonly namespace?: { readonly name: string; readonly description: string } | undefined
  readonly tools: readonly RecordedTool[]
  readonly rpc?: RecordedRpc | undefined
  readonly agents: readonly RecordedAgent[]
  readonly asks: readonly { readonly action: string; readonly resources: readonly string[] }[]
  /** A clean `HOST_UNTESTED` refusal, when the host is outside the plugin's range. */
  readonly refusal?: string | undefined
  /** Any other error `setup` threw, or the host failed with. */
  readonly failure?: string | undefined
  /** The session the host created for activation. */
  readonly sessionID?: string | undefined
  /** Call one RPC method under a session; a refusal is returned, not thrown. */
  call(method: string, input: unknown, options?: { readonly sessionID?: string | undefined; readonly rules?: readonly PermissionRule[] | undefined }): Promise<RpcAnswer>
  /** A session whose rules are exactly `rules`; the plugin's own rules still apply through its agents. */
  session(rules: readonly PermissionRule[]): Promise<string>
  /**
   * Assert one action through the real `ctx.permission.assert` and answer its result: `{ ok: true }` when the host
   * allowed it, or `{ ok: false, code, message }` with the contract code (`PERMISSION_DENIED` for the host's deny and
   * rejection, `UNAVAILABLE` for anything unrecognised). It never throws, so a check can bound its own wait.
   */
  assert(input: { readonly sessionID: string; readonly action: string; readonly resources?: readonly string[] | undefined }): Promise<AssertResult>
  close(): Promise<void>
}

/** One RPC answer or refusal, with the contract code the host reported. */
export type RpcAnswer =
  | { readonly ok: true; readonly output: unknown }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** What one permission assert answered: allowed, or refused with a contract code and the host's line. */
export type AssertResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string }

/** The host's own denials: a deny rule and a rejected ask carry no contract code, only the host's tag. */
const HOST_DENIALS = new Set(["Permission.BlockedError", "Permission.DeclinedError", "Permission.CorrectedError"])

/** The code an error object carries itself: its `data.code`, then its `code`, when either is a non-empty string. */
function reportedCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined
  const held = error as { readonly data?: { readonly code?: unknown } | undefined; readonly code?: unknown }
  const data = held.data?.code
  if (typeof data === "string" && data !== "") return data
  return typeof held.code === "string" && held.code !== "" ? held.code : undefined
}

/** The code `error` maps to: its own, a message in the contract's form, the host's deny, or `UNAVAILABLE`. */
function codeOf(error: unknown): string {
  const reported = reportedCode(error)
  if (reported !== undefined) return reported
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : ""
  const leading = /^([A-Z][A-Z0-9_]*): /.exec(message)?.[1]
  if (leading !== undefined) return leading
  for (const holder of [error, typeof error === "object" && error !== null ? (error as { readonly error?: unknown }).error : undefined]) {
    const tag = typeof holder === "object" && holder !== null ? (holder as { readonly _tag?: unknown })._tag : undefined
    if (typeof tag === "string" && HOST_DENIALS.has(tag)) return "PERMISSION_DENIED"
  }
  return "UNAVAILABLE"
}

/** The one failure shape, with the host's own line: a secret is named by kind and never printed, and a long line is cut. */
export function assertFailure(error: unknown): AssertResult {
  const raw = error instanceof Error ? error.message : String(error)
  const secrets = secretKinds(raw)
  const message = secrets.length === 0 ? raw.slice(0, 300) : `the host's error held a secret (${secrets.join(", ")}), which the kit did not print`
  return { ok: false, code: codeOf(error), message }
}

/** What `createHost` needs. */
export interface HostOptions {
  readonly directory: string
  readonly version: string
  readonly pluginId: string
  /** The plugin's options, as a person's configuration would give them. */
  readonly options?: Readonly<Record<string, unknown>> | undefined
  /** The rules of the activation session. Default: none, so the agent's rules decide. */
  readonly sessionRules?: readonly PermissionRule[] | undefined
  /** The agent the activation session names. Default: `build`. */
  readonly agent?: string | undefined
  readonly timeoutMs?: number | undefined
}

const SDK = ["@opencode", "sdk"].join("/")
const PLUGIN_HOST = ["@opencode", "plugin", "host"].join("/")

/** A runtime module loaded from the plugin repository's devDependencies, or undefined when it is absent. */
async function load<T>(specifier: string): Promise<T | undefined> {
  try {
    return (await import(specifier)) as T
  } catch {
    return undefined
  }
}

interface SdkModule {
  readonly OpenCode: { create(options: Record<string, unknown>): Promise<SdkHost> }
}

interface SdkHost {
  readonly sessions: {
    create(input: Record<string, unknown>): Promise<{ readonly id: string }>
    prompt(input: Record<string, unknown>): Promise<unknown>
  }
  readonly plugin: { list(input: Record<string, unknown>): Promise<{ readonly data: readonly { readonly id?: string; readonly state?: { readonly status?: string; readonly error?: string } }[] }> }
  readonly agent: { list(input: Record<string, unknown>): Promise<{ readonly data: readonly { readonly id: string; readonly permissions: readonly PermissionRule[] }[] }> }
  readonly rpc: { call(input: Record<string, unknown>): Promise<{ readonly output?: unknown }> }
  close(): Promise<void>
}

interface PluginHostModule {
  resolve(input: { readonly directory: string }): { readonly server?: string | undefined }
  load(entrypoint: string): Promise<unknown>
}

/** The entry the real OpenCode resolver names, or a refusal: `./server` then `.`, never `main` or `dist/index.js`. */
export async function pluginEntry(directory: string): Promise<{ readonly entry: string; readonly module: unknown }> {
  const host = await load<PluginHostModule>(PLUGIN_HOST)
  if (host === undefined) throw new HostError("HOST_DEPENDENCY", "the conformance host cannot load @opencode/plugin", "install @opencode/plugin 2.4.1 as a devDependency, and run T1 again")
  const resolved = host.resolve({ directory })
  if (resolved.server === undefined) throw new HostError("HOST_ENTRY", `${directory} has no server entry: package.json maps no ./server or ., and there is no index file`, "add an exports[\"./server\"] entry or an index.js to the plugin")
  return { entry: resolved.server, module: await host.load(resolved.server) }
}

/** The plugin definition a loaded module exports. */
export function definitionOf(module: unknown): PluginDefinition | undefined {
  if (module === null || typeof module !== "object") return undefined
  const record = module as Record<string, unknown>
  const candidate = record["default"] ?? record["plugin"]
  if (candidate === null || typeof candidate !== "object") return undefined
  const definition = candidate as Record<string, unknown>
  if (typeof definition["id"] !== "string" || typeof definition["setup"] !== "function") return undefined
  return definition as unknown as PluginDefinition
}

/** The tools the real context registered, from the editor the plugin's transform saw. */
function toolOf(registration: Record<string, unknown>, namespace: string): RecordedTool {
  const options = (registration["options"] ?? {}) as Record<string, unknown>
  const codemode = options["codemode"]
  return {
    id: `${namespace}_${String(registration["name"] ?? "")}`,
    name: String(registration["name"] ?? ""),
    description: String(registration["description"] ?? ""),
    namespace: typeof options["namespace"] === "string" ? options["namespace"] : namespace,
    permission: typeof options["permission"] === "string" ? options["permission"] : "",
    input: registration["input"],
    output: registration["output"],
    codemode: (typeof codemode === "boolean" || (codemode !== null && typeof codemode === "object") ? codemode : false) as RecordedTool["codemode"],
  }
}

/** Run the plugin in the real host and record what it registered. */
export async function createHost(options: HostOptions): Promise<HostRun> {
  let loaded: { readonly entry: string; readonly module: unknown }
  try {
    loaded = await pluginEntry(options.directory)
  } catch (cause) {
    return emptyRun(options, undefined, cause instanceof Error ? cause.message : String(cause))
  }
  const definition = definitionOf(loaded.module)
  if (definition === undefined) {
    return emptyRun(options, loaded.entry, `the server entry exports no Plugin.define({ id, setup }) value`)
  }
  const sdk = await load<SdkModule>(SDK)
  if (sdk === undefined) {
    return emptyRun(options, loaded.entry, "the conformance host cannot load @opencode/sdk 2.4.1")
  }

  const tools: RecordedTool[] = []
  let namespace: { name: string; description: string } | undefined
  let rpc: RecordedRpc | undefined
  let assertAction: ((input: { sessionID: string; action: string; resources: readonly string[] }) => Promise<void>) | undefined
  const asks: { action: string; resources: readonly string[] }[] = []
  let setupError: string | undefined
  let setupDone = false
  const pluginOptions = options.options ?? {}

  const wrapper: PluginDefinition = {
    id: definition.id,
    async setup(context) {
      const real = context as Record<string, unknown>
      const toolDomain = real["tool"] as { transform(callback: (editor: unknown) => void): Promise<unknown> }
      const permission = real["permission"] as { assert(input: { action: string; resources?: readonly string[] }): Promise<void> }
      const rpcDomain = real["rpc"] as { register(registration: Record<string, unknown>, handlers: Record<string, unknown>): Promise<unknown> }
      const toolProxy = new Proxy(toolDomain, {
        get(toolTarget, field) {
          if (field === "transform") {
            return (callback: (editor: unknown) => void) =>
              toolTarget.transform((editor) => {
                const proxied = new Proxy(editor as Record<string, unknown>, {
                  get(editorTarget, editorField) {
                    if (editorField === "namespace") {
                      return (value: { name: string; description: string }) => {
                        namespace = value
                        return (editorTarget["namespace"] as (value: unknown) => unknown)(value)
                      }
                    }
                    if (editorField === "add") {
                      return (registration: Record<string, unknown>) => {
                        const recorded = toolOf(registration, namespace?.name ?? definition.id)
                        const at = tools.findIndex((tool) => tool.permission === recorded.permission)
                        if (at === -1) tools.push(recorded)
                        else tools[at] = recorded
                        return (editorTarget["add"] as (value: unknown) => unknown)(registration)
                      }
                    }
                    const value = Reflect.get(editorTarget, editorField)
                    return typeof value === "function" ? value.bind(editorTarget) : value
                  },
                })
                return callback(proxied)
              })
          }
          const value = Reflect.get(toolTarget, field)
          return typeof value === "function" ? value.bind(toolTarget) : value
        },
      })
      const rpcProxy = new Proxy(rpcDomain, {
        get(rpcTarget, field) {
          if (field === "register") {
            return (registration: Record<string, unknown>, handlers: Record<string, unknown>) => {
              rpc = {
                id: String(registration["id"] ?? ""),
                methods: Object.keys((registration["methods"] ?? {}) as Record<string, unknown>),
                events: Object.keys((registration["events"] ?? {}) as Record<string, unknown>),
              }
              return rpcTarget.register(registration, handlers)
            }
          }
          const value = Reflect.get(rpcTarget, field)
          return typeof value === "function" ? value.bind(rpcTarget) : value
        },
      })
      const permissionProxy = new Proxy(permission, {
        get(permissionTarget, field) {
          if (field === "assert") {
            return async (input: { action: string; resources?: readonly string[] }) => {
              asks.push({ action: input.action, resources: input.resources ?? [] })
              return permissionTarget.assert(input)
            }
          }
          const value = Reflect.get(permissionTarget, field)
          return typeof value === "function" ? value.bind(permissionTarget) : value
        },
      })
      assertAction = (input) => (permissionProxy as { assert(value: { sessionID: string; action: string; resources: readonly string[] }): Promise<void> }).assert(input)
      const proxy = new Proxy(real, {
        get(target, property) {
          if (property === "options") return pluginOptions
          if (property === "tool") return toolProxy
          if (property === "rpc") return rpcProxy
          if (property === "permission") return permissionProxy
          return Reflect.get(target, property)
        },
      })
      try {
        const cleanup = await definition.setup(proxy)
        if (typeof cleanup === "function") return cleanup
        return undefined
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        const secrets = secretKinds(message)
        setupError = secrets.length === 0 ? message.slice(0, 300) : `the plugin's setup error held a secret (${secrets.join(", ")}), which the kit did not print`
        throw cause
      } finally {
        setupDone = true
      }
    },
  }

  let host: SdkHost
  try {
    host = await sdk.OpenCode.create({
      plugins: [wrapper],
      config: { directory: options.directory },
      app: { name: "opencode", version: options.version },
      log: { level: "error", emit: () => undefined },
    })
  } catch (cause) {
    return emptyRun(options, loaded.entry, `the embedded OpenCode host did not start: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  let sessionID: string | undefined
  try {
    const session = await host.sessions.create({
      location: { directory: options.directory },
      agent: options.agent ?? "build",
      permissions: options.sessionRules ?? [],
    })
    sessionID = session.id
    // A prompt is what makes the SDK acquire the session's plugin instance.
    await host.sessions.prompt({ sessionID: session.id, text: "activate the conformance plugin", delivery: "queue" }).catch(() => undefined)
    await waitForActivation({
      isActive: () => setupDone || setupError !== undefined,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    })
    // The plugin list is the host's own answer; wait for it too when it is available.
    await waitForActivation({
      isActive: async () => {
        const list = await host.plugin.list({ location: { directory: options.directory } }).catch(() => undefined)
        return list?.data.some((entry) => entry.id === definition.id) ?? false
      },
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    }).catch(() => undefined)
  } catch (cause) {
    setupError ??= cause instanceof Error ? cause.message : String(cause)
  }

  const agents = sessionID === undefined ? [] : (await host.agent.list({ location: { directory: options.directory } }).catch(() => ({ data: [] }))).data.map((agent) => ({ id: agent.id, permissions: agent.permissions }))
  const refusal = setupError !== undefined && setupError.startsWith("HOST_UNTESTED:") ? setupError : undefined
  const failure = setupError !== undefined && refusal === undefined ? setupError : undefined

  let closed = false
  return {
    host: "embedded-sdk",
    version: options.version,
    entry: loaded.entry,
    definition,
    ...(namespace === undefined ? {} : { namespace }),
    tools,
    ...(rpc === undefined ? {} : { rpc }),
    agents,
    asks,
    ...(refusal === undefined ? {} : { refusal }),
    ...(failure === undefined ? {} : { failure }),
    ...(sessionID === undefined ? {} : { sessionID }),
    async call(method, input, callOptions = {}) {
      const id = callOptions.sessionID ?? (await host.sessions.create({ location: { directory: options.directory }, agent: options.agent ?? "build", permissions: callOptions.rules ?? [] })).id
      try {
        const answer = await host.rpc.call({ rpcID: definition.id, method, input: { sessionID: id, input }, location: { directory: options.directory } })
        return { ok: true, output: answer?.output }
      } catch (cause) {
        const error = cause as { type?: string; message?: string; data?: { code?: string } }
        return { ok: false, code: error.data?.code ?? error.type ?? "UNAVAILABLE", message: error.message ?? String(cause) }
      }
    },
    async session(rules) {
      const created = await host.sessions.create({ location: { directory: options.directory }, agent: options.agent ?? "build", permissions: rules })
      return created.id
    },
    async assert(input) {
      if (assertAction === undefined) return { ok: false, code: "UNAVAILABLE", message: "the plugin never reached setup, so this run has no permission domain" }
      try {
        await assertAction({ sessionID: input.sessionID, action: input.action, resources: input.resources ?? ["*"] })
        return { ok: true }
      } catch (error) {
        return assertFailure(error)
      }
    },
    async close() {
      if (closed) return
      closed = true
      await host.close().catch(() => undefined)
    },
  }
}

function emptyRun(options: HostOptions, entry: string | undefined, failure: string): HostRun {
  return {
    host: "embedded-sdk",
    version: options.version,
    ...(entry === undefined ? {} : { entry }),
    tools: [],
    agents: [],
    asks: [],
    failure,
    async call() {
      return { ok: false, code: "UNAVAILABLE", message: failure }
    },
    async session() {
      return ""
    },
    async assert() {
      return { ok: false, code: "UNAVAILABLE", message: failure }
    },
    async close() {},
  }
}
