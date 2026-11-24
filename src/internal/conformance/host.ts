/**
 * T1, the host gate: the plugin loads on an OpenCode release, its doors and permissions hold, and an unsupported host
 * is refused cleanly (standard §0.2, contract §16).
 *
 * OpenCode 2.4.1 loads a server plugin by importing its package's `./server` export (or `.` and then `main`) and reading
 * the default `Plugin.define({ id, setup })` value; `@opencode/plugin/host`'s `load` is a dynamic import and `resolve` is
 * the export and conventional-file lookup mirrored here (`node_modules/@opencode/plugin/dist/host.js`). A plugin under
 * test therefore needs no dependency of its own for T1: the kit imports the built file and calls `setup` with a
 * recording context that implements the public `Plugin.Context` surface the contract uses.
 *
 * The recording context records each tool, each RPC registration, each agent's permission rules and each assertion. T1
 * then checks the record: every method is a tool and an RPC method with permission `<name>.<method>`; the access levels
 * hold; and a non-`read` method called over RPC without an ask answered yes is refused (LD-5).
 */
import { existsSync, readFileSync, statSync } from "node:fs"
import { isAbsolute, join } from "node:path"
import { pathToFileURL } from "node:url"
import { OPENCODE_RANGE, type Manifest, type MethodItem } from "../../manifest.ts"
import { evaluate, type PermissionRule } from "../../permission.ts"
import { error, type Finding } from "./report.ts"

/** One tool a plugin registered, as the recording context saw it. */
export interface RecordedTool {
  readonly id: string
  readonly namespace?: string | undefined
  readonly permission?: string | undefined
  readonly pinned: boolean
}

/** One RPC registration. */
export interface RecordedRpc {
  readonly id: string
  readonly methods: readonly string[]
  readonly handlers: Readonly<Record<string, (input: unknown, context: unknown) => Promise<unknown>>>
}

/** One agent's rules, after the plugin's transforms. */
export interface RecordedAgent {
  readonly id: string
  readonly permissions: readonly PermissionRule[]
}

/** What one run of a plugin's `setup` recorded. */
export interface HostRun {
  readonly host: string
  readonly entry?: string | undefined
  readonly definition?: { readonly id: string; readonly setup: (context: unknown) => unknown } | undefined
  /** A clean `HOST_UNTESTED` refusal, when the host is outside the plugin's range. */
  readonly refusal?: string | undefined
  /** Any other error `setup` threw. */
  readonly failure?: string | undefined
  readonly namespace?: { readonly name: string; readonly description: string } | undefined
  readonly tools: readonly RecordedTool[]
  readonly rpc?: RecordedRpc | undefined
  readonly agents: readonly RecordedAgent[]
  readonly assertions: readonly { readonly action: string; readonly resources: readonly string[] }[] | undefined
  readonly emissions: readonly { readonly event: string; readonly data: unknown }[] | undefined
}

/** The default OpenCode release the contract is built and tested against. */
export const SUPPORTED_HOST = "2.4.1"

/** The first release outside the v0 range, for the unsupported-host check. */
export const UNSUPPORTED_HOST = "2.5.0"

/** True when `host` is inside the v0 range (`>=2.4.1 <2.5.0`), as the contract defines it. */
export function hostInRange(host: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(host)
  if (match === null) return false
  const [major, minor, patch] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return major === 2 && minor === 4 && patch >= 1
}

/** The file a package's server entry names, or the problems with finding it. */
export function serverEntry(directory: string): { readonly entry?: string; readonly problems: readonly string[] } {
  const file = join(directory, "package.json")
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return { problems: [`${file} is missing or not JSON`] }
  }
  const exportsValue = pkg["exports"]
  const candidates: string[] = []
  const fromExports = (value: unknown): void => {
    if (typeof value === "string") {
      candidates.push(value)
      return
    }
    if (value === null || typeof value !== "object") return
    const record = value as Record<string, unknown>
    for (const key of "default import node module".split(" ")) fromExports(record[key])
  }
  if (typeof exportsValue === "string") candidates.push(exportsValue)
  else if (exportsValue !== null && typeof exportsValue === "object") {
    const map = exportsValue as Record<string, unknown>
    fromExports(map["./server"])
    fromExports(map["."])
  }
  for (const key of ["module", "main"]) if (typeof pkg[key] === "string") candidates.push(pkg[key] as string)
  candidates.push("dist/index.js", "index.js")
  for (const candidate of candidates) {
    const path = isAbsolute(candidate) ? candidate : join(directory, candidate)
    if (existsSync(path) && statSync(path).isFile()) return { entry: path, problems: [] }
  }
  return { problems: [`no server entry: package.json names none of ./server, . or main, and there is no dist/index.js or index.js`] }
}

