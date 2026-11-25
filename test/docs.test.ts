/**
 * The docs against the code. Every module entry in `package.json` has a page under `docs/`, and that page's
 * `## Exports` table names exactly what the module exports — no name missing, no name that does not exist. The list is
 * read from the module's own export declarations, so a second hand-maintained list cannot drift.
 *
 * The `## Exports` section is a table whose first cell holds the export names, one or more code spans, and nothing
 * else; the second cell says what they are. A call signature belongs in the second cell.
 */
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { describe, test } from "node:test"
import { fileURLToPath } from "node:url"
import * as ts from "typescript"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

/** Every name a TypeScript entry exports, following `export *` through the package's own files. */
function exportsOf(file: string, seen = new Set<string>(), names = new Set<string>()): Set<string> {
  const absolute = join(root, file)
  if (seen.has(absolute)) return names
  seen.add(absolute)
  const source = ts.createSourceFile(absolute, readFileSync(absolute, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const node of source.statements) {
    if (ts.isExportDeclaration(node)) {
      if (node.exportClause === undefined) {
        if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
          exportsOf(join(dirname(file), node.moduleSpecifier.text), seen, names)
        }
      } else if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) names.add(element.name.text)
      } else if (ts.isNamespaceExport(node.exportClause)) {
        names.add(node.exportClause.name.text)
      }
      continue
    }
    if (ts.isExportAssignment(node)) {
      names.add("default")
      continue
    }
    if (!ts.canHaveModifiers(node)) continue
    const modifiers = ts.getModifiers(node) ?? []
    if (!modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      names.add("default")
      continue
    }
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) &&
      node.name !== undefined
    ) {
      names.add(node.name.text)
    }
  }
  return names
}

/** The lines of a `## Exports` section, or undefined when the page has none. */
function exportsSection(text: string): string[] | undefined {
  const lines = text.split("\n")
  const start = lines.findIndex((line) => line.trim() === "## Exports")
  if (start === -1) return undefined
  const end = lines.findIndex((line, index) => index > start && /^##\s/.test(line))
  return lines.slice(start + 1, end === -1 ? lines.length : end)
}

/** The names a page's `## Exports` table lists, in order and with repeats kept so a repeat can be reported. */
function listedExports(text: string, page: string): string[] {
  const lines = exportsSection(text)
  if (lines === undefined) throw new Error(`${page}: no "## Exports" section`)
  const names: string[] = []
  for (const line of lines) {
    if (!line.trimStart().startsWith("|")) continue
    const first = line.split("|")[1] ?? ""
    if (/^\s*:?-{3,}/.test(first)) continue
    if (/^\s*Exports?\s*$/.test(first)) continue
    const spans = [...first.matchAll(/`([^`]+)`/g)].map((match) => match[1]!)
    if (spans.length === 0) throw new Error(`${page}: an Exports row names no export: ${line}`)
    for (const name of spans) {
      if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
        throw new Error(`${page}: "${name}" is not a plain export name; put a call signature in the second cell`)
      }
      names.push(name)
    }
  }
  if (names.length === 0) throw new Error(`${page}: the Exports section has no table rows`)
  return names
}

/** Every difference between a module's exports and its page, both directions, or an empty list. */
function exportProblems(module: string, exported: Set<string>, listed: readonly string[]): string[] {
  const problems: string[] = []
  const counts = new Map<string, number>()
  for (const name of listed) counts.set(name, (counts.get(name) ?? 0) + 1)
  for (const [name, count] of counts) {
    if (count > 1) problems.push(`${module}: "${name}" is listed ${count} times`)
    if (!exported.has(name)) problems.push(`${module}: docs/${module}.md lists "${name}", which the module does not export`)
  }
  for (const name of exported) if (!counts.has(name)) problems.push(`${module}: docs/${module}.md does not list the export "${name}"`)
  return problems
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { exports: Record<string, unknown> }
/** The page and the source file for one export entry; the root `"."` is the package's own guide. */
const moduleOf = (entry: string): { readonly page: string; readonly source: string } =>
  entry === "."
    ? { page: "plugin-contract", source: join("src", "index.ts") }
    : { page: entry.slice(2), source: join("src", `${entry.slice(2)}.ts`) }
const modules = Object.keys(pkg.exports)
  .filter((entry) => entry === "." || (entry.startsWith("./") && entry !== "./package.json"))
  .map(moduleOf)
  .sort((a, b) => a.page.localeCompare(b.page))
const pages = readdirSync(join(root, "docs"))
  .filter((entry) => entry.endsWith(".md"))
  .map((entry) => entry.slice(0, -3))
  .sort()

/** Pages that are not a module's page: the contract, the standard, the decisions, and the two guides. */
const rootPages = ["consumers", "contract", "decisions", "index", "plugin-standard"]

describe("the documentation", () => {
  test("every module has a page whose Exports table is exactly the module's exports", () => {
    assert.ok(modules.length >= 18, `the package exports ${modules.length} modules`)
    for (const { page, source } of modules) {
      const exported = exportsOf(source)
      const text = readFileSync(join(root, "docs", `${page}.md`), "utf8")
      assert.deepEqual(exportProblems(page, exported, listedExports(text, `${page}.md`)), [])
    }
  })

  test("every page is a module page or one of the root pages", () => {
    const known = new Set([...modules.map((module) => module.page), ...rootPages])
    assert.deepEqual(
      pages.filter((page) => !known.has(page)),
      [],
    )
  })

  test("docs/index.md links every page", () => {
    const index = readFileSync(join(root, "docs", "index.md"), "utf8")
    for (const page of pages) {
      if (page === "index") continue
      assert.match(index, new RegExp(`\\]\\(${page}\\.md\\)`), `docs/index.md does not link ${page}.md`)
    }
  })

  test("README.md links every module's page", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8")
    for (const { page } of modules) {
      assert.match(readme, new RegExp(`\\]\\(docs/${page}\\.md\\)`), `README.md does not link docs/${page}.md`)
    }
  })

  test("the check fails when a listed name is missing or does not exist", () => {
    const text = readFileSync(join(root, "docs", "read.md"), "utf8")
    const exported = exportsOf(join("src", "read.ts"))
    const listed = listedExports(text, "read.md")
    assert.deepEqual(exportProblems("read", exported, listed), [])
    const missing = listed.slice(1)
    assert.match(exportProblems("read", exported, missing).join("\n"), /does not list the export/)
    assert.match(exportProblems("read", exported, [...listed, "notAnExport"]).join("\n"), /which the module does not export/)
    assert.match(exportProblems("read", exported, [...listed, listed[0]!]).join("\n"), /is listed 2 times/)
  })
})
