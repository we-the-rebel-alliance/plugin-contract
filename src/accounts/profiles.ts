/**
 * Profiles and the set of accounts a plugin has (contract §5).
 *
 * `options.accounts` is a map of alias to profile. The profile's schema is the plugin's own: the JSON Schema under
 * `options.properties.accounts.additionalProperties`, which the manifest's `accounts.profile` names with a `$ref`.
 * With no `accounts` option there is exactly one `default` account.
 *
 * A plugin that declares no `accounts` in its manifest signs in to nothing: its account set is empty.
 */
import { hostname, userInfo } from "node:os"
import * as z from "zod"
import type { Checked } from "../internal/checked.ts"
import type { AccountMechanism, Manifest } from "../manifest/types.ts"
import { DEFAULT_ALIAS, aliasProblem, isAlias } from "./alias.ts"

/** One account: an alias, its profile, and, for a local account, the machine identity. */
export interface AccountProfile {
  readonly alias: string
  /** The profile the person filled in, checked against the plugin's profile schema. */
  readonly profile?: Readonly<Record<string, unknown>> | undefined
  /** For `local`: `os-user:<user>@<host>`. */
  readonly identity?: string | undefined
}

/** The accounts one plugin has, and how it signs in to them. */
export interface AccountsPlan {
  readonly plugin: string
  /** `integration`, `mcp`, `local`, or undefined when the plugin declares no accounts. */
  readonly mechanism: AccountMechanism | undefined
  /** In the order the options name them, or one `default` account. Empty when the plugin signs in to nothing. */
  readonly accounts: readonly AccountProfile[]
}

const plain = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** The identity of a local account: `os-user:<user>@<host>`. */
export function localIdentity(identity: { readonly user?: string; readonly host?: string } = {}): string {
  const user = identity.user ?? safeUser()
  const host = identity.host ?? safeHost()
  return `os-user:${user}@${host}`
}

function safeUser(): string {
  try {
    const user = userInfo().username
    if (user) return user
  } catch {
    // fall through
  }
  return process.env["USER"] ?? "unknown"
}

function safeHost(): string {
  try {
    const host = hostname()
    if (host) return host
  } catch {
    // fall through
  }
  return "unknown"
}

/** The profile schema of a manifest: `options.properties.accounts.additionalProperties`. */
function profileSchema(manifest: Manifest): Record<string, unknown> | undefined {
  const properties = manifest.options["properties"]
  if (!plain(properties)) return undefined
  const accounts = properties["accounts"]
  if (!plain(accounts)) return undefined
  const additional = accounts["additionalProperties"]
  return plain(additional) || typeof additional === "boolean" ? (additional as Record<string, unknown>) : undefined
}

/** The profile's problems against the plugin's schema, with the options path. */
function profileProblems(schema: unknown, profile: Readonly<Record<string, unknown>>, alias: string): string[] {
  if (schema === undefined) return [`options.accounts.${alias}: the manifest declares no profile schema`]
  let validator: z.ZodType
  try {
    validator = z.fromJSONSchema(schema as never)
  } catch {
    return [`options.accounts.${alias}: the manifest's profile schema is not a JSON Schema this package can check`]
  }
  const result = validator.safeParse(profile)
  if (result.success) return []
  return result.error.issues.flatMap((issue) => {
    if (issue.code === "unrecognized_keys") {
      return issue.keys.map((key) => `options.accounts.${alias}.${[...issue.path, key].join(".")}: is not a profile field the plugin declares`)
    }
    return [`options.accounts.${alias}${issue.path.length === 0 ? "" : `.${issue.path.join(".")}`}: ${issue.message}`]
  })
}

/**
 * The accounts the plugin has under `options`. Never throws: a bad `accounts` option is a problem, one sentence each,
 * and the rest of the options are ignored.
 */
export function accountsOf(manifest: Manifest, options: Readonly<Record<string, unknown>> = {}): Checked<AccountsPlan> {
  const declared = manifest.accounts
  if (declared === undefined) return { ok: true, value: { plugin: manifest.plugin.name, mechanism: undefined, accounts: [] } }
  const problems: string[] = []
  const raw = options["accounts"]
  if (raw !== undefined && !plain(raw)) return { ok: false, problems: ["options.accounts: must be a map of alias to profile"] }
  const entries = raw === undefined ? [] : Object.entries(raw)
  if (declared.via === "local" && entries.some(([alias]) => alias !== DEFAULT_ALIAS)) {
    problems.push("options.accounts: a local plugin has one account, named default")
  }
  const profiles: AccountProfile[] = []
  if (entries.length === 0) {
    profiles.push({ alias: DEFAULT_ALIAS, ...(declared.via === "local" ? { identity: localIdentity() } : {}) })
  } else {
    const schema = profileSchema(manifest)
    for (const [alias, value] of entries) {
      const bad = aliasProblem(alias, `options.accounts.${alias}`)
      if (bad !== undefined) {
        problems.push(bad)
        continue
      }
      if (!plain(value)) {
        problems.push(`options.accounts.${alias}: must be an object`)
        continue
      }
      problems.push(...profileProblems(schema, value, alias))
      profiles.push({ alias, profile: value, ...(declared.via === "local" ? { identity: localIdentity() } : {}) })
    }
  }
  return problems.length === 0 ? { ok: true, value: { plugin: manifest.plugin.name, mechanism: declared.via, accounts: profiles } } : { ok: false, problems }
}

/** True when `alias` is one of the plan's accounts. */
export function hasAccount(plan: Pick<AccountsPlan, "accounts">, alias: unknown): boolean {
  return isAlias(alias) && plan.accounts.some((account) => account.alias === alias)
}
