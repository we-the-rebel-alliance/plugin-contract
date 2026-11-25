// The Glyph example's server entry: one `register` call wires its methods through the contract's doors and returns the
// bus writer too. No accounts, no sources: this plugin is methods only, and nothing is kept between setup and a call.
import { readFileSync } from "node:fs"
import { assertHost, register } from "../../dist/register.js"
import { createHandlers } from "./handlers.js"

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"))
const manifest = pkg.capabilities

export default {
  id: manifest.plugin.name,
  async setup(context) {
    assertHost(context, manifest)

    const handlers = createHandlers({ manifest, version: pkg.version, hostVersion: context.app.version })
    const registration = await register(context, manifest, handlers)
    return () => registration.dispose()
  },
}