/** A permission refusal: what OpenCode's `permission.assert` rejects with when the person says no. */
export function permissionRefusal(): Error {
  return Object.assign(new Error("PERMISSION_DENIED: conformance asked and no one answered. Next step: answer the ask, or present a valid action grant."), { _tag: "Tool.Error" })
}

interface HostOptions {
  readonly directory: string
  readonly host: string
  readonly access: "all" | "ask-changes" | "read-only"
  readonly allowUntestedHost: boolean
  /** What `permission.assert` does: deny, or allow as an answered ask. */
  readonly permission: "deny" | "allow"
}

/** A callable stub for a domain T1 does not inspect. */
const stub = (): unknown =>
  new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : stub()),
    apply: () => Promise.resolve(undefined),
  })

/** An editor over a name → value map: the shape every `transform` receives. */
function editor<T>(values: Map<string, T>) {
  return {
    list: () => [...values.entries()],
    get: (name: string) => values.get(name),
    set: (name: string, value: T) => void values.set(name, value),
    add: (value: T & { id?: string; name?: string }) => void values.set(value.id ?? value.name ?? String(values.size), value),
    update: (name: string, change: (value: T) => void) => {
      const value = values.get(name)
      if (value !== undefined) change(value)
    },
    remove: (name: string) => void values.delete(name),
  }
}

