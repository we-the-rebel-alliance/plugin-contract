/**
 * `plugin-kit docs`: the generated doc sections, written from the conformance module's renderer.
 *
 * The sections are conformance's (`capabilities`, `errors`, `configuration`, `accounts`, `automations`); the kit owns
 * only where they go and the `<!-- generated:<section> -->` block that holds them. `docs` writes them, and `check` uses
 * the same renderer through `runConformance`, so the two cannot disagree.
 */
import { join } from "node:path"
import { renderGeneratedDocs } from "../conformance.ts"
import { DOC_FILES, docsFindings as conformanceDocsFindings, type DocsSection } from "../internal/conformance/docs.ts"
import type { Manifest } from "../manifest.ts"
import { readText, writeTextIfChanged } from "./files.ts"
import { readPlugin } from "./plugin.ts"
import { print, printFinding } from "./output.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"

/** The block that holds one generated section. */
export const generatedMarkers = (section: string): { readonly start: string; readonly end: string } => ({
  start: `<!-- generated:${section} -->`,
  end: `<!-- /generated:${section} -->`,
})

/** Whether a section belongs to a manifest: an absent accounts block or events source generates nothing. */
export function applies(manifest: Manifest, section: DocsSection): boolean {
  if (section === "accounts") return manifest.accounts !== undefined
  if (section === "automations") return manifest.sources.some((source) => source.kind === "events")
  return true
}

/** Replace one generated block, or report the marker that is missing. */
export function applySection(text: string, section: string, body: string): { readonly text: string; readonly missing: "start" | "end" | undefined } {
  const { start, end } = generatedMarkers(section)
  const startAt = text.indexOf(start)
  if (startAt === -1) return { text, missing: "start" }
  const endAt = text.indexOf(end, startAt + start.length)
  if (endAt === -1) return { text, missing: "end" }
  return { text: `${text.slice(0, startAt + start.length)}\n${body.trim()}\n${text.slice(endAt)}`, missing: undefined }
}

/** The five files the standard requires; a missing one is a kit-only finding because #59's T0 reads only files that exist. */
export function missingDocFiles(dir: string): Finding[] {
  return DOC_FILES.filter((doc) => readText(join(dir, doc.file)) === undefined).map((doc) => ({
    id: "DOCS.missing-file",
    level: "error",
    path: doc.file,
    message: `${doc.file} is missing, so its generated sections cannot be checked`,
    fix: `create ${doc.file} with the generated blocks docs/kit.md lists`,
  }))
}

/** The kit-only file-set check plus conformance's drift check, for `docs --check`. */
export function docsFindings(dir: string, manifest: Manifest): Finding[] {
  return sortFindings([...missingDocFiles(dir), ...conformanceDocsFindings(dir, manifest)])
}

/** The files to write and the findings that stop a write. */
function rendered(dir: string, manifest: Manifest): { readonly files: Map<string, string>; readonly findings: Finding[] } {
  const sections = renderGeneratedDocs(manifest)
  const files = new Map<string, string>()
  const findings: Finding[] = []
  for (const doc of DOC_FILES) {
    const text = readText(join(dir, doc.file))
    if (text === undefined) {
      findings.push({ id: "DOCS.missing-file", level: "error", path: doc.file, message: `${doc.file} is missing, so its generated sections cannot be written`, fix: `create ${doc.file} with the generated blocks docs/kit.md lists` })
      continue
    }
    let next = text
    for (const section of doc.sections) {
      if (!applies(manifest, section)) continue
      const applied = applySection(next, section, sections[section])
      if (applied.missing !== undefined) {
        const { start, end } = generatedMarkers(section)
        findings.push({
          id: "DOCS.missing-marker",
          level: "error",
          path: doc.file,
          message: `${doc.file} has no "${start}" … "${end}" pair, so the ${section} section cannot be written`,
          fix: `add the pair to ${doc.file}, then run plugin-kit docs`,
        })
        continue
      }
      next = applied.text
    }
    files.set(doc.file, next)
  }
  return { files, findings }
}

/** `plugin-kit docs`: write every generated section, or with `check`, report drift only. */
export async function runDocs(context: CommandContext, options: { readonly check: boolean }): Promise<number> {
  const plugin = readPlugin(context.dir)
  if (plugin.manifest === undefined) {
    const findings = [{ id: "DOCS.manifest", level: "error", message: "the capabilities manifest does not validate, so no generated section can be checked", fix: "fix capabilities in package.json; docs/contract.md §4 is the shape" }] satisfies Finding[]
    print(context, findings, "docs: not current")
    return 1
  }
  if (options.check) {
    const findings = docsFindings(context.dir, plugin.manifest)
    print(context, findings, findings.length === 0 ? "docs: current" : "docs: not current")
    return hasError(findings) ? 1 : 0
  }
  const result = rendered(context.dir, plugin.manifest)
  const changed: string[] = []
  if (!hasError(result.findings)) {
    for (const [file, text] of result.files) if (writeTextIfChanged(join(context.dir, file), text)) changed.push(file)
  }
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ command: "docs", ok: !hasError(result.findings), changed, findings: result.findings }, null, 2)}\n`)
  } else {
    for (const finding of sortFindings(result.findings)) printFinding(context, finding)
    context.io.stdout(result.findings.length === 0 ? `docs: ${changed.length === 0 ? "up to date" : `${changed.length} file${changed.length === 1 ? "" : "s"} updated`} (${DOC_FILES.length} files)\n` : `docs: ${result.findings.length} problem${result.findings.length === 1 ? "" : "s"}\n`)
  }
  return hasError(result.findings) ? 1 : 0
}
