// The Trellis example's server entry: one `register` call wires its methods through the contract's doors, and the
// accounts module registers one vendor MCP server per alias. The vendor's MCP tools stay its own: the manifest declares
// them as `mcp:*`, and no example code writes a pass-through tool.
import { readFileSync } from "node:fs"
import { registerAccounts } from "../../dist/accounts.js"
import { assertHost, register } from "../../dist/register.js"
import { createHandlers } from "./handlers.js"
import { createTrellisProvider, mcpServerUrl } from "./provider.js"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
const manifest = pkg.capabilities

export default {
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const options = context.options ?? {}
    const provider = createTrellisProvider()
    const accounts = await registerAccounts(context, {
      manifest,
      options,
      server: (_account, name) => ({ type: "remote", url: mcpServerUrl(name), oauth: {} }),
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
