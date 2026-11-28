/**
 * The audit report: what each installed plugin may read and do for one person, with the grant behind each declaration
 * (contract §6, §7, §8 and §13; issue #94).
 *
 * The input is the catalog's installed manifests, the person's `options.access` per plugin, and the person's grant
 * records. A grant record is a read `Grant` or an `ActGrant` with the person who gave it and the time they gave it
 * beside it, because the grant types carry neither. The report is plain data, validates against
 * `dist/schemas/audit.json`, and carries no credential, token or provider value.
 *
 * A grant whose plugin, source or action is not installed goes to `problems`, never dropped and never thrown. A grant
 * whose manifest hash is not the installed manifest's hash is marked `stale`; a grant the person turned off is marked
 * `disabled`. The renderer is `renderAuditReport` in `./render.ts`.
 */
import * as z from "zod"
import {
  ACCESS_LEVELS,
  accessLevel,
  DEFAULT_ACCESS,
  effectFor,
  type AccessLevel,
  type ActGrant,
  type Grant,
} from "../access.ts"
import { COST_CLASSES, METHOD_CLASSES, METHOD_EFFECTS } from "../manifest.ts"
import type { Cost, InstalledManifest, MethodClass, MethodEffect } from "../manifest.ts"
import type { Validator } from "../internal/checked.ts"
import { validator } from "../internal/validator.ts"

/** What an access level gives one method: it runs, it asks first, or it is off. */
export type AuditAccess = "runs" | "asks first" | "off"

/** Whether an action needs a person's confirmation: every effect but `local` does (contract §8). */
export type AuditConfirmation = "required" | "none"

/** One piece of grant evidence under a source or action. It names no credential. */
export interface AuditGrant {
  /** Who reads or acts: the grant's consumer, such as `notes`. */
  readonly consumer: string
  /** The account alias the person confirmed. */
  readonly account: string
  /** The scope the person confirmed, with keys and list values in canonical order. */
  readonly scope: Readonly<Record<string, readonly string[]>>
  /** The manifest hash the person consented to. */
  readonly manifestHash: string
  /** The person turned this binding off. */
  readonly disabled: boolean
  /** The grant's hash is not the installed manifest's hash, so the person must consent again. */
  readonly stale: boolean
  /** Who gave the grant. */
  readonly person: string
  /** When they gave it, ISO 8601. */
  readonly grantedAt: string
}

/**
 * One of the person's grant records: a read `Grant` or an `ActGrant` with `person` and `grantedAt` beside it. A record
 * may also wrap the grant in `grant`, for a store that keeps the evidence in its own row.
 */
export type AuditGrantRecord =
  | ((Grant | ActGrant) & { readonly person: string; readonly grantedAt: string })
  | { readonly grant: Grant | ActGrant; readonly person: string; readonly grantedAt: string }

/** One method, its declared narrowing and what the person's access level makes of it. */
export interface AuditMethod {
  /** The method's name, as `capabilities.methods` keys it. */
  readonly method: string
  readonly class: MethodClass
  /** The manifest's own narrowing, when it declares one. */
  readonly effect?: MethodEffect | undefined
  /** What the access level gives the method: `runs`, `asks first` or `off`. */
  readonly access: AuditAccess
}

/** One source the plugin declares, with the grants behind it. */
export interface AuditSource {
  readonly id: string
  /** The declared method that reads the source. */
  readonly method: string
  /** The provider operations the source's reads assert. */
  readonly operations: readonly string[]
  /** The accounts the grants behind this source name, sorted. */
  readonly accounts: readonly string[]
  /** True when everything the source reads is personal. */
  readonly private: boolean
  readonly cost: Cost
  readonly grants: readonly AuditGrant[]
}

/** One action the plugin declares, with the grants behind it. */
export interface AuditAction {
  readonly id: string
  /** The declared method that previews the action. */
  readonly preview: string
  /** The declared method that commits the action. */
  readonly commit: string
  /** The provider operations the preview and the commit assert. */
  readonly operations: readonly string[]
  /** The action's confirmation rule: every effect but `local` needs one. */
  readonly confirmation: AuditConfirmation
  readonly grants: readonly AuditGrant[]
}

