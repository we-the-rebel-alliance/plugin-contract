/**
 * The generated doc sections, and the freshness check (standard §6; contract §16).
 *
 * A plugin's docs carry the manifest's own facts between markers, so a person reads the same declaration the kit
 * checks:
 *
 *   <!-- generated:capabilities -->
 *   …the table…
 *   <!-- /generated:capabilities -->
 *
 * `plugin-kit docs` writes them, and T0 fails when one drifts. The sections are `capabilities` (the methods, sources,
 * actions and bus events), `errors` (the contract's codes), `configuration` (the options and their defaults), `accounts`
 * (the mechanism and the profile fields) and `automations` (each events source's method and cadence). A doc file the
 * plugin does not ship is not this check's business: the kit's forbidden and docs checks own the file set.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ERROR_CODES } from "../events.ts"
import type { Manifest, SourceItem } from "../../manifest.ts"
import { error, warning, type Finding } from "./report.ts"

/** A generated section's name. */
export type DocsSection = "capabilities" | "errors" | "configuration" | "accounts" | "automations"

/** The sections a plugin ships, and the files that carry them. */
export const DOC_FILES: readonly { readonly file: string; readonly sections: readonly DocsSection[] }[] = [
  { file: "README.md", sections: ["capabilities", "errors"] },
  { file: "docs/capabilities.md", sections: ["capabilities"] },
  { file: "docs/configuration.md", sections: ["configuration"] },
  { file: "docs/accounts.md", sections: ["accounts"] },
  { file: "docs/automations.md", sections: ["automations"] },
]

/** What each contract code means, for the generated errors table. */
const CODE_MEANING: Readonly<Record<string, string>> = {
  NEEDS_SIGN_IN: "the account is not signed in",
  SCOPE_MISSING: "the call needs a scope the person has not confirmed",
  ACCOUNT_REQUIRED: "the plugin serves several accounts and the call names none",
  ACCOUNT_UNKNOWN: "the call names an alias the plugin does not serve",
  ACCOUNT_MISMATCH: "the item belongs to another account",
  CURSOR_INVALID: "the cursor is malformed, or belongs to another source, account or scope",
  CURSOR_EXPIRED: "the provider no longer keeps the history the cursor names",
  RATE_LIMITED: "the provider asked the plugin to slow down",
  BUDGET_EXCEEDED: "the read would cost more than the person allows",
  SOURCE_DISABLED: "the person turned this source or action off",
  TOO_LARGE: "the answer is larger than the source's maxBytes",
  INPUT_INVALID: "the input does not match the method's schema",
  SOURCE_UNKNOWN: "the plugin declares no such source",
  SCHEMA_VIOLATION: "an answer does not keep the contract's shape",
  PERMISSION_DENIED: "the person's grant does not cover the call",
  PLAN_INVALID: "the plan is missing, or belongs to another method",
  PLAN_USED: "the plan was already used by an earlier commit",
  GRANT_INVALID: "the action grant did not verify, or was already spent",
  HOST_UNTESTED: "OpenCode is outside the plugin's tested range",
  OPTIONS_INVALID: "the plugin's options do not match their schema",
  UNAVAILABLE: "the provider could not be reached",
}

const cell = (value: unknown): string => String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim()
const code = (value: unknown): string => (value === undefined ? "—" : `\`${cell(value)}\``)

/** The comma-separated list of a field, or an em dash. */
function list(values: readonly string[] | undefined): string {
  return values === undefined || values.length === 0 ? "—" : values.map((value) => `\`${cell(value)}\``).join(", ")
}

/** Every generated section, rendered from the manifest. Deterministic: the same manifest gives the same text. */
export function renderGeneratedDocs(manifest: Manifest): Readonly<Record<DocsSection, string>> {
  return {
    capabilities: renderCapabilities(manifest),
    errors: renderErrors(),
    configuration: renderConfiguration(manifest),
    accounts: renderAccounts(manifest),
    automations: renderAutomations(manifest),
  }
}

