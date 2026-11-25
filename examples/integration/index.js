// The Harbour example's server entry: one `register` call wires its methods through the contract's doors, and the
// accounts module registers one integration per alias. No example writes door code by hand, and nothing is kept
// between `register` and a handler: the status builder takes what setup already knows.
import { readFileSync } from "node:fs"
import { registerAccounts } from "../../dist/accounts.js"
import { assertHost, register } from "../../dist/register.js"
import { createHandlers } from "./handlers.js"
import { createHarbourProvider } from "./provider.js"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
const manifest = pkg.capabilities

export default {
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const options = context.options ?? {}
    const provider = createHarbourProvider()
    const accounts = await registerAccounts(context, {
      manifest,
      options,
      auth: (account, integrationID) => [
        {
          integrationID,
          method: { type: "key", label: `Harbour API key for ${account.alias}` },
        },
      ],
    })
    const handlers = createHandlers({
      provider,
      manifest,
      options,
      version: pkg.version,
      hostVersion: context.app.version,
      accountProblems: [...accounts.problems],
    })

    const registration = await register(context, manifest, handlers)
    return () => registration.dispose()
  },
}