/** One installed plugin as the audit shows it. */
export interface AuditPlugin {
  readonly package: string
  readonly version: string
  readonly manifestHash: string
  readonly access: AccessLevel
  readonly methods: readonly AuditMethod[]
  readonly sources: readonly AuditSource[]
  readonly actions: readonly AuditAction[]
}

/** A grant whose plugin, source or action is not installed: kept, with the reason. */
export interface AuditProblem {
  readonly kind: "read" | "act"
  /** The grant's source id or action id. */
  readonly target: string
  /** Why it is not in a plugin's table. */
  readonly reason: string
  /** The grant itself, so the evidence is never lost. */
  readonly grant: AuditGrant
}

/** What an auditor receives: one person, every installed plugin, and the grants that do not fit. */
export interface AuditReport {
  readonly person: string
  readonly plugins: readonly AuditPlugin[]
  readonly problems: readonly AuditProblem[]
}

/** The report's input: the installed plugins, the person's access levels and grant records. */
export interface AuditInput {
  /** The person the report is about. */
  readonly person: string
  /** The catalog's installed plugins (`CatalogPlugin[]` or `InstalledManifest[]`). */
  readonly installed?: readonly InstalledManifest[]
  /** An alias for `installed`, for a caller that names the catalogue's `plugins` list directly. */
  readonly plugins?: readonly InstalledManifest[]
  /** The person's grants, each with `person` and `grantedAt`. */
  readonly grants?: readonly AuditGrantRecord[]
  /**
   * The access level per plugin, keyed by package or plugin name. A single level applies to every plugin. The value
   * is `options.access`, and its default is `all`.
   */
  readonly access?: AccessLevel | Readonly<Record<string, AccessLevel | Readonly<Record<string, unknown>>>>
  /** Each plugin's stored options, keyed by package or plugin name; `options.access` is read from here. */
  readonly options?: Readonly<Record<string, AccessLevel | Readonly<Record<string, unknown>>>>
}

/** The input's access level for one plugin: `access` first, then `options.access`, then `all`. */
function levelFor(input: AuditInput, installed: InstalledManifest): AccessLevel {
  const keys = [installed.package, installed.manifest.plugin.name]
  const read = (value: AccessLevel | Readonly<Record<string, unknown>> | undefined): AccessLevel | undefined => {
    if (value === undefined) return undefined
    if (typeof value === "string") return (ACCESS_LEVELS as readonly string[]).includes(value) ? (value as AccessLevel) : undefined
    const checked = accessLevel(value)
    return checked.ok ? checked.value : undefined
  }
  if (typeof input.access === "string") {
    const level = read(input.access)
    if (level !== undefined) return level
  } else if (input.access !== undefined) {
    for (const key of keys) {
      const level = read(input.access[key])
      if (level !== undefined) return level
    }
  }
  for (const key of keys) {
    const level = read(input.options?.[key])
    if (level !== undefined) return level
  }
  return DEFAULT_ACCESS
}

/** What one access effect reads as in the report. */
function accessText(effect: "allow" | "ask" | "deny"): AuditAccess {
  return effect === "allow" ? "runs" : effect === "ask" ? "asks first" : "off"
}

/** A scope with keys sorted and each list sorted without repeats; provider text is kept as it is. */
function canonicalScope(scope: Grant["scope"] | undefined): Readonly<Record<string, readonly string[]>> {
  const out: Record<string, readonly string[]> = {}
  for (const key of Object.keys(scope ?? {}).sort()) {
    out[key] = [...new Set(scope?.[key] ?? [])].sort()
  }
  return out
}