function renderCapabilities(manifest: Manifest): string {
  const methods: string[] = ["| Method | Class | Accounts | Operations |", "|---|---|---|---|"]
  for (const [method, item] of Object.entries(manifest.methods)) {
    methods.push(`| \`${cell(method)}\` | ${cell(item.class)} | ${item.accounts ?? "none"} | ${list(item.operations)} |`)
  }
  const sources: string[] = ["| Source | Kind | Reads or output | Method | Cost |", "|---|---|---|---|---|"]
  for (const source of manifest.sources) {
    sources.push(`| \`${cell(source.id)}\` | ${source.kind} | \`${cell(source.kind === "events" ? source.reads : source.output)}\` | \`${cell(source.method)}\` | ${source.cost.class} |`)
  }
  const actions: string[] = ["| Action | Effect | Preview | Commit |", "|---|---|---|---|"]
  for (const action of manifest.actions) {
    actions.push(`| \`${cell(action.id)}\` | ${action.effect} | \`${cell(action.preview)}\` | \`${cell(action.commit)}\` |`)
  }
  const events = Object.keys(manifest.events)
  return [
    "### Methods",
    "",
    ...methods,
    "",
    "### Sources",
    "",
    ...sources,
    "",
    "### Actions",
    "",
    actions.length > 2 ? actions.join("\n") : "None.",
    "",
    "### Bus events",
    "",
    events.length === 0 ? "None." : events.map((event) => `\`rpc.${manifest.plugin.name}.${event}\``).join(", "),
  ].join("\n")
}

function renderErrors(): string {
  const rows = ["| Code | Meaning |", "|---|---|"]
  for (const name of ERROR_CODES) rows.push(`| \`${name}\` | ${CODE_MEANING[name] ?? "a failure the contract defines"} |`)
  return rows.join("\n")
}

/** A JSON Schema property's type, as a person reads it. */
function typeOf(schema: Record<string, unknown>): string {
  if (Array.isArray(schema["enum"])) return schema["enum"].map((value) => `\`${cell(value)}\``).join(" \\| ")
  if (Array.isArray(schema["type"])) return schema["type"].map(cell).join(" \\| ")
  if (typeof schema["type"] === "string") return cell(schema["type"])
  if (schema["$ref"] !== undefined) return "profile"
  return "value"
}

function renderConfiguration(manifest: Manifest): string {
  const properties = (manifest.options as Record<string, unknown>)["properties"] as Record<string, Record<string, unknown>> | undefined
  if (properties === undefined) return "The plugin declares no options."
  const rows = ["| Option | Type | Default | Description |", "|---|---|---|---|"]
  for (const [name, schema] of Object.entries(properties)) {
    const described = schema["description"] ?? schema["title"] ?? ""
    rows.push(`| \`${cell(name)}\` | ${typeOf(schema)} | ${schema["default"] === undefined ? "—" : `\`${cell(JSON.stringify(schema["default"]))}\``} | ${cell(described)} |`)
  }
  return rows.join("\n")
}

function renderAccounts(manifest: Manifest): string {
  const info = manifest.accounts
  if (info === undefined) return "The plugin signs in to nothing."
  const options = manifest.options as Record<string, unknown>
  const properties = (options["properties"] ?? {}) as Record<string, Record<string, unknown>>
  const accounts = (properties["accounts"] ?? {}) as Record<string, unknown>
  const profile = (accounts["additionalProperties"] ?? {}) as Record<string, unknown>
  const fields = (profile["properties"] ?? {}) as Record<string, Record<string, unknown>>
  const rows = ["| Field | Type | Required |", "|---|---|---|"]
  const required = Array.isArray(profile["required"]) ? (profile["required"] as string[]) : []
  for (const [field, schema] of Object.entries(fields)) rows.push(`| \`${cell(field)}\` | ${typeOf(schema)} | ${required.includes(field) ? "yes" : "no"} |`)
  return [
    `Accounts are held by the **${info.via}** mechanism: ${info.via === "integration" ? "the plugin holds the credentials" : info.via === "mcp" ? "the vendor's MCP server holds them" : "the machine's own identity"}.`,
    "",
    fields === undefined || Object.keys(fields).length === 0 ? "The profile has no fields." : rows.join("\n"),
  ].join("\n")
}

