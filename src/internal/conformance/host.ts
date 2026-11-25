/**
 * T1, the host gate on the real embedded OpenCode 2.4.1 host.
 *
 * The plugin is loaded by OpenCode's own resolver and run in the embedded `@opencode/sdk` host (`../host`). T1 does not
 * invent a context: it records what the real `ctx` registered and then checks the record:
 *
 * - the plugin id is the manifest's name (`T1.id`);
 * - every non-MCP method is a tool with permission `<name>.<method>`, exposed to Code Mode, and an RPC method under
 *   `<name>`, with the declared bus events in its events block (`T1.doors`, `T1.codemode`, `T1.events`);
 * - the access matrix holds for every real agent at `all`, `ask-changes` and `read-only`, using `effectFor` from
 *   `./access` (`T1.permissions`);
 * - a non-read method over RPC with an allow rule and no grant is refused (LD-5, `T1.rpc-confirmation`);
 * - a grant for one alias cannot reach another alias's MCP tool (`T1.grant-alias`);
 * - a pinned tool matches the manifest and its signature stays within the Code Mode budget (`T1.pinned`);
 * - two aliases ask for a missing account and refuse an unknown one against the running plugin (`T1.accounts`).
 *
 * An unsupported release must refuse with `HOST_UNTESTED` and a next step, unless `allowUntestedHost` is true.
 */
import { effectFor, evaluate, serverOf, sessionRules, toolAction, type AccessLevel, type PermissionRule } from "../../access.ts"
import { hostInRange, OPENCODE_RANGE, type Manifest } from "../../manifest.ts"
import { createHost, type HostRun } from "../host/index.ts"
import { error, warning, type Finding } from "./report.ts"

/** The release the contract is built and tested against. */
export const SUPPORTED_HOST = "2.4.1"

/** The first release outside the v0 range, for the unsupported-host check. */
export const UNSUPPORTED_HOST = "2.5.0"

/** The Node major a real host needs: `@opencode/sdk` 2.4.1 uses `await using`. */
const nodeMajor = Number(process.versions.node.split(".")[0])

/** The runtime's real-host problem, or undefined when T1 can run. Bun parses `await using` too. */
export function hostRuntimeProblem(nodeVersion: string = process.versions.node, bunVersion: string | null = (process.versions as { readonly bun?: string | undefined }).bun ?? null): Finding | undefined {
  if (bunVersion !== null) return undefined
  if (Number(nodeVersion.split(".")[0]) >= 24) return undefined
  return error("T1.host-unavailable", "T1 needs Node 24 or Bun", {
    path: "package.json",
    fix: "Run T1 on Node 24 or Bun; Node 22 cannot parse the embedded host's `await using`.",
  })
}

/** What a T1 check found, the real run it judged, and the check ids that ran. */
export interface HostInspection {
  readonly findings: readonly Finding[]
  readonly run?: HostRun | undefined
  readonly checks?: readonly string[] | undefined
}

