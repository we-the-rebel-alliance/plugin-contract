/**
 * The declaration checks: what a v0 manifest must say about itself, beyond the schema.
 *
 * `readInstalledManifest` already refuses names that break §3, a host range other than `>=2.4.1 <2.5.0`, a stray
 * top-level key, a `delete_*`/`send_*`/`share_*` method whose class disagrees, a commit that does not plan, and a
 * source or action outside the plugin's namespace. This module carries the rules the schema cannot state alone:
 *
 * - a class against every method name, not only the three prefixes the schema knows;
 * - a read's method is a `read`, and a plan writes nothing;
 * - a source's operations are among its method's;
 * - an action's preview is a `read` and its commit is not;
 * - the package is `@we-the-rebel-alliance/<name>-plugin`;
 * - a specific pass-through tool is not a copy of `mcp:*`; one that classifies the tool differently is kept.
 */
import { METHOD_CLASSES, type ActionItem, type Manifest, type MethodClass, type MethodItem, type SourceItem } from "../../manifest.ts"
import * as z from "zod"
import { error, warning, type Finding } from "./report.ts"
import { urlHostProblem } from "./url-hosts.ts"

/**
 * The prefixes that settle a method's class. The schema enforces the first three; this table is the whole set, and it
 * is what makes `delete_file` (a `delete`) and `export_document` (an `export`) agree with their names.
 */
const PREFIXES: readonly { readonly pattern: RegExp; readonly class: MethodClass; readonly because: string }[] = [
  { pattern: /^(?:delete|remove|purge|trash)_/, class: "delete", because: "a method that deletes something is class delete" },
  { pattern: /^(?:send|post|reply|forward|publish)_/, class: "send", because: "a method that sends something is class send" },
  { pattern: /^share_/, class: "share", because: "a method that widens access is class share" },
  { pattern: /^(?:export|download)_/, class: "export", because: "a method whose output leaves the provider is class export" },
  { pattern: /^(?:create|update|write|set|edit|put|patch|insert|add|modify|move|rename|upload|save)_/, class: "write", because: "a method that changes something is class write" },
  { pattern: /^admin_/, class: "admin", because: "a method that administers the provider is class admin" },
]

/** How much a class may do, lowest first. A name never asks a plugin to lower a class the person already chose. */
const RISK: Readonly<Record<MethodClass, number>> = { read: 0, write: 1, export: 2, send: 3, share: 4, delete: 5, admin: 6 }

/** True when two rows give a tool the same class, effect and operations, so the second adds nothing to the first. */
function sameRule(row: MethodItem, wildcard: MethodItem): boolean {
  const operations = new Set(wildcard.operations ?? [])
  const same = (row.operations ?? []).length === operations.size && (row.operations ?? []).every((operation) => operations.has(operation))
  return row.class === wildcard.class && row.effect === wildcard.effect && same
}

/** The name a method is judged by: a pass-through MCP tool's own name, without `mcp:`. */
function methodName(method: string): string {
  return method.startsWith("mcp:") ? method.slice("mcp:".length) : method
}