/** The grant, the person and the time, whichever record shape the caller keeps. */
function recordOf(record: AuditGrantRecord): { readonly grant: Grant | ActGrant; readonly person: string; readonly grantedAt: string } {
  const wrapped = record as { readonly grant?: Grant | ActGrant; readonly person: string; readonly grantedAt: string }
  if (wrapped.grant !== undefined && !("consumer" in record)) {
    return { grant: wrapped.grant, person: wrapped.person, grantedAt: wrapped.grantedAt }
  }
  const grant = record as (Grant | ActGrant) & { readonly person: string; readonly grantedAt: string }
  return { grant, person: grant.person, grantedAt: grant.grantedAt }
}

/** The grant's evidence, with `stale` compared with the installed manifest when there is one. */
function evidenceOf(grant: Grant | ActGrant, person: string, grantedAt: string, installed: InstalledManifest | undefined): AuditGrant {
  return {
    consumer: grant.consumer,
    account: grant.account,
    scope: "source" in grant ? canonicalScope(grant.scope) : {},
    manifestHash: grant.manifestHash,
    disabled: grant.disabled === true,
    stale: installed !== undefined && grant.manifestHash !== installed.hash,
    person,
    grantedAt,
  }
}

/** Each operation once, in declaration order. */
function operationsOf(...lists: readonly (readonly string[] | undefined)[]): readonly string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const list of lists) {
    for (const operation of list ?? []) {
      if (seen.has(operation)) continue
      seen.add(operation)
      out.push(operation)
    }
  }
  return out
}

/** The plugin name a source or action id begins with: `<name>.<capability>`. */
function namespaceOf(id: string): string {
  return id.split(".")[0] ?? id
}

/** What a source declares, before its grants are attached. */
type SourceWithoutGrants = Omit<AuditSource, "accounts" | "grants">
/** What an action declares, before its grants are attached. */
type ActionWithoutGrants = Omit<AuditAction, "grants">

interface PendingPlugin {
  readonly installed: InstalledManifest
  readonly access: AccessLevel
  readonly methods: readonly AuditMethod[]
  readonly sources: readonly SourceWithoutGrants[]
  readonly actions: readonly ActionWithoutGrants[]
  readonly sourceIds: ReadonlySet<string>
  readonly actionIds: ReadonlySet<string>
}

/** Build the audit report for one person. Never throws for a grant that does not fit: it goes to `problems`. */
export function auditReport(input: AuditInput): AuditReport {
  const installed = input.installed ?? input.plugins ?? []
  const pending: PendingPlugin[] = installed.map((entry) => {
    const level = levelFor(input, entry)
    const methods = Object.entries(entry.manifest.methods).map(([method, item]): AuditMethod => ({
      method,
      class: item.class,
      ...(item.effect === undefined ? {} : { effect: item.effect }),
      access: accessText(effectFor(item, level)),
    }))
    const sources = entry.manifest.sources.map((source): SourceWithoutGrants => ({
      id: source.id,
      method: source.method,
      operations: source.operations ?? [],
      private: source.private === true,
      cost: source.cost,
    }))
    const actions = entry.manifest.actions.map((action): ActionWithoutGrants => {
      const preview = entry.manifest.methods[action.preview]
      const commit = entry.manifest.methods[action.commit]
      return {
        id: action.id,
        preview: action.preview,
        commit: action.commit,
        operations: operationsOf(preview?.operations, commit?.operations),
        confirmation: action.effect === "local" ? "none" : "required",
      }
    })
    return {
      installed: entry,
      access: level,
      methods,
      sources,
      actions,
      sourceIds: new Set(sources.map((source) => source.id)),
      actionIds: new Set(actions.map((action) => action.id)),
    }
  })
  const byName = new Map<string, PendingPlugin>()
  for (const entry of pending) {
    const name = entry.installed.manifest.plugin.name
    if (!byName.has(name)) byName.set(name, entry)
  }

  const grants = new Map<string, AuditGrant[]>()
  const problems: AuditProblem[] = []
  for (const record of input.grants ?? []) {
    const { grant, person, grantedAt } = recordOf(record)
    const read = "source" in grant
    const target = read ? grant.source : grant.action
    const kind = read ? "read" : "act"
    const entry = byName.get(namespaceOf(target))
    if (entry === undefined) {
      problems.push({
        kind,
        target,
        reason: `the plugin "${namespaceOf(target)}" is not installed`,
        grant: evidenceOf(grant, person, grantedAt, undefined),
      })
      continue
    }
    if (read && !entry.sourceIds.has(target)) {
      problems.push({
        kind,
        target,
        reason: `the source "${target}" is not declared by ${entry.installed.package}`,
        grant: evidenceOf(grant, person, grantedAt, entry.installed),
      })
      continue
    }
    if (!read && !entry.actionIds.has(target)) {
      problems.push({
        kind,
        target,
        reason: `the action "${target}" is not declared by ${entry.installed.package}`,
        grant: evidenceOf(grant, person, grantedAt, entry.installed),
      })
      continue
    }
    const key = `${kind}\u0000${target}`
    const held = grants.get(key)
    const evidence = evidenceOf(grant, person, grantedAt, entry.installed)
    if (held === undefined) grants.set(key, [evidence])
    else held.push(evidence)
  }

  const plugins = pending.map((entry): AuditPlugin => ({
    package: entry.installed.package,
    version: entry.installed.version,
    manifestHash: entry.installed.hash,
    access: entry.access,
    methods: entry.methods,
    sources: entry.sources.map((source): AuditSource => {
      const held = grants.get(`read\u0000${source.id}`) ?? []
      return {
        ...source,
        accounts: [...new Set(held.map((grant) => grant.account))].sort(),
        grants: held,
      }
    }),
    actions: entry.actions.map((action): AuditAction => ({
      ...action,
      grants: grants.get(`act\u0000${action.id}`) ?? [],
    })),
  }))
  return { person: input.person, plugins, problems }
}