/** Run one plugin's `setup` under the recording host. Never throws for a plugin's own error. */
export async function runPlugin(options: HostOptions): Promise<HostRun> {
  const found = serverEntry(options.directory)
  if (found.entry === undefined) return { host: options.host, tools: [], agents: [], assertions: [], emissions: [], failure: found.problems.join("; ") }

  let loaded: Record<string, unknown>
  try {
    loaded = (await import(`${pathToFileURL(found.entry).href}?conformance=${Date.now()}-${Math.random().toString(36).slice(2)}`)) as Record<string, unknown>
  } catch (cause) {
    return { host: options.host, entry: found.entry, tools: [], agents: [], assertions: [], emissions: [], failure: `the server entry did not load: ${messageOf(cause)}` }
  }
  const candidate = loaded["default"] ?? loaded["plugin"]
  const definition = isDefinition(candidate) ? candidate : undefined
  if (definition === undefined) {
    return { host: options.host, entry: found.entry, tools: [], agents: [], assertions: [], emissions: [], failure: "the server entry exports no Plugin.define({ id, setup }) value" }
  }

  const tools: RecordedTool[] = []
  let namespace: { name: string; description: string } | undefined
  const agents = new Map<string, RecordedAgent>([
    ["build", { id: "build", permissions: [] }],
    ["plan", { id: "plan", permissions: [] }],
  ])
  const agentEditor = {
    list: () => [...agents.values()],
    get: (id: string) => agents.get(id),
    default: () => undefined,
    update: (id: string, change: (value: RecordedAgent) => void) => {
      const value = agents.get(id)
      if (value !== undefined) change(value)
    },
    remove: (id: string) => void agents.delete(id),
  }
  const rpcs: RecordedRpc[] = []
  const assertions: { action: string; resources: readonly string[] }[] = []
  const emissions: { event: string; data: unknown }[] = []
  const integrations = new Map<string, unknown>()
  const servers = new Map<string, unknown>()

  const toolEditor = {
    list: () => tools,
    get: (id: string) => tools.find((tool) => tool.id === id),
    namespace: (value: { name: string; description: string }) => {
      namespace = { name: value.name, description: value.description }
    },
    add: (tool: Record<string, unknown>) => {
      const codemode = tool["codemode"]
      const pinned = (codemode !== null && typeof codemode === "object" && (codemode as Record<string, unknown>)["pinned"] === true) || tool["pinned"] === true
      tools.push({
        id: String(tool["id"] ?? ""),
        ...(typeof tool["namespace"] === "string" ? { namespace: tool["namespace"] } : {}),
        ...(typeof tool["permission"] === "string" ? { permission: tool["permission"] } : {}),
        pinned,
      })
    },
    update: () => undefined,
    remove: () => undefined,
  }

  const context: Record<string, unknown> = {
    app: { name: "opencode", version: options.host, channel: "conformance" },
    location: { directory: options.directory },
    options: { access: options.access, allowUntestedHost: options.allowUntestedHost },
    tool: { transform: (change: (value: typeof toolEditor) => void) => change(toolEditor), list: async () => tools, hook: () => ({ add: () => undefined, remove: () => undefined }) },
    rpc: {
      register: async (definitionValue: { id: string; methods: Record<string, unknown> }, handlers: RecordedRpc["handlers"]) => {
        rpcs.push({ id: definitionValue.id, methods: Object.keys(definitionValue.methods), handlers })
        return { events: { emit: async (event: string, data: unknown) => void emissions.push({ event, data }) } }
      },
      list: async () => rpcs.map((rpc) => ({ id: rpc.id })),
      call: async () => undefined,
    },
    agent: {
      transform: (change: (value: typeof agentEditor) => void) => change(agentEditor),
      list: async () => [...agents.values()],
      get: async (id: string) => agents.get(id),
    },
    permission: {
      assert: async (input: { action: string; resources?: readonly string[] }) => {
        assertions.push({ action: input.action, resources: input.resources ?? [] })
        if (options.permission === "deny") throw permissionRefusal()
      },
      list: async () => [],
      get: async () => undefined,
      reply: async () => undefined,
      hook: () => ({ add: () => undefined, remove: () => undefined }),
    },
    integration: { transform: (change: (value: ReturnType<typeof editor>) => void) => change(editor(integrations)), list: async () => [] },
    mcp: { transform: (change: (value: ReturnType<typeof editor>) => void) => change(editor(servers)), list: async () => [] },
    skill: { transform: () => undefined, list: async () => [], reload: async () => undefined },
    command: { transform: () => undefined, list: async () => [], reload: async () => undefined },
    storage: { get: async () => undefined, set: async () => undefined, remove: async () => undefined, scan: async () => ({ entries: [] }) },
    session: stub(),
    credential: { activate: async () => undefined },
    provider: stub(),
    model: stub(),
    reference: stub(),
    vcs: stub(),
    shell: stub(),
    worktree: stub(),
    websearch: stub(),
    event: stub(),
    generate: stub(),
    aisdk: stub(),
    experiment: stub(),
    experimental: stub(),
    plugin: { list: async () => [] },
  }

  let refusal: string | undefined
  let failure: string | undefined
  try {
    const cleanup = await definition.setup(context)
    if (typeof cleanup === "function") await cleanup()
  } catch (cause) {
    const message = messageOf(cause)
    if (message.startsWith("HOST_UNTESTED:")) refusal = message
    else failure = message
  }
  return {
    host: options.host,
    entry: found.entry,
    definition,
    ...(refusal === undefined ? {} : { refusal }),
    ...(failure === undefined ? {} : { failure }),
    ...(namespace === undefined ? {} : { namespace }),
    tools,
    ...(rpcs[0] === undefined ? {} : { rpc: rpcs[0] }),
    agents: [...agents.values()],
    assertions,
    emissions,
  }
}

function isDefinition(value: unknown): value is { id: string; setup: (context: unknown) => unknown } {
  if (value === null || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return typeof record["id"] === "string" && typeof record["setup"] === "function"
}

const messageOf = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause))

