// The test plugins' server part, as a JavaScript file because a plugin entry is JavaScript at run time.
//
// `index.js` in a temporary plugin directory imports this module and calls `defineTestPlugin(directory, options)`. It
// follows the same public host API as the examples: ctx.tool.transform, ctx.rpc.register, ctx.agent.transform,
// ctx.permission.assert and ctx.app.version. `options` lets a test break one thing at a time.
import { readFileSync } from "node:fs"

function inRange(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  return match !== null && Number(match[1]) === 2 && Number(match[2]) === 4 && Number(match[3]) >= 1
}

function accessEffect(level, item) {
  if (level === "all") return "allow"
  if (item.effect === "deny") return "deny"
  if (level === "read-only") {
    if (item.effect === "ask") return "ask"
    return item.class === "read" ? "allow" : "deny"
  }
  if (item.effect !== undefined) return item.effect
  return item.class === "read" ? "allow" : "ask"
}

export function defineTestPlugin(directory, options = {}) {
  const pkg = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"))
  const manifest = pkg.capabilities
  const name = manifest.plugin.name
  return {
    id: options.id ?? name,
    setup(context) {
      if (options.throwOnLoad === true) throw new Error("the test plugin cannot start")
      if (!inRange(context.app.version) && context.options?.allowUntestedHost !== true && options.refuseUntested !== false) {
        throw new Error(`HOST_UNTESTED: ${name} supports >=2.4.1 <2.5.0, and OpenCode ${context.app.version} is outside it. Next step: install 2.4.1.`)
      }
      const methods = Object.entries(manifest.methods).filter(([method]) => !method.startsWith("mcp:"))
      if (options.noNamespace !== true) {
        context.tool.transform((tool) => {
          tool.namespace({ name, description: manifest.plugin.summary })
          for (const [method, item] of methods) {
            tool.add({
              id: `${name}_${method}`,
              namespace: name,
              permission: `${name}.${method}`,
              description: method,
              ...(item.pinned === true ? { codemode: { pinned: true } } : {}),
              execute: async () => ({}),
            })
          }
        })
      }
      if (options.noRpc !== true) {
        context.rpc.register(
          {
            id: name,
            methods: Object.fromEntries(methods.map(([method]) => [method, { input: { type: "object" }, output: { type: "object" } }])),
            events: { changed: { schema: { type: "object" } } },
          },
          Object.fromEntries(
            methods.map(([method, item]) => [
              method,
              async (input) => {
                const unchecked = options.uncheckedRpc === true || (Array.isArray(options.uncheckedRpc) && options.uncheckedRpc.includes(method))
                if (item.class !== "read" && !unchecked) {
                  await context.permission.assert({ sessionID: input.sessionID ?? "ses_conformance", action: `${name}.${method}`, resources: ["*"] })
                }
                return { method, ok: true }
              },
            ]),
          ),
        )
      }
      if (options.noRules !== true) {
        context.agent.transform((agents) => {
          for (const agent of agents.list()) {
            agents.update(agent.id, (info) => {
              info.permissions.push({ action: `${name}.*`, resource: "*", effect: "allow" })
              for (const [method, item] of methods) {
                const effect = accessEffect(context.options?.access ?? "all", item)
                if (effect !== "allow") info.permissions.push({ action: `${name}.${method}`, resource: "*", effect })
              }
            })
          }
        })
      }
    },
  }
}
