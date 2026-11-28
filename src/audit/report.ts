/**
 * The audit report: for one person, what every installed plugin may read and do, and the grant behind each declaration
 * (contract §15; issue #94).
 *
 * The report is evidence for an auditor, not a read: it is built from the installed manifests, the person's access
 * level per plugin and the grant records the host keeps. It never asks a provider, reads a clock or carries content, a
 * credential or a token. A grant for a plugin, source or action that is not installed is kept in `problems` with its
 * binding, never dropped and never thrown.
 */
import * as z from "zod"
import { ACCESS_LEVELS, accessLevel, effectFor, type AccessLevel, type ActGrant, type Grant } from "../access.ts"
import type { CatalogPlugin } from "../catalog.ts"
import { canonicalScope } from "../grant/input.ts"
import type { Validator } from "../internal/checked.ts"
import { validator } from "../internal/validator.ts"
import {
  COST_CLASSES,
  METHOD_ACCOUNTS,
  METHOD_CLASSES,
  METHOD_EFFECTS,
  type Cost,
  type InstalledManifest,
  type MethodClass,
  type MethodEffect,
  type MethodItem,
} from "../manifest.ts"

/** The effect an access level and a method give a call, as an auditor reads it. */
export type AuditAccess = "runs" | "asks first" | "off"

/** One method a plugin declares, and the effect the person's level gives it. */
export interface AuditMethod {
  /** The method's name in the manifest, such as `events_list` or `mcp:*`. */
  readonly method: string
  readonly class: MethodClass
  /** The method's own narrowing, when it declares one. */
  readonly effect?: MethodEffect | undefined
  /** What the person's access level gives it, from the same `effectFor` the access rules use. */
  readonly access: AuditAccess
}

/** One grant behind a source or an action, as the report shows it. */
export interface AuditGrantBinding {
  /** Who the grant was issued to. */
  readonly consumer: string
  /** The account alias the person confirmed. */
  readonly account: string
  /** The confirmed scope, in canonical form: keys sorted, each list sorted and without repeats. */
  readonly scope: Readonly<Record<string, string | readonly string[]>>
  /** The manifest hash the person consented to. */
  readonly manifestHash: string
  /** The person turned the binding off. */
  readonly disabled: boolean
  /** The person who gave the grant. */
  readonly person: string
  /** When the person gave it, ISO 8601. */
  readonly grantedAt: string
  /** The installed manifest's hash is not the one the grant names, so consent is stale. */
  readonly stale?: true | undefined
}

/** One source a plugin declares, and every grant behind it. */
export interface AuditSource {
  readonly id: string
  /** The declared method that reads the source. */
  readonly method: string
  /** The provider operations the source's reads assert. */
  readonly operations: readonly string[]
  /** Whether the reading method takes an account. */
  readonly accounts: "optional" | "none"
  /** Everything the source reads is personal. */
  readonly private: boolean
  /** What one read costs, as the manifest declares it. */
  readonly cost: Cost
  readonly grants: readonly AuditGrantBinding[]
}

/** One action a plugin declares, and every grant behind it. */
export interface AuditAction {
  readonly id: string
  /** The declared method that previews the action. It writes nothing. */
  readonly preview: string
  /** The declared method that commits the action. */
  readonly commit: string
  /** The operations the preview and commit methods declare, in declaration order and without repeats. */
  readonly operations: readonly string[]
  /** Whether the action always needs the person's confirmation. A non-`local` action does. */
  readonly confirmation: "required" | "optional"
  readonly grants: readonly AuditGrantBinding[]
}

/** One installed plugin, its declarations and the person's access level. */
export interface AuditPlugin {
  readonly package: string
  readonly version: string
  readonly manifestHash: string
  readonly access: AccessLevel
  readonly sources: readonly AuditSource[]
  readonly actions: readonly AuditAction[]
  readonly methods: readonly AuditMethod[]
}

/** A grant that names something the installed plugins do not declare, kept with its binding. */
export interface AuditProblem {
  /** What is missing, in one sentence. */
  readonly problem: string
  readonly grant: AuditGrantBinding
}

/** The evidence an auditor reads: one person, every installed plugin, and every grant that could not be placed. */
export interface AuditReport {
  readonly person: string
  readonly plugins: readonly AuditPlugin[]
  readonly problems: readonly AuditProblem[]
}

/** A read grant with the person and moment the host keeps beside it; the grant types carry neither. */
export interface ReadGrantRecord extends Grant {
  readonly person: string
  readonly grantedAt: string
}

/** An action grant with the person and moment the host keeps beside it; the grant types carry neither. */
export interface ActGrantRecord extends ActGrant {
  readonly person: string
  readonly grantedAt: string
}