/** Every T1 finding for one host. */
export async function hostFindings(directory: string, manifest: Manifest, host: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const name = manifest.plugin.name
  const supported = hostInRange(host)

  if (!supported) {
    const refused = await runPlugin({ directory, host, access: "all", allowUntestedHost: false, permission: "deny" })
    if (refused.refusal === undefined) {
      findings.push(
        error("T1.unsupported-host", `OpenCode ${host} is outside ${OPENCODE_RANGE}, and the plugin ${refused.failure === undefined ? "started" : `failed with "${refused.failure}"`} instead of refusing with HOST_UNTESTED`, {
          path: "capabilities.plugin.host",
          fix: "Refuse an untested host with HOST_UNTESTED and a next step, unless options.allowUntestedHost is true.",
        }),
      )
    } else if (!refused.refusal.includes("Next step: ")) {
      findings.push(error("T1.unsupported-host", `the refusal of OpenCode ${host} reads "${refused.refusal.slice(0, 160)}", and every failure reads CODE: What happened. Next step: What to do.`, { path: "capabilities.plugin.host" }))
    }
    const allowed = await runPlugin({ directory, host, access: "all", allowUntestedHost: true, permission: "deny" })
    if (allowed.refusal !== undefined) {
      findings.push(error("T1.unsupported-host", `options.allowUntestedHost is true, and the plugin still refused OpenCode ${host}: ${allowed.refusal.slice(0, 160)}`, { path: "capabilities.options.properties.allowUntestedHost" }))
    }
    return findings
  }

  const run = await runPlugin({ directory, host, access: "all", allowUntestedHost: false, permission: "deny" })
  if (run.failure !== undefined) {
    findings.push(error("T1.load", `${name} does not load on OpenCode ${host}: ${run.failure}`, { path: run.entry === undefined ? "package.json" : run.entry, fix: "Build the plugin and fix the error setup reports." }))
    return findings
  }
  if (run.definition === undefined) {
    findings.push(error("T1.load", `${name} loads on OpenCode ${host} and exports no Plugin.define({ id, setup }) value`, { path: "package.json" }))
    return findings
  }
  if (run.definition.id !== name) {
    findings.push(error("T1.id", `the plugin's id is ${run.definition.id}, and capabilities.plugin.name is ${name}`, { path: "package.json" }))
  }
  if (run.namespace === undefined) {
    findings.push(error("T1.doors", `${name} registers no tool namespace`, { path: run.entry, fix: "Call ctx.tool.namespace({ name, description }) before adding tools." }))
  } else if (run.namespace.name !== name) {
    findings.push(error("T1.doors", `the tool namespace is ${run.namespace.name}, and the plugin's name is ${name}`, { path: run.entry }))
  }

  findings.push(...doorFindings(manifest, run))
  findings.push(...(await permissionFindings(directory, manifest, host, run)))
  findings.push(...(await rpcFindings(directory, manifest, host, run)))
  return findings
}

/** Every declared non-MCP method is a tool and an RPC method, and nothing else is. */
function doorFindings(manifest: Manifest, run: HostRun): Finding[] {
  const findings: Finding[] = []
  const name = manifest.plugin.name
  const declared = Object.keys(manifest.methods).filter((method) => !method.startsWith("mcp:"))
  const permissions = new Set(run.tools.map((tool) => tool.permission).filter((permission): permission is string => permission !== undefined))
  for (const method of declared) {
    const permission = `${name}.${method}`
    if (!permissions.has(permission)) {
      findings.push(error("T1.doors", `${method} is declared and no agent tool has the permission ${permission}`, { path: `capabilities.methods.${method}`, fix: "Register every method through contract.register, which adds the tool and its permission." }))
    }
    if (run.rpc === undefined || !run.rpc.methods.includes(method)) {
      findings.push(error("T1.doors", `${method} is declared and the RPC registration ${run.rpc?.id ?? "(none)"} does not carry it`, { path: `capabilities.methods.${method}`, fix: "Register every method through contract.register, whose one RPC registration carries them all." }))
    }
  }
  for (const tool of run.tools) {
    if (tool.permission === undefined) {
      findings.push(error("T1.doors", `the tool ${tool.id} carries no permission, and every tool is permitted as ${name}.<method>`, { path: run.entry }))
      continue
    }
    if (!tool.permission.startsWith(`${name}.`)) {
      findings.push(error("T1.doors", `the tool ${tool.id} is permitted as ${tool.permission}, outside the plugin's namespace ${name}.`, { path: run.entry }))
      continue
    }
    const method = tool.permission.slice(name.length + 1)
    if (!declared.includes(method)) findings.push(error("T1.doors", `the tool ${tool.id} is registered for ${method}, which capabilities.methods does not declare`, { path: run.entry }))
    if (tool.namespace !== undefined && tool.namespace !== name) findings.push(error("T1.doors", `the tool ${tool.id} is in the namespace ${tool.namespace}, not ${name}`, { path: run.entry }))
  }
  if (run.rpc !== undefined && run.rpc.id !== name) findings.push(error("T1.doors", `the RPC registration's id is ${run.rpc.id}, and the plugin's name is ${name}`, { path: run.entry }))
  for (const method of run.rpc?.methods ?? []) {
    if (!declared.includes(method)) findings.push(error("T1.doors", `the RPC registration carries ${method}, which capabilities.methods does not declare`, { path: run.entry }))
  }
  return findings
}

