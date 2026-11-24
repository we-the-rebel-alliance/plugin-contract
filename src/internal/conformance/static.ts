/**
 * T0, the static gate (standard §0.2, contract §16): no model, no network, no host.
 *
 * - the namespace line (the manifest's `plugin.summary`) is at most 400 characters;
 * - every skill description is at most 300 characters, and a skill's name is in the plugin's namespace;
 * - no text names a tool the plugin does not declare (`tools.<name>.<method>` and `<name>_<method>`);
 * - a pinned method has declared evidence, and none is pinned without it;
 * - the generated doc sections are current (`docs.ts`).
 *
 * Files are read as they sit in an installed package: `skills/**\/SKILL.md`, `AGENTS.md`, `README.md` and
 * `docs/**\/*.md`. A file that does not exist is not a T0 finding: the kit's docs and forbidden checks own the file
 * set, and T0 judges the text that is there.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import type { Manifest } from "../../manifest.ts"
import { docsFindings } from "./docs.ts"
import { error, warning, type Finding } from "./report.ts"

/** The most characters the namespace line may take. */
export const NAMESPACE_LINE_MAX = 400

/** The most characters one skill's description may take. */
export const SKILL_DESCRIPTION_MAX = 300

/** One skill file, as T0 reads it. */
export interface Skill {
  readonly file: string
  readonly name?: string
  readonly description?: string
}

/** The text between a YAML front matter's opening and closing `---`. */
function frontMatter(text: string): string | undefined {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  if (lines[0]?.trim() !== "---") return undefined
  const end = lines.indexOf("---", 1)
  if (end < 0) return undefined
  return lines.slice(1, end).join("\n")
}

/** A front-matter field's value, including a `>` or `|` block, without its quotes. */
function field(text: string, key: string): string | undefined {
  const lines = text.split("\n")
  const at = lines.findIndex((line) => new RegExp(`^${key}\\s*:`).test(line))
  if (at < 0) return undefined
  const first = (lines[at] ?? "").replace(new RegExp(`^${key}\\s*:\\s*`), "").trim()
  const block = ["|", ">", "|-", ">-", "|+", ">+"]
  if (first !== "" && !block.includes(first)) {
    // A plain scalar may continue on the following indented lines; YAML folds those into spaces.
    const parts = [unquote(first)]
    for (const line of lines.slice(at + 1)) {
      if (line.trim() === "") continue
      if (!/^\s/.test(line)) break
      parts.push(line.trim())
    }
    return parts.join(" ")
  }
  const body: string[] = []
  for (const line of lines.slice(at + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) break
    body.push(line.replace(/^\s{2}/, ""))
  }
  const folded = first.startsWith(">")
  const joined = folded ? body.map((line) => line.trim()).filter((line) => line !== "").join(" ") : body.join("\n").trim()
  return unquote(joined)
}

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  return trimmed
}

/** Every `SKILL.md` under `skills/`, sorted by path. */
export function skillsOf(directory: string): Skill[] {
  const root = join(directory, "skills")
  const found: Skill[] = []
  const walk = (at: string): void => {
    for (const entry of readdirSync(at).sort()) {
      const path = join(at, entry)
      if (statSync(path).isDirectory()) {
        walk(path)
        continue
      }
      if (entry !== "SKILL.md") continue
      const text = readFileSync(path, "utf8")
      const matter = frontMatter(text) ?? ""
      const name = field(matter, "name")
      const description = field(matter, "description")
      found.push({ file: relative(directory, path), ...(name === undefined ? {} : { name }), ...(description === undefined ? {} : { description }) })
    }
  }
  if (existsSync(root) && statSync(root).isDirectory()) walk(root)
  return found
}

/** The markdown files T0 reads for tool references. */
function proseFiles(directory: string): string[] {
  const found: string[] = []
  for (const entry of ["AGENTS.md", "README.md", "SUPPORTED.md"]) {
    if (existsSync(join(directory, entry))) found.push(entry)
  }
  const docs = join(directory, "docs")
  if (existsSync(docs) && statSync(docs).isDirectory()) {
    const walk = (at: string): void => {
      for (const entry of readdirSync(at).sort()) {
        const path = join(at, entry)
        if (statSync(path).isDirectory()) walk(path)
        else if (entry.endsWith(".md")) found.push(relative(directory, path))
      }
    }
    walk(docs)
  }
  for (const skill of skillsOf(directory)) found.push(skill.file)
  return [...new Set(found)]
}

/** The method a tool reference names, from `tools.<name>.<method>` and, in a skill, `<name>_<method>`. */
function namedTools(text: string, plugin: string, underscored: boolean): string[] {
  const named: string[] = []
  const dotted = new RegExp(`tools\\.${plugin}\\.([a-z][a-z0-9_]*)`, "g")
  for (const match of text.matchAll(dotted)) named.push(match[1] ?? "")
  if (underscored) {
    const bare = new RegExp(`\\b${plugin}(?:-[a-z0-9]+)?_([a-z][a-z0-9_]*)`, "g")
    for (const match of text.matchAll(bare)) named.push(match[1] ?? "")
  }
  return named
}

