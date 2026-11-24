/**
 * The `capabilities` manifest, written once in zod (contract §4). zod is the source of truth inside the package and
 * never leaves it: this module exports the validator, the plain types and the generated JSON Schema.
 *
 * Validation is strict. A key the manifest does not define is an error named by its path, and only `x-<app>` keys are
 * allowed beyond the manifest's own. The rules a schema cannot express alone — the host range, a commit target that
 * plans, one pinned method, a source id in the plugin's namespace, two services with one label — are checked here too,
 * so a consumer needs no second pass.
 */
import * as z from "zod"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { EVENT_KINDS, FACT_TYPES, isEventKindIn } from "../internal/events.ts"
import { isExtensionOutput, isOutputName } from "../registry.ts"
import type { Checked, Validator } from "../internal/checked.ts"
import { canonicalJson, manifestHash } from "./canonical.ts"
import {
  ACTION_EFFECTS,
  ACCOUNT_MECHANISMS,
  COST_CLASSES,
  DETAIL_FIELDS,
  EXTENSION_KEY,
  MANIFEST_VERSION,
  MAX_BYTES_DEFAULT,
  MAX_BYTES_LIMIT,
  METHOD_ACCOUNTS,
  METHOD_CLASSES,
  METHOD_EFFECTS,
  OPENCODE_RANGE,
  PLUGIN_NAME,
  SERVICE_ID_MAX,
  SERVICE_LABEL_MAX,
  SOURCE_SIGNALS,
  TESTED_OPENCODE,
  type ActionItem,
  type InstalledManifest,
  type Manifest,
  type MethodItem,
  type SourceItem,
} from "./types.ts"

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The most characters a name, an operation or a line may take. */
const METHOD_NAME = /^[a-z][a-z0-9_]*(?::(?:[a-z0-9][a-z0-9_.-]{0,99}|\*))?$/
const SOURCE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const SCOPE_KEY = /^[a-z][a-z0-9_]{0,31}$/
const OPERATION = /^[A-Za-z][A-Za-z0-9._-]{0,199}$/
const HOST = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/
const SCHEME = /^[a-z][a-z0-9+.-]{0,31}$/
const VENDOR_ID = /^[a-z][a-z0-9-]{0,31}$/
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
const ICON_TYPE = /^image\/[a-z0-9][a-z0-9.+-]*$/
const FILE_PATH = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*\.md$/
const PRICE_PER = /^[a-z][a-z0-9-]{0,31}$/
const PROFILE_REF = "#/options/properties/accounts/additionalProperties"

const nonEmpty = (max: number) => z.string().min(1).max(max)

const vendor = z
  .strictObject({
    id: z.string().regex(VENDOR_ID, { error: "must be a lowercase vendor id such as google" }),
    name: nonEmpty(80),
    domain: z.string().regex(DOMAIN, { error: "must be a domain such as google.com, with no scheme or path" }),
  })
  .describe("Who makes the provider the plugin talks to.")

const icon = z
  .strictObject({
    src: z.string().min(1).max(200).describe("A path inside the installed package, such as assets/icon.svg."),
    type: z.string().regex(ICON_TYPE, { error: "must be an image MIME type such as image/svg+xml" }),
  })
  .describe("One icon the package ships.")

const host = z
  .strictObject({
    opencode: z.literal(OPENCODE_RANGE, { error: `must be exactly "${OPENCODE_RANGE}" in version 1 of the contract` }),
    tested: z.array(z.string().min(1).max(40)).min(1).describe(`The OpenCode releases CI ran. It includes ${TESTED_OPENCODE}.`),
  })
  .superRefine((value, context) => {
    if (!value.tested.includes(TESTED_OPENCODE)) context.addIssue({ code: "custom", path: ["tested"], message: `must include ${TESTED_OPENCODE}, the release this contract is tested on` })
    if (new Set(value.tested).size !== value.tested.length) context.addIssue({ code: "custom", path: ["tested"], message: "must not repeat a release" })
  })
  .describe("The OpenCode range, and the releases the plugin was tested on.")

const plugin = z
  .strictObject({
    name: z.string().regex(PLUGIN_NAME, { error: "must be 2 to 31 lowercase letters or digits, with no hyphen" }),
    title: nonEmpty(80),
    summary: nonEmpty(300),
    vendor,
    icons: z.array(icon).min(1).describe("At least one icon; a consumer picks the size it needs."),
    host,
  })
  .describe("The plugin's identity, title, summary, vendor, icons and OpenCode range.")

