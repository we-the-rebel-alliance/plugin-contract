/**
 * `plugin-kit docs`: the manifest-driven sections of a plugin's documentation.
 *
 * Every generated section sits between two markers:
 *
 *   <!-- kit:start:capabilities.methods -->
 *   …generated…
 *   <!-- kit:end:capabilities.methods -->
 *
 * `plugin-kit docs` replaces what is between a pair; `plugin-kit check` reads the same pairs and reports a section that
 * differs, or a marker that is not there. Hand-written text outside the markers is never touched.
 */
import { join } from "node:path"
import type { Manifest, MethodClass, SourceItem } from "../manifest.ts"
import { cadence, code, list, schemaProperties, table } from "./format.ts"
import { readText, writeTextIfChanged } from "./files.ts"
import { errorsTable } from "./errors.ts"
import { readPlugin } from "./plugin.ts"
import type { CommandContext, Finding } from "./types.ts"
import { hasError, sortFindings } from "./types.ts"
import { print, printFinding } from "./output.ts"

/** The marker pair one section lives between. */
export const markers = (section: string): { readonly start: string; readonly end: string } => ({
  start: `<!-- kit:start:${section} -->`,
  end: `<!-- kit:end:${section} -->`,
})

/** One generated section: the file it belongs in, its name, and its body. */
export interface GeneratedSection {
  readonly file: string
  readonly section: string
  readonly body: string
}

/** The files the standard requires the kit to keep current (plugin standard §6). */
export const DOC_FILES: readonly string[] = ["README.md", "docs/capabilities.md", "docs/accounts.md", "docs/configuration.md", "docs/automations.md"]

/** The headings AGENTS.md must carry (plugin standard §11). */
export const AGENTS_HEADINGS: readonly string[] = ["## What this plugin is", "## Names", "## Commands", "## Layout", "## Rules", "## Adding a capability", "## Docs", "## Forbidden"]

const WRITE_CLASSES: readonly MethodClass[] = ["write", "send", "share", "delete", "export", "admin"]

/** The methods table: every callable, its class, its account need and how it is reached. */
export function methodsSection(manifest: Manifest): string {
  const rows = Object.entries(manifest.methods)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, method]) => [
      code(name),
      method.class,
      method.accounts ?? "none",
      list(method.operations),
      method.plans === true ? "yes" : "—",
      method.commits === undefined ? "—" : code(method.commits),
      method.pinned === true ? "yes" : "—",
    ])
  return table(["Method", "Class", "Accounts", "Operations", "Plans", "Commits", "Pinned"], rows)
}

/** The sources table: what an app may bind to, and what each read controls. */
export function sourcesSection(manifest: Manifest): string {
  if (manifest.sources.length === 0) return "This plugin declares no sources."
  const rows = [...manifest.sources]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((source) => {
      const what = source.kind === "events" ? source.reads : source.output
      return [
        code(source.id),
        source.kind,
        `${source.kind === "events" ? "reads" : "output"}: ${code(what)}`,
        code(source.method),
        source.service === undefined ? "—" : `${code(source.service.id)} (${source.service.label})`,
        list(source.signals),
        cadence(source.cadence?.suggestMinutes ?? source.cadence?.providerMinMinutes),
        costOf(source),
        list(source.scope?.keys),
        list(source.details?.map((detail) => detail.id)),
      ]
    })
  return table(["Source", "Kind", "Reads or output", "Method", "Service", "Signals", "Cadence", "Cost", "Scope keys", "Details"], rows)
}

/** What one read costs, as the sources table shows it. */
function costOf(source: SourceItem): string {
  if (source.cost.class === "free") return "free"
  const units = source.cost.units ?? []
  if (units.length === 0) return source.cost.class
  return `${source.cost.class} (${units.map((unit) => `${unit.per} $${unit.usd}`).join(", ")})`
}

/** The actions table: what a person may do, and the methods that plan and commit it. */
export function actionsSection(manifest: Manifest): string {
  if (manifest.actions.length === 0) return "This plugin declares no actions."
  const rows = [...manifest.actions]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((action) => [code(action.id), action.effect, code(action.preview), code(action.commit)])
  return table(["Action", "Effect", "Preview", "Commit"], rows)
}

/** The bus events the plugin declares (contract §10). */
export function eventsSection(manifest: Manifest): string {
  const meanings: Readonly<Record<string, string>> = {
    changed: "A source the plugin reads changed; an app re-reads through its grant.",
    status: "The plugin's state changed, such as sign-in or access.",
    account: "An account signed in, signed out, or needs sign-in.",
  }
  const names = ["changed", "status", "account"].filter((name) => (manifest.events as Record<string, unknown>)[name] !== undefined)
  if (names.length === 0) return "This plugin emits no bus events."
  return table(
    ["Event", "When"],
    names.map((name) => [code(`rpc.${manifest.plugin.name}.${name}`), meanings[name] ?? "Declared by the manifest."]),
  )
}