const scopeSchema = z.record(z.string(), z.array(z.string()))
const grantSchema = z
  .object({
    consumer: z.string(),
    account: z.string(),
    scope: scopeSchema,
    manifestHash: z.string(),
    disabled: z.boolean(),
    stale: z.boolean(),
    person: z.string(),
    grantedAt: z.string(),
  })
  .strict()
const methodSchema = z
  .object({
    method: z.string(),
    class: z.enum(METHOD_CLASSES),
    effect: z.enum(METHOD_EFFECTS).optional(),
    access: z.enum(["runs", "asks first", "off"]),
  })
  .strict()
const costSchema = z
  .object({
    class: z.enum(COST_CLASSES),
    units: z.array(z.object({ per: z.string(), usd: z.number() }).strict()).optional(),
  })
  .strict()
const sourceSchema = z
  .object({
    id: z.string(),
    method: z.string(),
    operations: z.array(z.string()),
    accounts: z.array(z.string()),
    private: z.boolean(),
    cost: costSchema,
    grants: z.array(grantSchema),
  })
  .strict()
const actionSchema = z
  .object({
    id: z.string(),
    preview: z.string(),
    commit: z.string(),
    operations: z.array(z.string()),
    confirmation: z.enum(["required", "none"]),
    grants: z.array(grantSchema),
  })
  .strict()
const pluginSchema = z
  .object({
    package: z.string(),
    version: z.string(),
    manifestHash: z.string(),
    access: z.enum(ACCESS_LEVELS),
    methods: z.array(methodSchema),
    sources: z.array(sourceSchema),
    actions: z.array(actionSchema),
  })
  .strict()
const problemSchema = z
  .object({
    kind: z.enum(["read", "act"]),
    target: z.string(),
    reason: z.string(),
    grant: grantSchema,
  })
  .strict()
const reportSchema = z
  .object({
    person: z.string(),
    plugins: z.array(pluginSchema),
    problems: z.array(problemSchema),
  })
  .strict()

/** The report's schema, published as `dist/schemas/audit.json`. */
export const AUDIT_REPORT_SCHEMA: Validator<AuditReport> = validator("audit", reportSchema)