const accountsInfo = z
  .strictObject({
    via: z.enum(ACCOUNT_MECHANISMS),
    profile: z
      .strictObject({ $ref: z.literal(PROFILE_REF, { error: `must be { "$ref": "${PROFILE_REF}" }` }) })
      .describe("A JSON-Schema $ref to the profile schema in options.")
      .optional(),
    owner: z.string().regex(SCHEME, { error: "must be a scheme such as mailto" }),
  })
  .describe("How accounts work. Absent: the plugin signs in to nothing.")

const methodName = z.string().regex(METHOD_NAME, { error: "must be a method name such as events_list or mcp:slack_send_message" })

const methodItem = z
  .strictObject({
    class: z.enum(METHOD_CLASSES),
    accounts: z.enum(METHOD_ACCOUNTS).optional().describe("optional when the method takes an account, none when it does not. Defaults to none."),
    operations: z.array(z.string().regex(OPERATION, { error: "must be a provider operation of letters, digits, dots, underscores or hyphens" })).min(1).optional(),
    plans: z.literal(true).optional().describe("The method dry-runs a change and answers { planId, method }."),
    commits: methodName.optional().describe("The planning method this method commits. It then takes only { planId }."),
    effect: z.enum(METHOD_EFFECTS).optional().describe("An override of the access setting."),
    agent: z.literal(false).optional().describe("Leave the method out of agent prompts; it stays in Code Mode, automations and RPC."),
    pinned: z.literal(true).optional().describe("The one method Code Mode sends on every turn. None by default."),
  })
  .superRefine((value, context) => {
    if (value.plans === true && value.commits !== undefined) context.addIssue({ code: "custom", path: ["commits"], message: "a method either plans a change or commits one, not both" })
    if (value.commits !== undefined) {
      if (!METHOD_NAME.test(value.commits)) context.addIssue({ code: "custom", path: ["commits"], message: "must name a declared method" })
      if (value.accounts === "optional") {
        // A commit takes { planId } and the account the grant names; it is not itself an account-taking read.
      }
    }
    if (value.operations !== undefined && new Set(value.operations).size !== value.operations.length) {
      context.addIssue({ code: "custom", path: ["operations"], message: "must not repeat an operation" })
    }
  })
  .describe("One callable: a contract method, a plugin tool or a pass-through MCP tool.")

const service = z
  .strictObject({
    id: z.string().min(1).max(SERVICE_ID_MAX),
    label: z.string().min(1).max(SERVICE_LABEL_MAX),
  })
  .describe("The outside system a source belongs to. Sources with the same id are one service with one label.")

const price = z.strictObject({
  per: z.string().regex(PRICE_PER, { error: "must be a lowercase word such as post or call" }),
  usd: z.number().finite().nonnegative(),
})

const cost = z
  .strictObject({
    class: z.enum(COST_CLASSES),
    units: z.array(price).min(1).optional(),
  })
  .superRefine((value, context) => {
    if (value.class === "free" && value.units !== undefined) context.addIssue({ code: "custom", path: ["units"], message: "a free source states no price units" })
    if (value.class !== "free" && value.units === undefined) context.addIssue({ code: "custom", path: ["units"], message: `a ${value.class} source must state its price units` })
  })
  .describe("What one read costs. A billed or metered source states its price units.")

const scope = z
  .strictObject({
    keys: z
      .array(z.string().regex(SCOPE_KEY, { error: "must be a lowercase scope key such as channels" }))
      .min(1)
      .describe("The keys a person confirms: labels, channels, repositories."),
    describe: z.string().min(1).max(200),
    suggest: z
      .strictObject({ method: methodName, operations: z.array(z.string().regex(OPERATION)).min(1).optional() })
      .describe("The read-only method that lists the values a person may pick.")
      .optional(),
  })
  .superRefine((value, context) => {
    if (new Set(value.keys).size !== value.keys.length) context.addIssue({ code: "custom", path: ["keys"], message: "must not repeat a key" })
  })
  .describe("What a person confirms at consent.")

const cadence = z
  .strictObject({
    providerMinMinutes: z.number().int().positive().optional(),
    suggestMinutes: z.number().int().positive().optional(),
  })
  .describe("The provider's floor between reads, and a suggested cadence, in minutes.")