/** The access matrix holds for every agent at every level. */
async function permissionFindings(directory: string, manifest: Manifest, host: string, all: HostRun): Promise<Finding[]> {
  if (all.agents.every((agent) => agent.permissions.length === 0)) {
    return [
      error("T1.permissions", `${manifest.plugin.name} installs no permission rules, so an agent keeps its own defaults`, {
        path: "src/index.ts",
        fix: "Generate the access rules into every agent with ctx.agent.transform, as contract §6 requires.",
      }),
    ]
  }
  const findings: Finding[] = []
  for (const level of ["all", "ask-changes", "read-only"] as const) {
    const run = level === "all" ? all : await runPlugin({ directory, host, access: level, allowUntestedHost: false, permission: "deny" })
    if (run.failure !== undefined) continue // the load finding already names it
    for (const agent of run.agents) {
      for (const [method, item] of Object.entries(manifest.methods)) {
        const expected = accessEffect(level, item)
        const actual = evaluate(agent.permissions, `${manifest.plugin.name}.${method}`, "*")
        if (actual === expected) continue
        findings.push(
          error("T1.permissions", `access ${level} gives ${agent.id} ${actual} for ${method}, and the contract gives ${expected}`, {
            path: `capabilities.methods.${method}`,
            fix: "Generate the access rules from the access setting and each method's class and effect.",
          }),
        )
      }
    }
  }
  return findings
}

/** What §6's access table gives a method at one level, with the method's own effect last. */
export function accessEffect(level: "all" | "ask-changes" | "read-only", item: Pick<MethodItem, "class" | "effect">): "allow" | "ask" | "deny" {
  if (level === "all") return "allow"
  if (item.effect === "deny") return "deny"
  if (level === "read-only") {
    if (item.effect === "ask") return "ask"
    return item.class === "read" ? "allow" : "deny"
  }
  if (item.effect !== undefined) return item.effect
  return item.class === "read" ? "allow" : "ask"
}

/** LD-5: a non-read method called over RPC without an answered ask is refused; with the ask answered, it is not. */
async function rpcFindings(directory: string, manifest: Manifest, host: string, run: HostRun): Promise<Finding[]> {
  const rpc = run.rpc
  if (rpc === undefined) return []
  const fixture = recordedInputs(directory)
  const findings: Finding[] = []
  const allowed = await runPlugin({ directory, host, access: "all", allowUntestedHost: false, permission: "allow" })
  for (const [method, item] of Object.entries(manifest.methods)) {
    if (item.class === "read" || method.startsWith("mcp:")) continue
    const handler = rpc.handlers[method]
    if (handler === undefined) continue // the doors finding names it
    const input = { sessionID: "ses_conformance", input: fixture[method] ?? {} }
    const signal = new AbortController().signal
    const context = { signal, error: (type: string, message: string) => ({ type, message }) }
    const denied = await call(handler, input, context)
    if (!denied.refused) {
      findings.push(
        error("T1.rpc-confirmation", `${method} is class ${item.class} and its RPC call ran with no answered ask and no grant`, {
          path: `capabilities.methods.${method}`,
          fix: "Refuse a non-read method over RPC unless an ask was answered or a valid action grant verifies (contract §8).",
        }),
      )
    }
    const handlerAllowed = allowed.rpc?.handlers[method]
    if (handlerAllowed === undefined) continue
    const answered = await call(handlerAllowed, input, context)
    if (answered.message?.startsWith("PERMISSION_DENIED:")) {
      findings.push(error("T1.rpc-confirmation", `${method} refused an RPC call whose ask was answered yes`, { path: `capabilities.methods.${method}` }))
    }
  }
  return findings
}

/** One handler call: whether it refused for permission, and what it said. */
async function call(handler: (input: unknown, context: unknown) => Promise<unknown>, input: unknown, context: unknown): Promise<{ refused: boolean; message?: string }> {
  try {
    const answer = await handler(input, context)
    const text = JSON.stringify(answer ?? "")
    return { refused: text.includes("PERMISSION_DENIED"), ...(text.includes("PERMISSION_DENIED") ? { message: text } : {}) }
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    return { refused: message.startsWith("PERMISSION_DENIED:"), message }
  }
}

const recordedInputsCache = new Map<string, Record<string, unknown>>()

/** The fixture's `rpc.inputs`, as a method → input map. */
function recordedInputs(directory: string): Record<string, unknown> {
  const cached = recordedInputsCache.get(directory)
  if (cached !== undefined) return cached
  let inputs: Record<string, unknown> = {}
  try {
    const fixture = JSON.parse(readFileSync(join(directory, "fixtures", "conformance.json"), "utf8")) as { rpc?: { inputs?: Record<string, unknown> } }
    inputs = fixture.rpc?.inputs ?? {}
  } catch {
    inputs = {}
  }
  recordedInputsCache.set(directory, inputs)
  return inputs
}
