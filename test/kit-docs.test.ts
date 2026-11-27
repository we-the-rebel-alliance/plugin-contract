import assert from "node:assert/strict"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, test } from "node:test"
import { applySection, docsFindings, generatedMarkers, missingDocFiles } from "../src/kit/docs.ts"
import { DOC_FILES, renderGeneratedDocs } from "../src/internal/conformance/docs.ts"
import type { Manifest } from "../src/manifest.ts"
import { fullPlugin, manifest } from "./support/plugin.ts"

describe("the generated doc sections", () => {
  test("a block is replaced between its generated markers, not around them", () => {
    const { start, end } = generatedMarkers("capabilities")
    const text = `before\n${start}\nold\n${end}\nafter\n`
    const applied = applySection(text, "capabilities", "new")
    assert.equal(applied.missing, undefined)
    assert.equal(applied.text, `before\n${start}\nnew\n${end}\nafter\n`)
    assert.equal(applySection("no markers", "capabilities", "new").missing, "start")
    assert.equal(applySection(`${start}\nold`, "capabilities", "new").missing, "end")
  })

  test("the file set is the five conformance doc files, and a missing one is a finding", () => {
    const plugin = fullPlugin()
    try {
      assert.deepEqual(missingDocFiles(plugin.dir), [])
      rmSync(join(plugin.dir, "docs", "accounts.md"))
      assert.deepEqual(missingDocFiles(plugin.dir).map((finding) => [finding.id, finding.path]), [["DOCS.missing-file", "docs/accounts.md"]])
    } finally {
      plugin.cleanup()
    }
  })

  test("docs and conformance agree: the same renderer makes a current plugin current, and drift is T0", () => {
    const plugin = fullPlugin()
    try {
      assert.deepEqual(docsFindings(plugin.dir, manifest()), [])
      const readme = join(plugin.dir, "README.md")
      const text = readFileSync(readme, "utf8")
      writeFileSync(readme, text.replace(/<!-- generated:capabilities -->\n[\s\S]*?\n<!-- \/generated:capabilities -->/, "<!-- generated:capabilities -->\nstale\n<!-- /generated:capabilities -->"))
      const findings = docsFindings(plugin.dir, manifest())
      assert.ok(findings.some((finding) => finding.id === "T0.docs-capabilities" && finding.path === "README.md"))
    } finally {
      plugin.cleanup()
    }
  })

  test("the errors table lists the contract's codes, then the plugin's own", () => {
    const plain = renderGeneratedDocs(manifest()).errors
    assert.ok(plain.includes("`UNAVAILABLE`"))
    assert.ok(!plain.includes("SKILLS_INVALID"))
    const own = renderGeneratedDocs({ ...manifest(), errors: { SKILLS_INVALID: { surface: "status", meaning: "a bundled skill is missing | broken" } } }).errors
    const rows = own.split("\n")
    assert.ok(rows.indexOf("| `SKILLS_INVALID` | a bundled skill is missing \\| broken, shown in status |") > rows.findIndex((row) => row.startsWith("| `UNAVAILABLE`")))
  })

  test("a README without the plugin's code in its errors block is T0 drift", () => {
    const plugin = fullPlugin()
    try {
      const declared = { ...manifest(), errors: { SKILLS_INVALID: { surface: "status", meaning: "a bundled skill is missing" } } } as Manifest
      const findings = docsFindings(plugin.dir, declared)
      assert.ok(findings.some((finding) => finding.id === "T0.docs-errors" && finding.path === "README.md"))
    } finally {
      plugin.cleanup()
    }
  })

  test("every conformance doc file is in the kit's set", () => {
    assert.deepEqual(
      DOC_FILES.map((doc) => doc.file),
      ["README.md", "docs/capabilities.md", "docs/configuration.md", "docs/accounts.md", "docs/automations.md"],
    )
  })
})