const detail = z
  .strictObject({
    id: z.string().regex(SOURCE_ID, { error: "must be a dotted, lowercase detail id such as gws.gmail.message" }),
    method: methodName,
    from: z.array(z.enum(DETAIL_FIELDS)).min(1).describe("The event fields the detail's input comes from: identifiers, never the event's prose."),
  })
  .describe("One follow-up read of an event's detail.")

const sourceBase = {
  id: z.string().regex(SOURCE_ID, { error: "must be a dotted, lowercase source id such as gws.gmail" }),
  method: methodName.describe("The declared method that reads this source."),
  input: z.record(z.string(), z.unknown()).optional().describe("The fixed input that selects this source."),
  service: service.optional(),
  operations: z.array(z.string().regex(OPERATION, { error: "must be a provider operation" })).min(1).optional(),
  scope: scope.optional(),
  cadence: cadence.optional(),
  signals: z.array(z.enum(SOURCE_SIGNALS)).min(1).optional(),
  private: z.boolean().optional(),
  cost,
  maxBytes: z.number().int().positive().max(MAX_BYTES_LIMIT, { error: `must be at most ${MAX_BYTES_LIMIT} (1 MB)` }).optional(),
  details: z.array(detail).min(1).optional(),
  facts: z.array(z.enum(FACT_TYPES)).min(1).optional(),
  hints: z.array(z.string().max(200).regex(FILE_PATH, { error: "must be a relative path in the package ending in .md" })).min(1).optional(),
  urlHosts: z
    .array(z.string().regex(HOST, { error: "must be a lowercase domain, or *. and a domain for its subdomains" }))
    .min(1)
    .optional()
    .describe("The hosts an event's url and thumbnail_url may point at."),
}

const eventsSource = z
  .strictObject({
    ...sourceBase,
    kind: z.literal("events"),
    reads: z.string().describe("A core event kind, or x-<name>/<kind>."),
    thumbnails: z.literal(true).optional().describe("The source can answer an event's thumbnail_url (#42). Requires urlHosts."),
  })
  .superRefine((value, context) => {
    if (value.thumbnails === true && value.urlHosts === undefined) context.addIssue({ code: "custom", path: ["thumbnails"], message: "a source that declares thumbnails must declare urlHosts" })
    if (value.signals !== undefined && new Set(value.signals).size !== value.signals.length) context.addIssue({ code: "custom", path: ["signals"], message: "must not repeat a signal" })
    if (value.details !== undefined && new Set(value.details.map((entry) => entry.id)).size !== value.details.length) context.addIssue({ code: "custom", path: ["details"], message: "must not repeat a detail id" })
  })
  .describe("An events source: append-only items read with a cursor.")

const snapshotSource = z
  .strictObject({
    ...sourceBase,
    kind: z.literal("snapshot"),
    output: z.string().describe("A registry output name such as agenda, or x-<namespace>/<name>."),
  })
  .superRefine((value, context) => {
    const output = value.output
    if (!isOutputName(output) && !isExtensionOutput(output)) context.addIssue({ code: "custom", path: ["output"], message: `"${output}" is not a registered output and not an x-<namespace>/<name>` })
    if (value.signals !== undefined && new Set(value.signals).size !== value.signals.length) context.addIssue({ code: "custom", path: ["signals"], message: "must not repeat a signal" })
    if (value.details !== undefined) context.addIssue({ code: "custom", path: ["details"], message: "only an events source has detail reads" })
  })
  .describe("A snapshot source: the latest state, read on demand.")

const source = z.discriminatedUnion("kind", [eventsSource, snapshotSource]).describe("A source: an events feed or a snapshot.")

const action = z
  .strictObject({
    id: z.string().regex(SOURCE_ID, { error: "must be a dotted, lowercase action id such as gws.gmail.send" }),
    effect: z.enum(ACTION_EFFECTS),
    preview: methodName.describe("The declared method that previews the action. It writes nothing."),
    commit: methodName.describe("The declared method that commits the action. A different method from preview."),
    input: z.record(z.string(), z.unknown()).describe("JSON Schema 2020-12 for the caller's input."),
    output: z.record(z.string(), z.unknown()).describe("JSON Schema 2020-12 for the answer's output."),
  })
  .describe("One write an app can offer a person.")