/** One of the person's grant records: a read grant or an action grant. */
export type AuditGrantRecord = ReadGrantRecord | ActGrantRecord

/** What `auditReport` reads: the installed plugins, the person's access level per plugin, and their grants. */
export interface AuditInput {
  /** The person this report is for. */
  readonly person: string
  /** `listInstalledPlugins`' plugins, or any installed manifests. */
  readonly plugins: readonly (InstalledManifest | CatalogPlugin)[]
  /** The `options.access` level by plugin name. A plugin not named here is `all`. */
  readonly access?: Readonly<Record<string, AccessLevel>> | undefined
  /** The person's grant records; each carries the `person` and `grantedAt` the grant types do not. */
  readonly grants?: readonly AuditGrantRecord[] | undefined
}

const auditAccess = z.enum(["runs", "asks first", "off"])
const auditScope = z.record(z.string(), z.union([z.string(), z.array(z.string())]))
const price = z.strictObject({ per: z.string().min(1), usd: z.number().finite().nonnegative() })
const cost = z.strictObject({ class: z.enum(COST_CLASSES), units: z.array(price).min(1).optional() })
const grantBinding = z
  .strictObject({
    consumer: z.string().min(1),
    account: z.string().min(1),
    scope: auditScope,
    manifestHash: z.string().min(1),
    disabled: z.boolean(),
    person: z.string().min(1),
    grantedAt: z.iso.datetime({ offset: true }),
    stale: z.literal(true).optional(),
  })
  .describe("One grant behind a source or an action, and the binding the person consented to.")
const auditMethod = z.strictObject({
  method: z.string().min(1),
  class: z.enum(METHOD_CLASSES),
  effect: z.enum(METHOD_EFFECTS).optional(),
  access: auditAccess,
})
const auditSource = z.strictObject({
  id: z.string().min(1),
  method: z.string().min(1),
  operations: z.array(z.string()),
  accounts: z.enum(METHOD_ACCOUNTS),
  private: z.boolean(),
  cost,
  grants: z.array(grantBinding),
})
const auditAction = z.strictObject({
  id: z.string().min(1),
  preview: z.string().min(1),
  commit: z.string().min(1),
  operations: z.array(z.string()),
  confirmation: z.enum(["required", "optional"]),
  grants: z.array(grantBinding),
})
const auditPlugin = z.strictObject({
  package: z.string().min(1),
  version: z.string().min(1),
  manifestHash: z.string().min(1),
  access: z.enum(ACCESS_LEVELS),
  sources: z.array(auditSource),
  actions: z.array(auditAction),
  methods: z.array(auditMethod),
})
const auditProblem = z.strictObject({ problem: z.string().min(1), grant: grantBinding })
const auditReportSchema = z
  .strictObject({ person: z.string().min(1), plugins: z.array(auditPlugin), problems: z.array(auditProblem) })
  .describe("What each installed plugin may read and do for one person, and the grant behind each declaration.")

/** The audit report schema, published as `dist/schemas/audit.json`. */
export const AUDIT_SCHEMA: Validator<AuditReport> = validator("audit", auditReportSchema)

/** What a permission rule's effect reads as in an audit report. */
function accessOf(effect: "allow" | "ask" | "deny"): AuditAccess {
  return effect === "allow" ? "runs" : effect === "ask" ? "asks first" : "off"
}

/** The operations of the methods named, in declaration order and without repeats. */
function operationsOf(...methods: readonly (MethodItem | undefined)[]): string[] {
  const seen = new Set<string>()
  const operations: string[] = []
  for (const method of methods) {
    for (const operation of method?.operations ?? []) {
      if (seen.has(operation)) continue
      seen.add(operation)
      operations.push(operation)
    }
  }
  return operations
}

/** A method's declaration and the effect the access level gives it. */
function methodOf(name: string, item: MethodItem, level: AccessLevel): AuditMethod {
  return {
    method: name,
    class: item.class,
    ...(item.effect === undefined ? {} : { effect: item.effect }),
    access: accessOf(effectFor(item, level)),
  }
}

/** The canonical scope of a grant; the raw binding when it is not one canonicalScope reads, which is never thrown. */
function scopeOf(grant: AuditGrantRecord): AuditGrantBinding["scope"] {
  const scope = "scope" in grant ? grant.scope : undefined
  try {
    return canonicalScope(scope)
  } catch {
    return scope ?? {}
  }
}

