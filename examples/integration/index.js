// The Harbour example's server entry: one `register` call wires its methods through the contract's doors, and the
// accounts module registers one integration per alias. No example writes door code by hand.
import { readFileSync } from "node:fs"
import { registerAccounts } from "../../dist/accounts.js"
import { register } from "../../dist/register.js"
import { createHandlers } from "./handlers.js"
import { createHarbourProvider } from "./provider.js"

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

    const provider = createHarbourProvider()
    const state = { hostVersion: context.app.version, accountProblems: [], access: undefined, agents: undefined }
    const handlers = createHandlers({ provider, manifest, options: context.options ?? {}, version: pkg.version, state })

    const accounts = await registerAccounts(context, {
      manifest,
      options: context.options ?? {},
      auth: (account, integrationID) => [
        {
          integrationID,
          method: { type: "key", label: `Harbour API key for ${account.alias}` },
        },
      ],
    })
    state.accountProblems = [...accounts.problems]

    const registration = await register(context, manifest, handlers)
    state.access = registration.access
    state.agents = async () => (await context.agent.list()).data
    return () => registration.dispose()
  },
}