const events = z
  .strictObject({
    changed: z.strictObject({}).optional().describe("The plugin knows a source changed."),
    status: z.strictObject({}).optional().describe("The plugin's state changed."),
    account: z.strictObject({}).optional().describe("An account signed in, out, or needs sign-in."),
  })
  .describe("The bus events the plugin emits. Each is declared with an empty object.")

/** A JSON Schema this package can read, or the problems with it. */
function jsonSchemaProblems(schema: unknown, what: string): string[] {
  if (!plain(schema)) return [`${what} must be a JSON Schema object`]
  try {
    z.fromJSONSchema(schema as z.core.JSONSchema.JSONSchema)
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 200) : "it cannot be read"
    return [`${what} must be a JSON Schema 2020-12 object: ${reason}`]
  }
  return []
}

/** The options schema's own rules: an object, `access`, and the plugin's extras that the manifest promises. */
function optionProblems(schema: unknown): { path: string[]; message: string }[] {
  if (!plain(schema)) return [{ path: [], message: "options must be a JSON Schema object" }]
  if (schema["type"] !== "object") return [{ path: ["type"], message: 'options must be a JSON Schema object, with "type": "object"' }]
  const properties = schema["properties"]
  if (!plain(properties)) return [{ path: ["properties"], message: "must be a JSON Schema object with properties, including access" }]
  const problems: { path: string[]; message: string }[] = []
  if (!Object.hasOwn(properties, "access")) problems.push({ path: ["properties", "access"], message: "the options schema must include access" })
  else if (!plain(properties["access"]) && typeof properties["access"] !== "boolean") problems.push({ path: ["properties", "access"], message: "must be a JSON Schema object" })
  for (const key of ["access", "accounts", "allowUntestedHost"] as const) {
    const property = properties[key]
    if (property !== undefined && !plain(property) && typeof property !== "boolean") problems.push({ path: ["properties", key], message: "must be a JSON Schema object" })
  }
  if (problems.length > 0) return problems
  try {
    z.fromJSONSchema(schema as never)
  } catch (error) {
    const reason = error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 200) : "it cannot be read"
    problems.push({ path: [], message: `options must be a JSON Schema 2020-12 object: ${reason}` })
  }
  return problems
}