/** Every T1 finding for one host, and the real run when it happened. */
export async function inspectHost(directory: string, manifest: Manifest, host: string, options: { readonly accounts?: readonly string[]; readonly realAccounts?: boolean | undefined; readonly accountMethod?: string | undefined; readonly accountCursor?: { readonly method?: unknown; readonly account?: unknown; readonly other?: unknown } | undefined; readonly inputs?: Readonly<Record<string, unknown>> } = {}): Promise<HostInspection> {
  const runtime = hostRuntimeProblem()
  if (runtime !== undefined) return { findings: [runtime] }
  const supported = hostInRange(host)
  const pluginOptions = { access: "all", ...(options.accounts === undefined || options.accounts.length === 0 ? {} : { accounts: Object.fromEntries(options.accounts.map((alias) => [alias, {}])) }) }

  if (!supported) {
    const refused = await createHost({ directory, version: host, pluginId: manifest.plugin.name, options: { ...pluginOptions, allowUntestedHost: false } })
    try {
      if (refused.refusal === undefined) {
        return {
          run: refused,
          findings: [
            error("T1.unsupported-host", `OpenCode ${host} is outside ${OPENCODE_RANGE}, and the plugin ${refused.failure === undefined ? "started" : `failed with "${refused.failure}"`} instead of refusing with HOST_UNTESTED`, {
              path: "capabilities.plugin.host",
              fix: "Refuse an untested host with HOST_UNTESTED and a next step, unless options.allowUntestedHost is true.",
            }),
          ],
        }
      }
      const findings: Finding[] = []
      if (!refused.refusal.includes("Next step: ")) findings.push(error("T1.unsupported-host", `the refusal of OpenCode ${host} reads "${refused.refusal.slice(0, 160)}", and every failure reads CODE: What happened. Next step: What to do.`, { path: "capabilities.plugin.host" }))
      return { run: refused, findings, checks: ["T1.unsupported-host"] }
    } finally {
      await refused.close()
    }
  }

  const run = await createHost({ directory, version: host, pluginId: manifest.plugin.name, options: pluginOptions })
  try {
    if (run.refusal !== undefined) {
      return {
        run,
        findings: [error("T1.load", `the plugin refused OpenCode ${host}, which its manifest says it supports: ${run.refusal.slice(0, 160)}`, { path: "capabilities.plugin.host" })],
      }
    }
    if (run.failure !== undefined) {
      const dependency = run.failure.includes("@opencode/sdk") ? "@opencode/sdk" : run.failure.includes("@opencode/plugin") ? "@opencode/plugin" : undefined
      return {
        run,
        findings: [
          dependency === undefined
            ? error("T1.load", `${manifest.plugin.name} does not load on OpenCode ${host}: ${run.failure}`, { path: run.entry ?? "package.json", fix: "Build the plugin and fix the error setup reports." })
            : error("T1.host", `the conformance host cannot load ${dependency}`, { path: "package.json", fix: `Add ${dependency} 2.4.1 as a devDependency and run T1 again.` }),
        ],
      }
    }
    if (run.definition === undefined) return { run, findings: [error("T1.load", `${manifest.plugin.name} loads on OpenCode ${host} and exports no Plugin.define({ id, setup }) value`, { path: "package.json" })] }

    const findings: Finding[] = []
    if (run.definition.id !== manifest.plugin.name) findings.push(error("T1.id", `the plugin's id is ${run.definition.id}, and capabilities.plugin.name is ${manifest.plugin.name}`, { path: "package.json" }))
    if (run.namespace === undefined) findings.push(error("T1.doors", `${manifest.plugin.name} registers no tool namespace`, { path: run.entry, fix: "Call ctx.tool.namespace({ name, description }) before adding tools." }))
    else if (run.namespace.name !== manifest.plugin.name) findings.push(error("T1.doors", `the tool namespace is ${run.namespace.name}, and the plugin's name is ${manifest.plugin.name}`, { path: run.entry }))
    findings.push(...doorFindings(manifest, run))
    findings.push(...codemodeFindings(manifest, run))
    findings.push(...eventFindings(manifest, run))
    findings.push(...pinnedFindings(manifest, run))
    findings.push(...(await permissionFindings(directory, manifest, host, run, pluginOptions, options.accounts ?? [])))
    findings.push(...(await rpcFindings(manifest, run, options.inputs ?? {}, options.accounts ?? [])))
    findings.push(...(await grantAliasFindings(manifest, run, options.accounts ?? [])))
    if (options.realAccounts === true) findings.push(...(await accountFindings(manifest, run, options.accounts ?? [], options.inputs ?? {}, options.accountMethod, options.accountCursor)))
    const checks = ["T1.id", "T1.doors", "T1.codemode", "T1.events", "T1.pinned", "T1.permissions"]
    if (run.rpc !== undefined) checks.push("T1.rpc-confirmation")
    if (grantAliasApplies(manifest, options.accounts ?? [])) checks.push("T1.grant-alias")
    if (options.realAccounts === true && manifest.accounts !== undefined && (options.accounts ?? []).length >= 2) checks.push("T1.accounts")
    return { run, findings, checks }
  } finally {
    await run.close()
  }
}