/** Every finding with one manifest on its own: names, classes, reads, plans, actions and pass-through tools. */
export function declarationFindings(installed: { readonly package: string; readonly manifest: Manifest }): Finding[] {
  const findings: Finding[] = []
  const { manifest } = installed
  const name = manifest.plugin.name

  // §3: one name everywhere. The package is the repository the plugin standard names.
  const expectedPackage = `@we-the-rebel-alliance/${name}-plugin`
  if (installed.package !== expectedPackage) {
    findings.push(
      error("names.package", `the package is ${installed.package}, and contract §3 derives ${expectedPackage} from the plugin name ${name}`, {
        path: "package.json",
        fix: `Rename the package to ${expectedPackage}, or change capabilities.plugin.name to the name the package already uses.`,
      }),
    )
  }

  // §6: a class against a method's name.
  for (const [method, item] of Object.entries(manifest.methods)) {
    const named = methodName(method)
    if (named === "*") continue
    for (const prefix of PREFIXES) {
      if (!prefix.pattern.test(named) || item.class === prefix.class) continue
      if (RISK[item.class] > RISK[prefix.class]) continue
      findings.push(
        error("methods.class", `${method} is class ${item.class}, and its name says ${prefix.class}: ${prefix.because}`, {
          path: `capabilities.methods.${method}.class`,
          fix: `Set its class to ${prefix.class}, or rename it so the name and the class agree.`,
        }),
      )
      break
    }
    if (METHOD_CLASSES.includes(item.class) === false) {
      findings.push(error("methods.class", `${method} names no class the contract defines`, { path: `capabilities.methods.${method}.class` }))
    }
    if (item.plans === true && item.class !== "read") {
      findings.push(
        error("methods.plans", `${method} plans a change and is class ${item.class}: a plan writes nothing, so its method is a read`, {
          path: `capabilities.methods.${method}.class`,
          fix: "Make the planning method class read, and leave the change to the method its commits names.",
        }),
      )
    }
    if (item.commits !== undefined && manifest.methods[item.commits]?.class !== "read") {
      findings.push(
        error("methods.commits", `${method} commits ${item.commits}, which is class ${manifest.methods[item.commits]?.class}: a plan dry-runs the change and is a read`, {
          path: `capabilities.methods.${method}.commits`,
          fix: `Class ${item.commits} read, or name another planning method.`,
        }),
      )
    }
    const wildcard = manifest.methods["mcp:*"]
    if (method.startsWith("mcp:") && method !== "mcp:*" && wildcard !== undefined && sameRule(item, wildcard)) {
      findings.push(
        warning("methods.mcp-wildcard", `${method} is listed beside mcp:*, and classifies the tool as the wildcard does`, {
          path: `capabilities.methods.${method}`,
          fix: "Remove the row, or give the tool its own class, effect or operations where it differs from mcp:*.",
        }),
      )
    }
  }

  // §7: a source is read, its operations are its method's, and its detail and suggest reads are reads too.
  for (const source of manifest.sources) {
    const method = manifest.methods[source.method]
    if (method === undefined) continue // the schema's finding; nothing more to say here
    if (method.class !== "read") {
      findings.push(
        error("sources.method", `${source.id} is read by ${source.method}, which is class ${method.class}: a source is a read`, {
          path: `capabilities.sources.${source.id}.method`,
          fix: `Read ${source.id} through a read method.`,
        }),
      )
    }
    if (source.operations !== undefined && method.operations !== undefined) {
      for (const operation of source.operations) {
        if (method.operations.includes(operation)) continue
        findings.push(
          error("sources.operations", `${source.id} asserts ${operation}, and ${source.method} does not list it among its operations`, {
            path: `capabilities.sources.${source.id}.operations`,
            fix: `Add ${operation} to capabilities.methods.${source.method}.operations, or remove it from the source.`,
          }),
        )
      }
    }
    if (source.details !== undefined) {
      for (const detail of source.details) {
        if (!detail.id.startsWith(`${source.id}.`)) {
          findings.push(
            error("sources.details", `${detail.id} is a detail of ${source.id} and does not begin with ${source.id}.`, {
              path: `capabilities.sources.${source.id}.details`,
              fix: `Rename the detail to ${source.id}.<name>.`,
            }),
          )
        }
        const read = manifest.methods[detail.method]
        if (read !== undefined && read.class !== "read") {
          findings.push(
            error("sources.details", `${detail.id} is read by ${detail.method}, which is class ${read.class}: a detail read is a read`, {
              path: `capabilities.sources.${source.id}.details`,
            }),
          )
        }
      }
    }
    const suggested = source.scope?.suggest
    if (suggested !== undefined) {
      const read = manifest.methods[suggested.method]
      if (read !== undefined && read.class !== "read") {
        findings.push(
          error("sources.suggest", `${source.id}'s scope is listed by ${suggested.method}, which is class ${read.class}: a bind-time read is a read`, {
            path: `capabilities.sources.${source.id}.scope.suggest.method`,
          }),
        )
      }
      for (const operation of suggested.operations ?? []) {
        if ((source.operations ?? []).includes(operation)) {
          findings.push(
            error("sources.suggest", `${source.id}'s suggest lists ${operation}, which the source's own operations also list: a bind-time read stays out of the running grant`, {
              path: `capabilities.sources.${source.id}.scope.suggest.operations`,
            }),
          )
        }
      }
    }
    if (source.kind === "events" && source.thumbnails === true && source.urlHosts === undefined) {
      findings.push(error("sources.thumbnails", `${source.id} declares thumbnails and no urlHosts: a thumbnail is displayed only on a host the source names`, { path: `capabilities.sources.${source.id}.thumbnails` }))
    }
    for (const host of source.urlHosts ?? []) {
      const problem = urlHostProblem(host)
      if (problem !== null) findings.push(error("sources.urlHosts", `${source.id}'s urlHost ${JSON.stringify(host)} ${problem}`, { path: `capabilities.sources.${source.id}.urlHosts` }))
    }
  }

  // §8: a preview writes nothing and the commit is a different method that does.
  for (const action of manifest.actions) previewFindings(manifest, action, findings)

  return findings
}

