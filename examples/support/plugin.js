// The example plugins' shared server part: one `Plugin.define({ id, setup })` value built from the example's
// `capabilities` manifest. It writes no provider code: the examples exist so a consumer and the conformance kit can read
// a real installed package, and so T1 can load a real plugin and see its doors, permissions and LD-5 refusal.
//
// Everything here is deliberately small. A real plugin calls `contract.register` and `contract.access`; the examples
// keep a visible server part so a consumer and the kit can read a real installed package, and use the same public host
// API: `ctx.tool.transform`, `ctx.rpc.register`, `ctx.agent.transform`, `ctx.permission.assert` and `ctx.app.version`.
import { readFileSync } from "node:fs"
import { effectFor, withRules } from "../../dist/access.js"

const RANGE = ">=2.4.1 <2.5.0"

function inRange(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (match === null) return false
  return Number(match[1]) === 2 && Number(match[2]) === 4 && Number(match[3]) >= 1
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
            name: method,
            description: `The ${plugin} plugin's ${method} method.`,
            input: { type: "object", additionalProperties: true },
            output: { type: "object", additionalProperties: true },
            options: {
              namespace: plugin,
              permission: `${plugin}.${method}`,
              codemode: item.pinned === true ? { pinned: true } : true,
            },
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
            // Insert after the agent's base allow, as contract.access does, so a later host rule still narrows.
            const additions = [{ action: `${plugin}.*`, resource: "*", effect: "allow" }]
            for (const [method, item] of methods) {
              const effect = effectFor(item, context.options?.access ?? "all")
              if (effect !== "allow") additions.push({ action: `${plugin}.${method}`, resource: "*", effect })
            }
            info.permissions = withRules(info.permissions, additions)
          })
        }
      })
    },
  }
}