/** The real registered namespace text, or undefined when the host cannot run here. */
export async function namespaceOf(directory: string, manifest: Manifest, host = SUPPORTED_HOST): Promise<string | undefined> {
  if (nodeMajor < 24) return undefined
  try {
    const run = await createHost({ directory, version: host, pluginId: manifest.plugin.name, options: { access: "all" } })
    try {
      return run.namespace?.description
    } finally {
      await run.close()
    }
  } catch {
    return undefined
  }
}

/** T1 findings only, for `t1`. */
export async function hostFindings(directory: string, manifest: Manifest, host: string, options: { readonly accounts?: readonly string[]; readonly realAccounts?: boolean | undefined; readonly accountMethod?: string | undefined; readonly accountCursor?: { readonly method?: unknown; readonly account?: unknown; readonly other?: unknown } | undefined; readonly inputs?: Readonly<Record<string, unknown>> } = {}): Promise<Finding[]> {
  return [...(await inspectHost(directory, manifest, host, options)).findings]
}

/** Every declared non-MCP method is a tool and an RPC method, and nothing else is. */
function doorFindings(manifest: Manifest, run: HostRun): Finding[] {
  const findings: Finding[] = []
  const name = manifest.plugin.name
  const declared = Object.keys(manifest.methods).filter((method) => !method.startsWith("mcp:"))
  const permissions = new Set(run.tools.map((tool) => tool.permission))
  for (const method of declared) {
    if (!permissions.has(`${name}.${method}`)) findings.push(error("T1.doors", `${method} is declared and no agent tool has the permission ${name}.${method}`, { path: `capabilities.methods.${method}`, fix: "Register every method through contract.register, which adds the tool and its permission." }))
    if (run.rpc === undefined || !run.rpc.methods.includes(method)) findings.push(error("T1.doors", `${method} is declared and the RPC registration ${run.rpc?.id ?? "(none)"} does not carry it`, { path: `capabilities.methods.${method}`, fix: "Register every method through contract.register, whose one RPC registration carries them all." }))
  }
  for (const tool of run.tools) {
    if (tool.permission === "") {
      findings.push(error("T1.doors", `the tool ${tool.id} carries no permission, and every tool is permitted as ${name}.<method>`, { path: run.entry }))
      continue
    }
    if (!tool.permission.startsWith(`${name}.`)) {
      findings.push(error("T1.doors", `the tool ${tool.id} is permitted as ${tool.permission}, outside the plugin's namespace ${name}.`, { path: run.entry }))
      continue
    }
    const method = tool.permission.slice(name.length + 1)
    if (!declared.includes(method)) findings.push(error("T1.doors", `the tool ${tool.id} is registered for ${method}, which capabilities.methods does not declare`, { path: run.entry }))
    if (tool.namespace !== name) findings.push(error("T1.doors", `the tool ${tool.id} is in the namespace ${tool.namespace}, not ${name}`, { path: run.entry }))
  }
  if (run.rpc !== undefined && run.rpc.id !== name) findings.push(error("T1.doors", `the RPC registration's id is ${run.rpc.id}, and the plugin's name is ${name}`, { path: run.entry }))
  for (const method of run.rpc?.methods ?? []) {
    if (!declared.includes(method)) findings.push(error("T1.doors", `the RPC registration carries ${method}, which capabilities.methods does not declare`, { path: run.entry }))
  }
  return findings
}

/** Every tool is in Code Mode; only a declared pinned method is pinned. */
function codemodeFindings(manifest: Manifest, run: HostRun): Finding[] {
  const findings: Finding[] = []
  for (const tool of run.tools) {
    const method = tool.permission.startsWith(`${manifest.plugin.name}.`) ? tool.permission.slice(manifest.plugin.name.length + 1) : undefined
    if (tool.codemode === false) findings.push(error("T1.codemode", `${tool.permission || tool.id} is not exposed to Code Mode`, { path: method === undefined ? undefined : `capabilities.methods.${method}`, fix: "Every method is in Code Mode (§9); do not pass codemode: false." }))
    const pinned = typeof tool.codemode === "object" && tool.codemode !== null && tool.codemode.pinned === true
    if (pinned && method !== undefined && manifest.methods[method]?.pinned !== true) findings.push(error("T1.codemode", `${tool.permission} is pinned in Code Mode, and capabilities.methods does not declare pinned: true`, { path: `capabilities.methods.${method}.pinned` }))
    if (!pinned && method !== undefined && manifest.methods[method]?.pinned === true) findings.push(error("T1.codemode", `${method} declares pinned: true and its Code Mode entry is not pinned`, { path: `capabilities.methods.${method}.pinned` }))
  }
  return findings
}

