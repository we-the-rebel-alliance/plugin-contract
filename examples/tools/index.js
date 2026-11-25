// The Glyph example's server entry: one `register` call wires its methods through the contract's doors, and the bus
// writer is attached to the same registration. No accounts, no sources: this plugin is methods only.
import { readFileSync } from "node:fs"
import { createBus } from "../../dist/bus.js"
import { register } from "../../dist/register.js"
import { createHandlers } from "./handlers.js"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
const manifest = pkg.capabilities
const RANGE = manifest.plugin.host.opencode

function inRange(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version))
  if (match === null) return false
  return Number(match[1]) === 2 && Number(match[2]) === 4 && Number(match[3]) >= 1
}

export default {
  id: manifest.plugin.name,
  async setup(context) {
    if (!inRange(context.app.version) && context.options?.allowUntestedHost !== true) {
      throw new Error(
        `HOST_UNTESTED: ${manifest.plugin.name} supports ${RANGE}, and OpenCode ${context.app.version} is outside it. Next step: install OpenCode 2.4.1, or set allowUntestedHost.`,
      )
    }

    const bus = { emit: async () => ({ ok: false, reason: "unavailable" }) }
    const state = { hostVersion: context.app.version, access: undefined, agents: undefined }
    const handlers = createHandlers({ manifest, version: pkg.version, bus, state })

    const registration = await register(context, manifest, handlers)
    const writer = createBus(manifest.plugin.name, registration)
    bus.emit = (event, data) => writer.emit(event, data)
    state.access = registration.access
    state.agents = async () => (await context.agent.list()).data
    return () => registration.dispose()
  },
}