/** The profile fields every alias is checked against, from the options schema. */
export function profileSection(manifest: Manifest): string {
  if (manifest.accounts === undefined) return "This plugin signs in to no provider."
  const options = manifest.options as Record<string, unknown>
  const properties = typeof options["properties"] === "object" && options["properties"] !== null ? (options["properties"] as Record<string, unknown>) : {}
  const accounts = properties["accounts"]
  const profile = typeof accounts === "object" && accounts !== null ? (accounts as Record<string, unknown>)["additionalProperties"] : undefined
  const fields = schemaProperties(profile)
  if (fields.length === 0) return `Accounts are \`${manifest.accounts.via}\`; the profile is a free-form object, and the options schema names no field.`
  return table(
    ["Field", "Type", "Required", "Default", "Description"],
    fields.map((field) => [code(field.name), field.type, field.required ? "yes" : "no", field.default, field.description]),
  )
}

/** The options table: every setting, its type, its default and what it does (plugin standard §5). */
export function optionsSection(manifest: Manifest): string {
  const fields = schemaProperties(manifest.options)
  if (fields.length === 0) return "The options schema names no setting."
  return table(
    ["Option", "Type", "Required", "Default", "Description"],
    fields.map((field) => [code(field.name), field.type, field.required ? "yes" : "no", field.default, field.description]),
  )
}

/** One automation recipe per events source: read with a cursor in state, and write the next cursor back. */
export function automationsSection(manifest: Manifest): string {
  const sources = manifest.sources.filter((source): source is Extract<SourceItem, { kind: "events" }> => source.kind === "events")
  if (sources.length === 0) return "This plugin reads no events feed, so it has no timer recipe."
  return sources
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((source) => {
      const every = source.cadence?.suggestMinutes ?? source.cadence?.providerMinMinutes ?? 5
      const floor = source.cadence?.providerMinMinutes
      const input = source.input === undefined ? "{}" : JSON.stringify(source.input, null, 2)
      return [
        `### ${code(source.id)}`,
        "",
        `Suggested cadence: **${cadence(every)}**${floor === undefined ? "" : `; the provider allows one read every ${cadence(floor)}`}.`,
        "",
        "```js",
        `const input = ${input}`,
        `const page = await tools.${manifest.plugin.name}.${source.method}({ ...input, cursor: state?.cursor })`,
        "return { state: { cursor: page.cursor } }",
        "```",
        "",
        `Signals: ${list(source.signals)}.`,
      ].join("\n")
    })
    .join("\n\n")
}

/** Every generated section, in file and section order. */
export function generatedSections(manifest: Manifest): GeneratedSection[] {
  return [
    { file: "README.md", section: "readme.capabilities", body: methodsSection(manifest) },
    { file: "README.md", section: "readme.errors", body: errorsTable() },
    { file: "docs/capabilities.md", section: "capabilities.methods", body: methodsSection(manifest) },
    { file: "docs/capabilities.md", section: "capabilities.sources", body: sourcesSection(manifest) },
    { file: "docs/capabilities.md", section: "capabilities.actions", body: actionsSection(manifest) },
    { file: "docs/capabilities.md", section: "capabilities.events", body: eventsSection(manifest) },
    { file: "docs/accounts.md", section: "accounts.profile", body: profileSection(manifest) },
    { file: "docs/configuration.md", section: "configuration.options", body: optionsSection(manifest) },
    { file: "docs/automations.md", section: "automations.events", body: automationsSection(manifest) },
  ]
}

/** The write classes a SUPPORTED.md row names, for a manifest's methods. */
export function writeClasses(manifest: Manifest): MethodClass[] {
  const found = new Set<MethodClass>()
  for (const method of Object.values(manifest.methods)) if (WRITE_CLASSES.includes(method.class)) found.add(method.class)
  return WRITE_CLASSES.filter((name) => found.has(name))
}

/** Replace one section's body, or report the marker that is missing. */
export function applySection(text: string, section: string, body: string): { readonly text: string; readonly missing: "start" | "end" | undefined } {
  const { start, end } = markers(section)
  const startAt = text.indexOf(start)
  if (startAt === -1) return { text, missing: "start" }
  const endAt = text.indexOf(end, startAt + start.length)
  if (endAt === -1) return { text, missing: "end" }
  const inner = `\n${body.trim() === "" ? "" : `${body.trim()}\n`}`
  return { text: `${text.slice(0, startAt + start.length)}${inner}${text.slice(endAt)}`, missing: undefined }
}