/** One action's two methods: `preview` is a read, `commit` is not, and they differ. */
function previewFindings(manifest: Manifest, action: ActionItem, findings: Finding[]): void {
  const preview = manifest.methods[action.preview]
  const commit = manifest.methods[action.commit]
  if (preview !== undefined && preview.class !== "read") {
    findings.push(
      error("actions.preview", `${action.id}'s preview is ${action.preview}, which is class ${preview.class}: a preview writes nothing`, {
        path: `capabilities.actions.${action.id}.preview`,
        fix: `Preview ${action.id} through a read method, and commit it through ${action.commit}.`,
      }),
    )
  }
  if (commit !== undefined && commit.class === "read") {
    findings.push(
      error("actions.commit", `${action.id}'s commit is ${action.commit}, which is class read: committing an action changes something`, {
        path: `capabilities.actions.${action.id}.commit`,
        fix: `Class ${action.commit} by what it does.`,
      }),
    )
  }
  if (action.preview === action.commit) {
    findings.push(error("actions.commit", `${action.id} previews and commits through ${action.commit}: §8 asks for two different methods`, { path: `capabilities.actions.${action.id}` }))
  }
}

/** The options a plugin must declare, and the defaults the contract gives them (standard §5). */
export function optionsFindings(manifest: Manifest): Finding[] {
  const findings: Finding[] = []
  const schema = manifest.options as Record<string, unknown>
  const properties = (schema["properties"] ?? {}) as Record<string, unknown>
  const access = properties["access"] as Record<string, unknown> | undefined
  if (access === undefined) {
    findings.push(error("options.access", "the options schema does not declare access", { path: "capabilities.options.properties.access", fix: "Declare access as all, ask-changes or read-only, default all." }))
  } else {
    const values = access["enum"]
    if (Array.isArray(values) && (values.length !== 3 || !["all", "ask-changes", "read-only"].every((value) => values.includes(value)))) {
      findings.push(error("options.access", `access offers ${values.map(String).join(", ")}, and the contract's levels are all, ask-changes and read-only`, { path: "capabilities.options.properties.access.enum" }))
    }
    if (access["default"] !== undefined && access["default"] !== "all") {
      findings.push(error("options.access-default", `access defaults to ${JSON.stringify(access["default"])}, and standard §5 gives all`, { path: "capabilities.options.properties.access.default", fix: "Default access to all." }))
    }
  }
  const untested = properties["allowUntestedHost"] as Record<string, unknown> | undefined
  if (untested !== undefined && untested["default"] !== undefined && untested["default"] !== false) {
    findings.push(error("options.untested-default", `allowUntestedHost defaults to ${JSON.stringify(untested["default"])}, and standard §5 gives false`, { path: "capabilities.options.properties.allowUntestedHost.default" }))
  }
  if (manifest.accounts !== undefined && properties["accounts"] === undefined) {
    findings.push(error("options.accounts", `${manifest.plugin.name} signs in and its options declare no accounts map`, { path: "capabilities.options.properties.accounts", fix: "Declare accounts as a map of alias to profile." }))
  }
  findings.push(...defaultsFindings(schema, properties))
  return findings
}

/** The plugin's defaults, as the options schema declares them, validated against that schema. */
function defaultsFindings(schema: Record<string, unknown>, properties: Record<string, unknown>): Finding[] {
  const defaults: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(properties)) {
    if (value === null || typeof value !== "object") continue
    const property = value as Record<string, unknown>
    if (property["default"] !== undefined) defaults[name] = property["default"]
  }
  try {
    const parsed = z.fromJSONSchema(schema as never).safeParse(defaults)
    if (parsed.success) return []
    return [
      error("options.defaults", `the options' defaults do not satisfy the options schema: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "the options"}: ${issue.message}`).join("; ")}`, {
        path: "capabilities.options",
        fix: "Give every option a default the schema accepts.",
      }),
    ]
  } catch (cause) {
    return [error("options.defaults", `the options schema cannot be read: ${cause instanceof Error ? cause.message : String(cause)}`, { path: "capabilities.options" })]
  }
}

/** A method's declared operations, or none. */
export function operationsOf(method: MethodItem | undefined): readonly string[] {
  return method?.operations ?? []
}

/** True when the method is a source read: class read. */
export function isReadSource(source: SourceItem, manifest: Manifest): boolean {
  return manifest.methods[source.method]?.class === "read"
}
