// The example plugins' shared server part: one `Plugin.define({ id, setup })` value built from the example's
// `capabilities` manifest. It writes no provider code: the examples exist so a consumer and the conformance kit can read
// a real installed package, and so T1 can load a real plugin and see its doors, permissions and LD-5 refusal.
//
// Everything here is deliberately small. A real plugin calls `contract.register` and `contract.access`; the examples
// stand in for them until those modules land, and follow the same public host API: `ctx.tool.transform`,
// `ctx.rpc.register`, `ctx.agent.transform`, `ctx.permission.assert` and `ctx.app.version`.
import { readFileSync } from "node:fs"

const RANGE = ">=2.4.1 <2.5.0"

function inRange(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (match === null) return false
  return Number(match[1]) === 2 && Number(match[2]) === 4 && Number(match[3]) >= 1
}

/** What §6's access table gives a method at one level, with the method's own effect last. */
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

/** The example's manifest, from the package it sits in. */
function manifestOf(name) {
  return JSON.parse(readFileSync(new URL(`../${name}/package.json`, import.meta.url), "utf8")).capabilities
}

/** The plugin definition an example's `index.js` exports. */
export function defineExamplePlugin(name) {
  const manifest = manifestOf(name)
  const plugin = manifest.plugin.name
  return {
    id: plugin,
    setup(context) {
      if (!inRange(context.app.version) && context.options?.allowUntestedHost !== true) {
        throw new Error(`HOST_UNTESTED: ${plugin} supports ${RANGE}, and OpenCode ${context.app.version} is outside it. Next step: install OpenCode 2.4.1, or set allowUntestedHost.`)
      }
      const methods = Object.entries(manifest.methods).filter(([method]) => !method.startsWith("mcp:"))

      context.tool.transform((tool) => {
        tool.namespace({ name: plugin, description: manifest.plugin.summary })
        for (const [method, item] of methods) {
          tool.add({
            id: `${plugin}_${method}`,
            namespace: plugin,
            permission: `${plugin}.${method}`,
            description: `The ${plugin} plugin's ${method} method.`,
            ...(item.pinned === true ? { codemode: { pinned: true } } : { codemode: true }),
            execute: async () => ({ output: `the ${plugin} example's ${method}` }),
          })
        }
      })

      const definitions = Object.fromEntries(
        methods.map(([method]) => [
          method,
          { input: { type: "object", additionalProperties: true }, output: { type: "object", additionalProperties: true } },
        ]),
      )
      context.rpc.register(
        { id: plugin, methods: definitions, events: { changed: { schema: { type: "object" } } } },
        Object.fromEntries(
          methods.map(([method, item]) => [
            method,
            async (input) => {
              if (item.class !== "read") {
                await context.permission.assert({ sessionID: input.sessionID ?? "ses_conformance", action: `${plugin}.${method}`, resources: ["*"] })
              }
              return { method, ok: true }
            },
          ]),
        ),
      )

      context.agent.transform((agents) => {
        for (const agent of agents.list()) {
          agents.update(agent.id, (info) => {
            info.permissions.push({ action: `${plugin}.*`, resource: "*", effect: "allow" })
            for (const [method, item] of methods) {
              const effect = accessEffect(context.options?.access ?? "all", item)
              if (effect !== "allow") info.permissions.push({ action: `${plugin}.${method}`, resource: "*", effect })
            }
          })
        }
      })
    },
  }
}