const top = z
  .looseObject({
    version: z.literal(MANIFEST_VERSION),
    plugin,
    accounts: accountsInfo.optional(),
    options: z.record(z.string(), z.unknown()).describe("JSON Schema 2020-12 of the plugin's options. It must include access."),
    methods: z.record(methodName, methodItem).describe("Every callable, including pass-through MCP tools."),
    sources: z.array(source),
    actions: z.array(action),
    events,
  })
  .superRefine((value, context) => {
    const issue = (path: (string | number)[], message: string) => context.addIssue({ code: "custom", path, message })
    const known = new Set(["version", "plugin", "accounts", "options", "methods", "sources", "actions", "events"])
    for (const key of Object.keys(value)) {
      if (!known.has(key) && !EXTENSION_KEY.test(key)) issue([key], "is not a key the manifest defines; app-only hints use x-<app>")
    }
    const name = value.plugin.name
    const methods = value.methods

    // Every options schema includes access, and accounts when the manifest declares them.
    for (const problem of optionProblems(value.options)) issue(["options", ...problem.path], problem.message)
    if (value.accounts !== undefined) {
      const properties = (value.options as Record<string, unknown>)["properties"]
      if (plain(properties) && !Object.hasOwn(properties, "accounts")) {
        issue(["options", "properties", "accounts"], "an account-taking plugin declares accounts in its options schema")
      } else if (plain(properties) && plain(properties["accounts"])) {
        const accountSchema = properties["accounts"] as Record<string, unknown>
        if (!plain(accountSchema["additionalProperties"])) {
          issue(["options", "properties", "accounts", "additionalProperties"], "must define the profile schema every alias is checked against")
        }
      }
      if (value.accounts.profile !== undefined && value.accounts.profile.$ref !== PROFILE_REF) {
        issue(["accounts", "profile", "$ref"], `must be "${PROFILE_REF}"`)
      }
    }

    if (Object.keys(methods).length === 0) issue(["methods"], "must declare at least one method; status is every plugin's")
    let pinned = 0
    for (const [methodNameValue, item] of Object.entries(methods)) {
      if (item.pinned === true) pinned++
      if (item.commits !== undefined) {
        const target = methods[item.commits]
        if (target === undefined) issue(["methods", methodNameValue, "commits"], `"${item.commits}" is not a declared method`)
        else if (target.plans !== true) issue(["methods", methodNameValue, "commits"], `"${item.commits}" does not declare plans: true`)
        if (item.commits === methodNameValue) issue(["methods", methodNameValue, "commits"], "a method cannot commit itself")
      }
      const named = methodNameValue.startsWith("mcp:") ? undefined : methodNameValue
      if (named !== undefined) {
        if (/^(?:delete|remove)_/.test(named) && item.class !== "delete") issue(["methods", methodNameValue, "class"], "a delete_* or remove_* method must be class delete")
        if (/^(?:send|post)_/.test(named) && item.class !== "send") issue(["methods", methodNameValue, "class"], "a send_* or post_* method must be class send")
        if (/^share_/.test(named) && item.class !== "share") issue(["methods", methodNameValue, "class"], "a share_* method must be class share")
      }
    }
    if (pinned > 1) issue(["methods"], "at most one method may be pinned")
    if (value.accounts === undefined && Object.values(methods).some((item) => item.accounts === "optional")) {
      // Not an error: a plugin may take an account-like option without declaring accounts. Documented, not enforced.
    }

    const sourceIds = new Set<string>()
    const serviceLabels = new Map<string, string>()
    for (const [index, item] of value.sources.entries()) {
      if (item.id.split(".")[0] !== name) issue(["sources", index, "id"], `must begin with the plugin's name "${name}"`)
      if (sourceIds.has(item.id)) issue(["sources", index, "id"], `"${item.id}" is declared twice`)
      sourceIds.add(item.id)
      if (methods[item.method] === undefined) issue(["sources", index, "method"], `"${item.method}" is not a declared method`)
      if (item.kind === "events") {
        if (!isEventKindIn(item.reads, name)) issue(["sources", index, "reads"], `must be one of ${EVENT_KINDS.join(", ")}, or x-${name}/<kind>`)
      } else {
        if (!isOutputName(item.output) && !isExtensionOutput(item.output)) issue(["sources", index, "output"], `"${item.output}" is not a registered output and not an x-<namespace>/<name>`)
        if (isExtensionOutput(item.output) && !item.output.startsWith(`x-${name}/`)) issue(["sources", index, "output"], `an extension output must be in the plugin's namespace, x-${name}/<name>`)
      }
      if (item.service !== undefined) {
        const seen = serviceLabels.get(item.service.id)
        if (seen !== undefined && seen !== item.service.label) {
          issue(["sources", index, "service", "label"], `is "${item.service.label}", and ${item.service.id} says "${seen}" everywhere else`)
        } else serviceLabels.set(item.service.id, item.service.label)
      }
      if (item.scope?.suggest !== undefined && methods[item.scope.suggest.method] === undefined) {
        issue(["sources", index, "scope", "suggest", "method"], `"${item.scope.suggest.method}" is not a declared method`)
      }
      for (const [detailIndex, entry] of (item.details ?? []).entries()) {
        if (methods[entry.method] === undefined) issue(["sources", index, "details", detailIndex, "method"], `"${entry.method}" is not a declared method`)
      }
    }

    const actionIds = new Set<string>()
    for (const [index, item] of value.actions.entries()) {
      if (item.id.split(".")[0] !== name) issue(["actions", index, "id"], `must begin with the plugin's name "${name}"`)
      if (actionIds.has(item.id)) issue(["actions", index, "id"], `"${item.id}" is declared twice`)
      actionIds.add(item.id)
      if (item.preview === item.commit) issue(["actions", index, "commit"], "the commit must be a different method from the preview")
      if (methods[item.preview] === undefined) issue(["actions", index, "preview"], `"${item.preview}" is not a declared method`)
      if (methods[item.commit] === undefined) issue(["actions", index, "commit"], `"${item.commit}" is not a declared method`)
      for (const problem of jsonSchemaProblems(item.input, "input")) issue(["actions", index, "input"], problem.replace(/^input: /, ""))
      for (const problem of jsonSchemaProblems(item.output, "output")) issue(["actions", index, "output"], problem.replace(/^output: /, ""))
    }
  })