/** One grant as the report shows it; `stale` only when an installed hash says the consent is old. */
function bindingOf(grant: AuditGrantRecord, installedHash?: string): AuditGrantBinding {
  return {
    consumer: grant.consumer,
    account: grant.account,
    scope: scopeOf(grant),
    manifestHash: grant.manifestHash,
    disabled: grant.disabled ?? false,
    person: grant.person,
    grantedAt: grant.grantedAt,
    ...(installedHash !== undefined && grant.manifestHash !== installedHash ? { stale: true as const } : {}),
  }
}

/** The access level the input names for a plugin, or `all`; an invalid level is a caller error, never a wider default. */
function levelOf(input: AuditInput, installed: InstalledManifest): AccessLevel {
  const raw = input.access?.[installed.manifest.plugin.name]
  const checked = accessLevel(raw === undefined ? {} : { access: raw })
  if (!checked.ok) throw new Error(`audit: the access level for ${installed.manifest.plugin.name} is invalid: ${checked.problems.join("; ")}`)
  return checked.value
}

/** A source while its grants are being placed: the same declaration, with a list the builder fills. */
type MutableSource = Omit<AuditSource, "grants"> & { grants: AuditGrantBinding[] }

/** An action while its grants are being placed. */
type MutableAction = Omit<AuditAction, "grants"> & { grants: AuditGrantBinding[] }

/** A plugin while its grants are being placed. */
type MutablePlugin = Omit<AuditPlugin, "sources" | "actions"> & { sources: MutableSource[]; actions: MutableAction[] }

/** One installed plugin's declarations, with empty grant lists for the grants to fill. */
function reportOf(installed: InstalledManifest, level: AccessLevel): MutablePlugin {
  const manifest = installed.manifest
  const method = (name: string): MethodItem | undefined => manifest.methods[name]
  return {
    package: installed.package,
    version: installed.version,
    manifestHash: installed.hash,
    access: level,
    sources: manifest.sources.map((source) => ({
      id: source.id,
      method: source.method,
      operations: [...(source.operations ?? [])],
      accounts: method(source.method)?.accounts ?? "none",
      private: source.private ?? false,
      cost: {
        class: source.cost.class,
        ...(source.cost.units === undefined ? {} : { units: source.cost.units.map((unit) => ({ per: unit.per, usd: unit.usd })) }),
      },
      grants: [],
    })),
    actions: manifest.actions.map((action) => ({
      id: action.id,
      preview: action.preview,
      commit: action.commit,
      operations: operationsOf(method(action.preview), method(action.commit)),
      confirmation: action.effect === "local" ? "optional" : "required",
      grants: [],
    })),
    methods: Object.entries(manifest.methods).map(([name, item]) => methodOf(name, item, level)),
  }
}

/** True for an action grant, whose id is `action`; a read grant names a source. */
function isActGrant(grant: AuditGrantRecord): grant is ActGrantRecord {
  return typeof (grant as { readonly action?: unknown }).action === "string"
}

/** The plugin name a source or action id begins with, which is the manifest's plugin name (contract §3). */
const pluginOf = (id: string): string => id.split(".")[0] ?? id

/**
 * Builds the audit report for one person: every installed plugin's sources, actions and methods under the person's
 * access level, with the grants behind each, and every grant that names something not installed in `problems`.
 */
export function auditReport(input: AuditInput): AuditReport {
  const contexts = input.plugins.map((installed) => ({ installed, report: reportOf(installed, levelOf(input, installed)) }))
  const byName = new Map<string, (typeof contexts)[number]>()
  for (const context of contexts) byName.set(context.installed.manifest.plugin.name, context)

  const problems: AuditProblem[] = []
  for (const grant of input.grants ?? []) {
    const act = isActGrant(grant)
    const id = act ? grant.action : grant.source
    if (typeof id !== "string" || id === "") {
      problems.push({ problem: "the grant names neither a source nor an action", grant: bindingOf(grant) })
      continue
    }
    const context = byName.get(pluginOf(id))
    const binding = bindingOf(grant, context?.installed.hash)
    if (context === undefined) {
      problems.push({ problem: `the plugin "${pluginOf(id)}" is not installed`, grant: binding })
      continue
    }
    if (act) {
      const action = context.report.actions.find((entry) => entry.id === grant.action)
      if (action === undefined) {
        problems.push({
          problem: `the action "${grant.action}" is not declared by ${context.installed.package} ${context.installed.version}`,
          grant: binding,
        })
        continue
      }
      action.grants.push(binding)
      continue
    }
    const source = context.report.sources.find((entry) => entry.id === grant.source)
    if (source === undefined) {
      problems.push({
        problem: `the source "${grant.source}" is not declared by ${context.installed.package} ${context.installed.version}`,
        grant: binding,
      })
      continue
    }
    source.grants.push(binding)
  }

  return { person: input.person, plugins: contexts.map((context) => context.report), problems }
}