/** The RPC events block declares exactly the manifest's bus events, and no other. */
function eventFindings(manifest: Manifest, run: HostRun): Finding[] {
  const declared = Object.keys(manifest.events)
  const registered = run.rpc?.events ?? []
  const findings: Finding[] = []
  for (const event of declared) if (!registered.includes(event)) findings.push(error("T1.events", `the RPC registration does not carry the declared bus event ${event}`, { path: `capabilities.events.${event}`, fix: "Register the events block with the manifest's events through contract.register." }))
  for (const event of registered) if (!declared.includes(event)) findings.push(error("T1.events", `the RPC registration carries ${event}, which capabilities.events does not declare`, { path: "capabilities.events" }))
  return findings
}

/** The pinned tool exists, is the one pinned tool, and its signature is within the Code Mode budget. */
function pinnedFindings(manifest: Manifest, run: HostRun): Finding[] {
  const findings: Finding[] = []
  const pinned = run.tools.filter((tool) => typeof tool.codemode === "object" && tool.codemode !== null && tool.codemode.pinned === true)
  if (pinned.length > 1) findings.push(error("T1.pinned", `${pinned.length} tools are pinned, and at most one is`, { path: "capabilities.methods" }))
  for (const [method, item] of Object.entries(manifest.methods)) {
    if (item.pinned !== true || method.startsWith("mcp:")) continue
    const tool = run.tools.find((entry) => entry.permission === `${manifest.plugin.name}.${method}`)
    if (tool === undefined) continue // doors names it
    const tokens = Math.ceil((JSON.stringify([run.namespace?.description ?? "", tool.description, tool.input]).length) / 4)
    if (tokens > 1000) findings.push(error("T1.pinned-budget", `${method}'s pinned signature is about ${tokens} tokens, over the 1,000-token budget`, { path: `capabilities.methods.${method}.pinned`, fix: "Trim the pinned tool's description or input schema, or unpin it." }))
  }
  return findings
}

/** The dotted MCP action for each alias, as `access.rulesFor` derives it. */
function mcpActions(name: string, tool: string, aliases: readonly string[]): readonly string[] {
  const declared = aliases.length === 0 ? ["default"] : aliases
  return declared.flatMap((alias) => {
    const server = serverOf(name, alias, declared)
    return server.ok ? [toolAction(server.value, tool)] : []
  })
}

/** The access matrix holds for every real agent at every level, using the one `effectFor`. */
async function permissionFindings(directory: string, manifest: Manifest, host: string, all: HostRun, options: Readonly<Record<string, unknown>>, aliases: readonly string[]): Promise<Finding[]> {
  const findings: Finding[] = []
  if (all.agents.every((agent) => agent.permissions.length === 0)) {
    return [error("T1.permissions", `${manifest.plugin.name} installs no permission rules, so an agent keeps its own defaults`, { path: "src/index.ts", fix: "Generate the access rules into every agent with ctx.agent.transform, as contract §6 requires." })]
  }
  const levels = Object.values(manifest.methods).every((item) => item.class === "read" && item.effect === undefined) ? (["all"] as const) : (["all", "ask-changes", "read-only"] as const)
  for (const level of levels) {
    const run = level === "all" ? all : await createHost({ directory, version: host, pluginId: manifest.plugin.name, options: { ...options, access: level } })
    try {
      if (run.failure !== undefined) continue
      for (const agent of run.agents) {
        // An agent whose last catch-all rule is deny is narrowed by its own configuration, which a plugin must not
        // widen; the access rules cannot decide it. The primary agents are the ones the transform guards.
        if (evaluate(agent.permissions, "*", "*") === "deny") continue
        for (const [method, item] of Object.entries(manifest.methods)) {
          const expected = effectFor(item, level as AccessLevel)
          const actions = method.startsWith("mcp:") ? mcpActions(manifest.plugin.name, method.slice("mcp:".length), aliases) : [`${manifest.plugin.name}.${method}`]
          for (const action of actions) {
            const actual = evaluate(agent.permissions, action, "*")
            if (actual === expected) continue
            findings.push(error("T1.permissions", `access ${level} gives ${agent.id} ${actual} for ${action}, and the contract gives ${expected}`, { path: `capabilities.methods.${method}`, fix: "Generate the access rules from the access setting and each method's class and effect." }))
          }
        }
      }
    } finally {
      if (level !== "all") await run.close()
    }
  }
  return findings
}

