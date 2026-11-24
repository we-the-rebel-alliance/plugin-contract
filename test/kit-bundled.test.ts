import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { bundledFindings, KIT_BUNDLE_MARKER, runtimeFileList } from "../src/kit/bundled.ts"
import { fullPlugin } from "./support/plugin.ts"

const write = (path: string, text: string): void => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

describe("KIT_BUNDLED", () => {
  test("a runtime bundle that imports the kit fails", () => {
    const plugin = fullPlugin()
    try {
      mkdirSync(join(plugin.dir, "dist"), { recursive: true })
      write(join(plugin.dir, "dist", "index.js"), 'import { createHost } from "@we-the-rebel-alliance/plugin-contract/kit"\nexport default createHost\n')
      const findings = bundledFindings(plugin.dir)
      assert.deepEqual(findings.map((finding) => [finding.id, finding.path]), [["KIT_BUNDLED", "dist/index.js"]])
      assert.match(findings[0]?.message ?? "", /the kit is a devDependency/)
    } finally {
      plugin.cleanup()
    }
  })

  test("a bundle that inlines the harness marker fails, and a normal bundle does not", () => {
    const plugin = fullPlugin()
    try {
      mkdirSync(join(plugin.dir, "dist"), { recursive: true })
      write(join(plugin.dir, "dist", "chunk.js"), `export const marker = "${KIT_BUNDLE_MARKER}"\n`)
      assert.equal(bundledFindings(plugin.dir)[0]?.id, "KIT_BUNDLED")
      write(join(plugin.dir, "dist", "chunk.js"), "export const marker = 'the plugin'\n")
      assert.deepEqual(bundledFindings(plugin.dir), [])
    } finally {
      plugin.cleanup()
    }
  })

  test("reads the server entry, the package's dist and its conventional entry", () => {
    const plugin = fullPlugin()
    try {
      mkdirSync(join(plugin.dir, "dist"), { recursive: true })
      write(join(plugin.dir, "dist", "index.js"), "export default {}\n")
      write(join(plugin.dir, "index.js"), "export default {}\n")
      assert.deepEqual(runtimeFileList(plugin.dir).sort(), ["dist/index.js", "index.js"])
    } finally {
      plugin.cleanup()
    }
  })

  test("check fails the plugin and names the file", async () => {
    const plugin = fullPlugin()
    try {
      mkdirSync(join(plugin.dir, "dist"), { recursive: true })
      write(join(plugin.dir, "dist", "index.js"), 'import "@we-the-rebel-alliance/plugin-contract/kit"\n')
      const { main } = await import("../src/kit.ts")
      const { fakeConformance } = await import("./support/kit.ts")
      let out = ""
      let err = ""
      const code = await main(["check", "--dir", plugin.dir], {
        stdout: (text) => (out += text),
        stderr: (text) => (err += text),
        conformance: async () => fakeConformance(),
      })
      assert.equal(code, 1)
      assert.match(err, /ERROR KIT_BUNDLED dist\/index\.js/)
      assert.match(err, /devDependency/)
    } finally {
      plugin.cleanup()
    }
  })
})
