import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { manifestHash, readInstalledManifest } from "../src/manifest.ts"
import { listInstalledDeclarations } from "../src/list.ts"
import { manifest } from "./support/manifest.ts"

const scratch = mkdtempSync(join(tmpdir(), "list-declarations-"))
after(() => rmSync(scratch, { recursive: true, force: true }))

/** A package.json on disk. `capabilities` omitted means the key is absent. */
function writePackage(directory: string, capabilities: unknown, name = "@example/demo") {
  mkdirSync(directory, { recursive: true })
  const pkg: Record<string, unknown> = { name, version: "1.0.0" }
  if (capabilities !== undefined) pkg["capabilities"] = capabilities
  writeFileSync(join(directory, "package.json"), JSON.stringify(pkg))
}

describe("listInstalledDeclarations", () => {
  test("returns a declared source and actions", () => {
    const directory = join(scratch, "one")
    writePackage(directory, manifest())
    const listed = listInstalledDeclarations(directory)
    assert.deepEqual(listed.problems, [])
    assert.equal(listed.declarations.length, 1)
    const found = listed.declarations[0]!
    assert.equal(found.package, "@example/demo")
    assert.equal(found.manifest.sources[0]?.id, "demo.messages")
    assert.equal(found.manifest.actions[0]?.id, "demo.messages.send")
    assert.equal(found.manifest.actions[0]?.effect, "notify")
    assert.match(found.hash, /^sha256:[0-9a-f]{64}$/)
  })

  test("the hash covers actions and sources, so changing either changes it", () => {
    const directory = join(scratch, "hashed")
    const value = manifest()
    writePackage(directory, value)
    const covered = readInstalledManifest(directory)
    assert.ok(covered.ok)
    if (!covered.ok) return
    assert.equal(covered.value.hash, manifestHash(value))
    const withoutAction = manifest((m) => (m.actions = []))
    assert.notEqual(manifestHash(value), manifestHash(withoutAction))
    assert.notEqual(manifestHash(value), manifestHash(manifest((m) => (m.sources[0].maxBytes = 1024))))
  })

  test("a directory of packages reports a missing or invalid manifest, and reads a scoped package", () => {
    const root = join(scratch, "packages")
    writePackage(join(root, "@example", "demo"), manifest(), "@example/demo")
    writePackage(join(root, "bare"), undefined, "bare")
    mkdirSync(join(root, "not-json"), { recursive: true })
    writeFileSync(join(root, "not-json", "package.json"), "{ not json")
    const listed = listInstalledDeclarations(root)
    assert.equal(listed.declarations.length, 1)
    assert.equal(listed.declarations[0]?.manifest.sources[0]?.id, "demo.messages")
    assert.deepEqual(listed.declarations[0]?.manifest.actions.length, 1)
    const reported = listed.problems.map((problem) => problem.directory).sort()
    assert.deepEqual(reported, [join(root, "bare"), join(root, "not-json")])
    assert.match(listed.problems.find((problem) => problem.directory.endsWith("bare"))!.problems.join("\n"), /declares no manifest/)
    assert.match(listed.problems.find((problem) => problem.directory.endsWith("not-json"))!.problems.join("\n"), /not JSON/)
  })

  test("a list of package directories reports each, and does not walk into a package", () => {
    const good = join(scratch, "listed-good")
    const bad = join(scratch, "listed-bad")
    writePackage(good, manifest())
    writePackage(join(good, "node_modules", "other"), manifest(), "other")
    writePackage(bad, undefined, "bad")
    const listed = listInstalledDeclarations([good, bad])
    assert.equal(listed.declarations.length, 1)
    assert.equal(listed.declarations[0]?.directory, good)
    assert.equal(listed.declarations[0]?.manifest.actions.length, 1)
    assert.equal(listed.problems.length, 1)
    assert.equal(listed.problems[0]?.directory, bad)
  })

  test("a missing directory is reported, not thrown", () => {
    const listed = listInstalledDeclarations(join(scratch, "missing"))
    assert.deepEqual(listed.declarations, [])
    assert.match(listed.problems[0]?.problems[0] ?? "", /no directory/)
  })
})