/** LD-5: a non-read RPC method with an allow rule and no grant is refused; with no permission check it runs. */
async function rpcFindings(manifest: Manifest, run: HostRun, inputs: Readonly<Record<string, unknown>>, aliases: readonly string[]): Promise<Finding[]> {
  if (run.rpc === undefined) return []
  const findings: Finding[] = []
  const rules: PermissionRule[] = [{ action: "*", resource: "*", effect: "allow" }]
  const account = aliases[0]
  for (const [method, item] of Object.entries(manifest.methods)) {
    if (item.class === "read" || method.startsWith("mcp:")) continue
    let input = { ...(inputs[method] ?? {}) } as Record<string, unknown>
    if (item.commits !== undefined) {
      // A commit takes only the planId its planning method answered; plan first, as a person would.
      const planned = await run.call(item.commits, { ...(inputs[item.commits] ?? {}), ...(account === undefined ? {} : { account }) }, { rules })
      const planId = planned.ok && planned.output !== null && typeof planned.output === "object" ? (planned.output as { planId?: unknown }).planId : undefined
      if (typeof planId !== "string") {
        findings.push(warning("T1.rpc-confirmation", `${method} commits ${item.commits}, whose plan did not answer a planId, so LD-5 is unproven for it`, { path: `capabilities.methods.${method}` }))
        continue
      }
      input = { planId }
    } else if (account !== undefined && item.accounts === "optional" && input["account"] === undefined) {
      input = { ...input, account }
    }
    const answer = await run.call(method, input, { rules })
    if (answer.ok || answer.code !== "PERMISSION_DENIED") {
      findings.push(error("T1.rpc-confirmation", `${method} is class ${item.class} and its RPC call ran with an allow rule and no grant${answer.ok ? "" : ` (${answer.code})`}`, { path: `capabilities.methods.${method}`, fix: "Refuse a non-read method over RPC unless an ask was answered or a valid action grant verifies (contract §8)." }))
    }
  }
  return findings
}

/**
 * The grant fence is per alias: a grant for one alias's source allows that alias's MCP tool and denies every other
 * alias's, on the real session and the real `ctx.permission.assert`. The mcp example proves it in the self-test.
 */
function grantAliasApplies(manifest: Manifest, aliases: readonly string[]): boolean {
  return (
    aliases.length >= 2 &&
    Object.keys(manifest.methods).some((method) => method.startsWith("mcp:")) &&
    manifest.sources.some((entry) => (entry.operations ?? []).some((operation) => !operation.includes(".")))
  )
}