/** A path as a person reads it: `.methods.send.class`, `[2].id`, or nothing for the root. */
function pathText(path: readonly PropertyKey[]): string {
  return path.map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`)).join("")
}

/** The manifest's problems from a zod error, paths rooted at `capabilities`. */
function problemsOf(error: z.ZodError): string[] {
  const problems: string[] = []
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) problems.push(`capabilities${pathText([...issue.path, key])}: is not a key the manifest defines; app-only hints use x-<app>`)
      continue
    }
    problems.push(`capabilities${pathText(issue.path)}: ${issue.message}`)
  }
  return problems
}

/** The `capabilities` value checked; problems name their path, such as `capabilities.methods.send.class`. */
export function checkManifest(value: unknown): Checked<Manifest> {
  const result = top.safeParse(value)
  return result.success ? { ok: true, value: result.data as Manifest } : { ok: false, problems: problemsOf(result.error) }
}

/** The manifest's problems, one sentence each; empty when it validates. */
export function manifestProblems(value: unknown): readonly string[] {
  const checked = checkManifest(value)
  return checked.ok ? [] : checked.problems
}

/** The validator a module publishes: zod stays inside the package, and the JSON Schema is generated from it. */
export const MANIFEST_SCHEMA: Validator<Manifest> = {
  name: "capabilities",
  check: checkManifest,
  parse(value) {
    const checked = checkManifest(value)
    if (checked.ok) return checked.value
    throw new Error(`capabilities: the manifest breaks the schema:\n- ${checked.problems.join("\n- ")}`)
  },
  jsonSchema() {
    return z.toJSONSchema(top, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>
  },
}

/**
 * The manifest of the package installed at `directory`: its package.json's `capabilities`, checked and hashed. With
 * `version`, the package.json must say that version, so a consumer reads the package it believes is installed.
 */
export function readInstalledManifest(directory: string, options: { readonly version?: string } = {}): Checked<InstalledManifest> {
  const file = join(directory, "package.json")
  let pkg: unknown
  try {
    pkg = JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === "ENOENT" ? "there is no package.json there" : "its package.json is not JSON"
    return { ok: false, problems: [`no manifest at ${directory}: ${reason}`] }
  }
  if (!plain(pkg)) return { ok: false, problems: [`no manifest at ${directory}: its package.json is not an object`] }
  const { name, version, capabilities } = pkg
  if (typeof name !== "string" || typeof version !== "string") return { ok: false, problems: [`no manifest at ${directory}: its package.json has no name and version`] }
  if (options.version !== undefined && options.version !== version) {
    return { ok: false, problems: [`${name} at ${directory} is version ${version}, not the ${options.version} the install names`] }
  }
  if (capabilities === undefined) return { ok: false, problems: [`${name} ${version} declares no manifest (no top-level "capabilities" key)`] }
  const checked = checkManifest(capabilities)
  if (!checked.ok) return { ok: false, problems: checked.problems.map((problem) => `${name} ${version}: ${problem}`) }
  return { ok: true, value: { package: name, version, directory, manifest: checked.value, hash: manifestHash(capabilities) } }
}

/**
 * The directory of the package `name` as Node would find it installed from `from`: the nearest
 * `node_modules/<name>/package.json` at or above it. Undefined when none is installed.
 */
export function findInstalledPackage(name: string, from: string): string | undefined {
  if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name)) return undefined
  let directory = from
  for (;;) {
    const candidate = join(directory, "node_modules", ...name.split("/"))
    if (existsSync(join(candidate, "package.json"))) return candidate
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** A source by id, from a manifest. */
export function findSource(manifest: Manifest, id: string): SourceItem | undefined {
  return manifest.sources.find((source) => source.id === id)
}

/** An action by id, from a manifest. */
export function findAction(manifest: Manifest, id: string): ActionItem | undefined {
  return manifest.actions.find((action) => action.id === id)
}

/** A method by name, from a manifest. */
export function findMethod(manifest: Manifest, name: string): MethodItem | undefined {
  return manifest.methods[name]
}

/** Whether a method takes an account: `optional` or `none`, `none` when it does not say. */
export function methodAccounts(method: Pick<MethodItem, "accounts">): "optional" | "none" {
  return method.accounts ?? "none"
}

/** The most bytes one answer of this source may take: its `maxBytes`, or 64 KB. */
export function maxBytesOf(source: { readonly maxBytes?: number | undefined }): number {
  return source.maxBytes ?? MAX_BYTES_DEFAULT
}

export { canonicalJson, manifestHash }
