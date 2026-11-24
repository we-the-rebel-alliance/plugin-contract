/**
 * A plugin on disk, as the kit's commands find one: a package.json with a valid manifest, the five docs with current
 * generated sections, and an AGENTS.md with the headings the standard requires.
 *
 * A case starts from this and changes one thing, so a failing assertion names the change, not the fixture.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import type { Manifest } from "../../src/manifest.ts"
import { applySection, generatedSections } from "../../src/kit/docs.ts"

/** A complete, valid manifest a case can copy and change. */
export function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    version: 1,
    plugin: {
      name: "acme",
      title: "Acme",
      summary: "Acme messages, channels and sends.",
      vendor: { id: "acme", name: "Acme Inc.", domain: "acme.test" },
      icons: [{ src: "assets/icon.svg", type: "image/svg+xml" }],
      host: { opencode: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
    },
    options: {
      type: "object",
      properties: {
        access: { type: "string", enum: ["all", "ask-changes", "read-only"], default: "all", description: "How much the plugin's methods may do." },
        allowUntestedHost: { type: "boolean", default: false, description: "Start outside the tested OpenCode range." },
      },
      required: [],
    },
    methods: {
      status: { class: "read", accounts: "none" },
      events_list: { class: "read", operations: ["acme.events.list"] },
      plan: { class: "read", plans: true, operations: ["acme.plan"] },
      send: { class: "send", operations: ["acme.send"], commits: "plan" },
    },
    sources: [
      {
        id: "acme.feed",
        kind: "events",
        reads: "message",
        method: "events_list",
        operations: ["acme.events.list"],
        service: { id: "acme.feed", label: "Acme Feed" },
        signals: ["bus"],
        cadence: { suggestMinutes: 5, providerMinMinutes: 2 },
        cost: { class: "free" },
        scope: { keys: ["channels"], describe: "Channels to read." },
      },
    ],
    actions: [{ id: "acme.send", effect: "notify", preview: "plan", commit: "send", input: { type: "object" }, output: { type: "object" } }],
    events: { changed: {}, status: {} },
    ...over,
  }
}

/** A temporary plugin directory, removed by `cleanup`. */
export interface PluginDir {
  readonly dir: string
  cleanup(): void
}

/** Create a plugin directory with a valid package.json. */
export function pluginDir(name = "acme", over: Partial<Manifest> = {}): PluginDir {
  const dir = mkdtempSync(join(tmpdir(), `plugin-kit-${name}-`))
  const value = manifest({ ...over, plugin: { ...manifest().plugin, name, ...(over.plugin ?? {}) } })
  writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: `@we-the-rebel-alliance/${name}-plugin`, version: "0.0.0", private: true, type: "module", repository: { url: `git+https://github.com/we-the-rebel-alliance/${name}-plugin.git` }, capabilities: value }, null, 2)}\n`)
  mkdirSync(join(dir, "assets"), { recursive: true })
  writeFileSync(join(dir, "assets", "icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n")
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Write the docs with current generated sections, and an AGENTS.md with every required heading. */
export function writeDocs(dir: string, value: Manifest): void {
  const byFile = new Map<string, { section: string; body: string }[]>()
  for (const section of generatedSections(value)) byFile.set(section.file, [...(byFile.get(section.file) ?? []), section])
  for (const [file, sections] of byFile) {
    let text = `# ${file === "README.md" ? "Acme" : file}\n\nHand-written text stays outside the markers.\n`
    for (const section of sections) {
      text += `\n<!-- kit:start:${section.section} -->\n<!-- kit:end:${section.section} -->\n`
      text = applySection(text, section.section, section.body).text
    }
    write(join(dir, file), text)
  }
  write(
    join(dir, "AGENTS.md"),
    [
      "# AGENTS.md: Acme (acme)",
      "",
      "## What this plugin is",
      "",
      "Acme messages.",
      "",
      "## Names",
      "",
      "| Thing | Value |",
      "| --- | --- |",
      "| Plugin id | `acme` |",
      "",
      "## Commands",
      "",
      "`npx plugin-kit check`.",
      "",
      "## Layout",
      "",
      "`src/`.",
      "",
      "## Rules",
      "",
      "1. The manifest is the source of truth.",
      "",
      "## Adding a capability",
      "",
      "1. Declare it.",
      "",
      "## Docs",
      "",
      "Generated sections are between markers.",
      "",
      "## Forbidden",
      "",
      "- Naming an app.",
      "",
    ].join("\n"),
  )
  write(join(dir, "CHANGELOG.md"), "# Changelog\n\n## Unreleased\n\n- The first release.\n")
}

/** Write a file, creating its parent directory. */
export function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

/** A plugin directory with its docs. */
export function fullPlugin(name = "acme", over: Partial<Manifest> = {}): PluginDir {
  const plugin = pluginDir(name, over)
  writeDocs(plugin.dir, manifest({ ...over, plugin: { ...manifest().plugin, name, ...(over.plugin ?? {}) } }))
  return plugin
}