/** What `docs --check` reports: missing files, missing markers, stale sections and missing AGENTS.md headings. */
export function docsFindings(dir: string, manifest: Manifest | undefined): Finding[] {
  const findings: Finding[] = []
  if (manifest === undefined) {
    return [{ id: "DOCS.manifest", level: "error", message: "the capabilities manifest does not validate, so no generated section can be checked", fix: "fix capabilities in package.json; docs/contract.md §4 is the shape" }]
  }
  const sections = generatedSections(manifest)
  const byFile = new Map<string, GeneratedSection[]>()
  for (const section of sections) byFile.set(section.file, [...(byFile.get(section.file) ?? []), section])
  for (const [file, own] of byFile) {
    const text = readText(join(dir, file))
    if (text === undefined) {
      findings.push({ id: "DOCS.missing-file", level: "error", path: file, message: `${file} is missing, so its generated sections cannot be checked`, fix: `create ${file} with the section markers docs/kit.md lists` })
      continue
    }
    for (const section of own) {
      const { start, end } = markers(section.section)
      if (!text.includes(start) || !text.includes(end)) {
        findings.push({
          id: "DOCS.missing-marker",
          level: "error",
          path: file,
          message: `${file} has no "${start}" … "${end}" pair, so the ${section.section} section cannot be generated`,
          fix: `add the pair to ${file}, then run plugin-kit docs`,
        })
        continue
      }
      if (applySection(text, section.section, section.body).text !== text) {
        findings.push({ id: "DOCS.stale", level: "error", path: file, message: `the ${section.section} section in ${file} differs from the manifest`, fix: "run plugin-kit docs and commit the result" })
      }
    }
  }
  const agents = readText(join(dir, "AGENTS.md"))
  if (agents === undefined) findings.push({ id: "DOCS.missing-file", level: "error", path: "AGENTS.md", message: "AGENTS.md is missing", fix: "start from plugin-contract's AGENTS.template.md" })
  else {
    for (const heading of AGENTS_HEADINGS) {
      if (!new RegExp(`^${escapeRegex(heading)}\\s*$`, "m").test(agents)) {
        findings.push({ id: "DOCS.agents-section", level: "error", path: "AGENTS.md", message: `AGENTS.md has no "${heading}" section`, fix: "add the section from plugin-contract's AGENTS.template.md" })
      }
    }
  }
  return sortFindings(findings)
}

const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/** `plugin-kit docs`: rewrite every generated section, or with `check`, report drift only. */
export async function runDocs(context: CommandContext, options: { readonly check: boolean }): Promise<number> {
  const plugin = readPlugin(context.dir)
  if (options.check || plugin.manifest === undefined) {
    const findings = docsFindings(context.dir, plugin.manifest)
    print(context, findings, findings.length === 0 ? "docs: current" : "docs: not current")
    return hasError(findings) ? 1 : 0
  }
  const sections = generatedSections(plugin.manifest)
  const files = new Map<string, string>()
  const findings: Finding[] = []
  for (const file of DOC_FILES) {
    const text = readText(join(context.dir, file))
    if (text === undefined) {
      findings.push({ id: "DOCS.missing-file", level: "error", path: file, message: `${file} is missing, so its generated sections cannot be written`, fix: `create ${file} with the section markers docs/kit.md lists` })
      continue
    }
    files.set(file, text)
  }
  for (const section of sections) {
    const current = files.get(section.file)
    if (current === undefined) continue
    const applied = applySection(current, section.section, section.body)
    if (applied.missing !== undefined) {
      const { start, end } = markers(section.section)
      findings.push({
        id: "DOCS.missing-marker",
        level: "error",
        path: section.file,
        message: `${section.file} has no "${start}" … "${end}" pair, so the ${section.section} section cannot be written`,
        fix: `add the pair to ${section.file}`,
      })
      continue
    }
    files.set(section.file, applied.text)
  }
  const changed: string[] = []
  if (!hasError(findings)) {
    for (const [file, text] of files) if (writeTextIfChanged(join(context.dir, file), text)) changed.push(file)
  }
  if (context.json) {
    context.io.stdout(`${JSON.stringify({ command: "docs", ok: !hasError(findings), changed, findings }, null, 2)}\n`)
  } else {
    for (const finding of sortFindings(findings)) printFinding(context, finding)
    context.io.stdout(findings.length === 0 ? `docs: ${changed.length === 0 ? "up to date" : `${changed.length} file${changed.length === 1 ? "" : "s"} updated`} (${sections.length} sections)\n` : `docs: ${findings.length} problem${findings.length === 1 ? "" : "s"}\n`)
  }
  return hasError(findings) ? 1 : 0
}
