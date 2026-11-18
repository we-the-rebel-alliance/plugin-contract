import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, describe, test } from "node:test"
import { descriptorHash, readInstalledDescriptor } from "../src/descriptor.ts"
import { listInstalledDeclarations } from "../src/list.ts"

const scratch = mkdtempSync(join(tmpdir(), "list-declarations-"))
after(() => rmSync(scratch, { recursive: true, force: true }))

const source = {
  id: "demo.notes",
  kind: "snapshot",
  tool: "list_notes",
  output: "list",
  permission: { tool: "demo.list_notes", operations: ["notes.list"] },
  cost: { class: "free" },
}

const save = {
  id: "demo.save",
  input: { type: "object", additionalProperties: true },
  output: { type: "object", properties: { saved: { type: "boolean" } }, required: ["saved"] },
  effect: "local",
  preview: "preview_note",
  commit: "save_note",
  permission: { preview: "demo.preview_note", commit: "demo.save_note", operations: ["notes.create"] },
}

/** A package.json on disk. `sources` omitted means the key is absent. */
function writePackage(directory: string, sources: unknown, name = "@example/demo") {
  mkdirSync(directory, { recursive: true })
  const pkg: Record<string, unknown> = { name, version: "1.0.0" }
  if (sources !== undefined) pkg["sources"] = sources
  writeFileSync(join(directory, "package.json"), JSON.stringify(pkg))
}

describe("listInstalledDeclarations", () => {
  test("returns a declared source, and acts once the package declares them", () => {
    const directory = join(scratch, "one")
    writePackage(directory, { contractVersion: 1, items: [source], acts: [save] })
    const listed = listInstalledDeclarations(directory)
    assert.deepEqual(listed.problems, [])
    assert.equal(listed.declarations.length, 1)
    const found = listed.declarations[0]!
    assert.equal(found.package, "@example/demo")
    assert.equal(found.sources.items[0]?.id, "demo.notes")
    assert.equal(found.acts[0]?.id, "demo.save")
    assert.equal(found.acts[0]?.effect, "local")
    assert.match(found.hash, /^sha256:[0-9a-f]{64}$/)
  })

  test("the hash covers acts, so adding one changes it", () => {
    const directory = join(scratch, "hashed")
    const withActs = { contractVersion: 1, items: [source], acts: [save] }
    writePackage(directory, withActs)
    const covered = readInstalledDescriptor(directory)
    assert.ok(covered.ok)
    const bare = { contractVersion: 1, items: [source] }
    assert.notEqual(descriptorHash(withActs), descriptorHash(bare))
    assert.equal(covered.value.hash, descriptorHash(withActs))
  })

  test("a directory of packages reports a missing or invalid descriptor, and reads a scoped package", () => {
    const root = join(scratch, "packages")
    writePackage(join(root, "@example", "demo"), { contractVersion: 1, items: [source] }, "@example/demo")
    writePackage(join(root, "bare"), undefined, "bare")
    mkdirSync(join(root, "not-json"), { recursive: true })
    writeFileSync(join(root, "not-json", "package.json"), "{ not json")
    const listed = listInstalledDeclarations(root)
    assert.equal(listed.declarations.length, 1)
    assert.equal(listed.declarations[0]?.sources.items[0]?.id, "demo.notes")
    assert.deepEqual(listed.declarations[0]?.acts, [])
    const reported = listed.problems.map((problem) => problem.directory).sort()
    assert.deepEqual(reported, [join(root, "bare"), join(root, "not-json")])
    assert.match(listed.problems.find((problem) => problem.directory.endsWith("bare"))!.problems.join("\n"), /declares no sources/)
    assert.match(listed.problems.find((problem) => problem.directory.endsWith("not-json"))!.problems.join("\n"), /not JSON/)
  })

  test("a list of package directories reports each, and does not walk into a package", () => {
    const good = join(scratch, "listed-good")
    const bad = join(scratch, "listed-bad")
    writePackage(good, { contractVersion: 1, items: [source], acts: [save] })
    writePackage(join(good, "node_modules", "other"), { contractVersion: 1, items: [source] }, "other")
    writePackage(bad, undefined, "bad")
    const listed = listInstalledDeclarations([good, bad])
    assert.equal(listed.declarations.length, 1)
    assert.equal(listed.declarations[0]?.directory, good)
    assert.equal(listed.declarations[0]?.acts.length, 1)
    assert.equal(listed.problems.length, 1)
    assert.equal(listed.problems[0]?.directory, bad)
  })

  test("a missing directory is reported, not thrown", () => {
    const listed = listInstalledDeclarations(join(scratch, "missing"))
    assert.deepEqual(listed.declarations, [])
    assert.match(listed.problems[0]?.problems[0] ?? "", /no directory/)
  })
})