/** The fixture's declared evidence for pinned methods, or none. */
function pinnedEvidence(directory: string): Record<string, unknown> {
  try {
    const value = JSON.parse(readFileSync(join(directory, "fixtures", "conformance.json"), "utf8")) as { pinned?: unknown }
    return value.pinned !== null && typeof value.pinned === "object" && !Array.isArray(value.pinned) ? (value.pinned as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** T0: every static gate, one finding each. */
export function staticFindings(directory: string, manifest: Manifest, options: { readonly namespace?: string | undefined; readonly record?: boolean | undefined } = {}): Finding[] {
  const findings: Finding[] = []
  const name = manifest.plugin.name
  const line = options.namespace
  if (line !== undefined) {
    if (line.length > NAMESPACE_LINE_MAX) {
      findings.push(
        error("T0.namespace-length", `the registered namespace line is ${line.length} characters, over the ${NAMESPACE_LINE_MAX}-character budget`, {
          path: "src/index.ts",
          fix: `Cut the namespace description to ${NAMESPACE_LINE_MAX} characters or fewer.`,
        }),
      )
    }
    if (/[\r\n]/.test(line)) findings.push(error("T0.namespace-length", "the registered namespace line is more than one line", { path: "src/index.ts", fix: "Write the namespace description as one line." }))
  } else {
    findings.push(warning("T0.namespace-unmeasured", "the registered namespace line was not measured, because no real host run happened", { fix: "Run T1 on Node 24, or run plugin-kit check, which measures it from the host." }))
  }

  const skills = skillsOf(directory)
  if (skills.length === 0) {
    findings.push(warning("T0.skills-missing", `${name} ships no skills/<name>/SKILL.md`, { path: "skills", fix: `Add skills/${name}/SKILL.md, with a description of at most ${SKILL_DESCRIPTION_MAX} characters.` }))
  }
  for (const skill of skills) {
    const where = skill.name === undefined ? skill.file : `${skill.name} (${skill.file})`
    if (skill.description === undefined) {
      findings.push(error("T0.skill-length", `${where} has no description, and a skill's description is what an agent reads first`, { path: skill.file, fix: "Add a description to the SKILL.md front matter." }))
    } else if (skill.description.length > SKILL_DESCRIPTION_MAX) {
      findings.push(
        error("T0.skill-length", `${where}'s description is ${skill.description.length} characters, over the ${SKILL_DESCRIPTION_MAX}-character budget`, {
          path: skill.file,
          fix: `Cut the description to ${SKILL_DESCRIPTION_MAX} characters or fewer.`,
        }),
      )
    }
    const which = skill.name ?? skill.file.split("/").at(-2) ?? ""
    if (which !== name && !which.startsWith(`${name}-`)) {
      findings.push(error("T0.skill-name", `${where} is outside the namespace ${name}: a skill is ${name} or ${name}-<topic>`, { path: skill.file, fix: `Rename the skill to ${name} or ${name}-<topic>.` }))
    }
  }

  const declared = new Set(Object.keys(manifest.methods).filter((method) => !method.startsWith("mcp:")))
  const mcpWildcard = Object.hasOwn(manifest.methods, "mcp:*")
  const mcpTools = new Set(Object.keys(manifest.methods).filter((method) => method.startsWith("mcp:") && method !== "mcp:*").map((method) => method.slice("mcp:".length)))
  const known = (method: string): boolean => declared.has(method) || mcpTools.has(method) || mcpWildcard
  const seen = new Set<string>()
  for (const file of proseFiles(directory)) {
    const text = readFileSync(join(directory, file), "utf8")
    for (const method of namedTools(text, name, file.startsWith("skills/"))) {
      if (known(method)) continue
      if (seen.has(`${file}\u0000${method}`)) continue
      seen.add(`${file}\u0000${method}`)
      findings.push(
        error("T0.tools", `${file} names the tool ${name}_${method}, and capabilities.methods declares no ${method}`, {
          path: file,
          fix: `Name a declared method as tools.${name}.<method>, or declare ${method} in capabilities.methods.`,
        }),
      )
    }
  }
  for (const method of line === undefined ? [] : namedTools(line, name, false)) {
    if (known(method)) continue
    findings.push(error("T0.tools", `the namespace line names the tool ${name}_${method}, which capabilities.methods does not declare`, { path: "src/index.ts" }))
  }

  const evidence = pinnedEvidence(directory)
  for (const [method, item] of Object.entries(manifest.methods)) {
    if (item.pinned !== true) continue
    const reason = evidence[method]
    if (typeof reason === "string" && reason.trim() !== "") continue
    findings.push(
      (options.record === true ? warning : error)("T0.pinned", `${method} is pinned, and nothing declares the session data that shows most sessions call it`, {
        path: "capabilities.methods." + method,
        fix: `Add "pinned": { "${method}": "<the evidence>" } to fixtures/conformance.json, or unpin it.`,
      }),
    )
  }

  findings.push(...docsFindings(directory, manifest))
  return findings
}