function renderAutomations(manifest: Manifest): string {
  const events = manifest.sources.filter((source): source is Extract<SourceItem, { kind: "events" }> => source.kind === "events")
  if (events.length === 0) return "The plugin declares no events source."
  const rows = ["| Source | Method | Provider floor | Suggested | Signals |", "|---|---|---|---|---|"]
  for (const source of events) {
    const cadence = source.cadence
    rows.push(
      `| \`${cell(source.id)}\` | \`tools.${manifest.plugin.name}.${cell(source.method)}\` | ${cadence?.providerMinMinutes === undefined ? "—" : `${cadence.providerMinMinutes} min`} | ${cadence?.suggestMinutes === undefined ? "—" : `${cadence.suggestMinutes} min`} | ${list(source.signals)} |`,
    )
  }
  return rows.join("\n")
}

const START = (section: string) => `<!-- generated:${section} -->`
const END = (section: string) => `<!-- /generated:${section} -->`

/** One generated block's body, or the problem with the block. */
function block(text: string, section: string): { readonly body?: string; readonly problem?: string } {
  const start = text.indexOf(START(section))
  const end = text.indexOf(END(section))
  if (start < 0 && end < 0) return { problem: `has no ${START(section)} block` }
  if (start < 0) return { problem: `closes ${section} without opening it` }
  if (end < 0) return { problem: `opens ${section} without closing it` }
  if (end < start) return { problem: `closes ${section} before opening it` }
  return { body: text.slice(start + START(section).length, end) }
}

const normalise = (text: string): string => text.replace(/\r\n/g, "\n").split("\n").map((line) => line.trimEnd()).join("\n").trim()

/** The finding id a section's drift uses. */
const driftId = (section: DocsSection): string => `T0.docs-${section}`

/**
 * Every problem with the generated sections: a missing marker in a file the plugin ships, and a block that is not what
 * the manifest says. A plugin that ships none of the doc files has nothing to check here; the kit's docs check owns the
 * file set.
 */
export function docsFindings(directory: string, manifest: Manifest): Finding[] {
  const findings: Finding[] = []
  const rendered = renderGeneratedDocs(manifest)
  for (const doc of DOC_FILES) {
    const path = join(directory, doc.file)
    let text: string
    try {
      text = readFileSync(path, "utf8")
    } catch {
      continue
    }
    for (const section of doc.sections) {
      if (section === "accounts" && manifest.accounts === undefined) continue
      if (section === "automations" && !manifest.sources.some((source) => source.kind === "events")) continue
      const found = block(text, section)
      if (found.problem !== undefined) {
        findings.push(error(driftId(section), `${doc.file} ${found.problem}, so its ${section} section is not generated from the manifest`, { path: doc.file, fix: `Add ${START(section)} and ${END(section)} around the generated section, then run plugin-kit docs.` }))
        continue
      }
      if (normalise(found.body ?? "") === normalise(rendered[section])) continue
      findings.push(error(driftId(section), `${doc.file}'s ${section} section does not match capabilities: run plugin-kit docs`, { path: doc.file, fix: "Run plugin-kit docs and commit the result." }))
    }
    // A generated block for a section this file does not carry is stale text that nothing refreshes.
    for (const match of text.matchAll(/<!-- generated:([a-z-]+) -->/g)) {
      const section = match[1] ?? ""
      if ((doc.sections as readonly string[]).includes(section)) continue
      findings.push(warning("T0.docs-section", `${doc.file} carries a generated ${section} block, which is not a section this file generates`, { path: doc.file }))
    }
  }
  return findings
}