async function grantAliasFindings(manifest: Manifest, run: HostRun, aliases: readonly string[]): Promise<Finding[]> {
  if (!grantAliasApplies(manifest, aliases)) return []
  const source = manifest.sources.find((entry) => (entry.operations ?? []).some((operation) => !operation.includes(".")))
  if (source === undefined) return []
  const operation = (source.operations ?? []).find((entry) => !entry.includes("."))
  const first = aliases[0]
  const second = aliases[1]
  if (operation === undefined || first === undefined || second === undefined) return []
  const works = serverOf(manifest.plugin.name, first, aliases)
  const other = serverOf(manifest.plugin.name, second, aliases)
  if (!works.ok || !other.ok) return []
  const fenced = sessionRules(source, { source: source.id, account: first }, aliases)
  if (!fenced.ok) {
    return [error("T1.grant-alias", `a grant for ${first} could not compile to session rules: ${fenced.problems.join("; ")}`, { path: `capabilities.sources.${source.id}`, fix: "Declare an operation that derives a fenced rule for each alias." })]
  }
  const allowed = toolAction(works.value, operation)
  const denied = toolAction(other.value, operation)
  const sessionID = await run.session(fenced.value)
  const findings: Finding[] = []
  try {
    await run.assert({ sessionID, action: allowed, resources: ["*"] })
  } catch {
    findings.push(
      error("T1.grant-alias", `a grant for ${first} does not allow its own tool ${allowed}`, {
        path: `capabilities.sources.${source.id}`,
        fix: "Derive the fenced rule from operationRule, so the granted alias's MCP tool is allowed.",
      }),
    )
  }
  try {
    await run.assert({ sessionID, action: denied, resources: ["*"] })
    findings.push(
      error("T1.grant-alias", `a grant for ${first} allows ${second}'s tool ${denied}, so one alias can reach another alias's tools`, {
        path: `capabilities.sources.${source.id}`,
        fix: "Compile the grant to the granted alias's server only, never to a wildcard that matches another alias.",
      }),
    )
  } catch {
    // The real host denies the other alias's tool, as the fence requires.
  }
  return findings
}

/** Two aliases, on the running plugin: a missing account and an unknown one are the contract's refusals. */
async function accountFindings(manifest: Manifest, run: HostRun, aliases: readonly string[], inputs: Readonly<Record<string, unknown>>, preferred?: string, cursor?: { readonly method?: unknown; readonly account?: unknown; readonly other?: unknown }): Promise<Finding[]> {
  if (manifest.accounts === undefined || aliases.length < 2) return []
  const method = preferred !== undefined && manifest.methods[preferred]?.accounts === "optional" ? preferred : Object.keys(manifest.methods).find((name) => manifest.methods[name]?.accounts === "optional" && !name.startsWith("mcp:"))
  if (method === undefined) return []
  const findings: Finding[] = []
  const base = inputs[method] ?? {}
  const missing = await run.call(method, base, {})
  if (missing.ok || missing.code !== "ACCOUNT_REQUIRED") findings.push(error("T1.accounts", `${method} with two aliases and no account answered ${missing.ok ? "a result" : missing.code}, not ACCOUNT_REQUIRED`, { path: `capabilities.methods.${method}.accounts` }))
  const unknown = await run.call(method, { ...base, account: "nobodyhere" }, {})
  if (unknown.ok || unknown.code !== "ACCOUNT_UNKNOWN") findings.push(error("T1.accounts", `${method} with the unknown alias nobodyhere answered ${unknown.ok ? "a result" : unknown.code}, not ACCOUNT_UNKNOWN`, { path: `capabilities.methods.${method}.accounts` }))
  const cursorMethod = typeof cursor?.method === "string" && manifest.methods[cursor.method] !== undefined ? cursor.method : method === "events_list" ? method : undefined
  const first = typeof cursor?.account === "string" && aliases.includes(cursor.account) ? cursor.account : aliases[0]
  const second = typeof cursor?.other === "string" && aliases.includes(cursor.other) ? cursor.other : aliases[1]
  if (cursorMethod !== undefined && first !== undefined && second !== undefined && first !== second) {
    const issued = await run.call(cursorMethod, { ...(inputs[cursorMethod] ?? {}), account: first }, {})
    const token = issued.ok && issued.output !== null && typeof issued.output === "object" ? (issued.output as { cursor?: unknown }).cursor : undefined
    if (typeof token === "string") {
      const crossed = await run.call(cursorMethod, { ...(inputs[cursorMethod] ?? {}), account: second, cursor: token }, {})
      if (crossed.ok || crossed.code !== "CURSOR_INVALID") findings.push(error("T1.accounts", `${first}'s cursor read under ${second} answered ${crossed.ok ? "a page" : crossed.code}, not CURSOR_INVALID`, { path: `capabilities.methods.${cursorMethod}.accounts` }))
    }
  }
  return findings
}
