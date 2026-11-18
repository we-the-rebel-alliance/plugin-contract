/**
 * The plain types of the §2.2 `sources` descriptor, and its constants. Its one import is the package's own: a
 * published declaration reaches this file, and must reach nothing outside the package (`npm run check:dist`).
 */
import type { FactType } from "../events.ts"

/** `maxBytes`: the default and the ceiling (§2.2). */
export const MAX_BYTES_DEFAULT = 65536
export const MAX_BYTES_LIMIT = 1048576

/**
 * What an act does beyond the person's own machine. `local` does not. The others need a confirmation the host issued
 * before commit.
 */
export const ACT_EFFECTS = ["local", "notify", "spend", "irreversible"] as const

/** An act's effect: `local`, or one that reaches someone, spends, or cannot be undone. */
export type ActEffect = (typeof ACT_EFFECTS)[number]

/** The value of a plugin's top-level `sources` key: the contract version, its sources, and its acts once it declares any. */
export interface Sources {
  readonly contractVersion: 1
  /** The plugin's tools-RPC id (#4, #8): the plugin id and `.tools`. */
  readonly rpc?: string | undefined
  /** The plugin's one probe tool, and the permission action it asserts (#4, #8). */
  readonly probe?: { readonly action: string } | undefined
  readonly items: readonly SourceItem[]
  /**
   * The plugin's acts, beside its sources in the same descriptor. Absent when the plugin declares no write. Additive:
   * a consumer on an older package refuses the key.
   */
  readonly acts?: readonly ActItem[] | undefined
}

/** An events feed or a snapshot. */
export type SourceItem = SourceEvents | SourceSnapshot

/** A source item's fields, whichever kind it is. */
export interface SourceCommon {
  /** The source id, such as `gws.gmail`. Its first segment is the plugin's namespace. */
  readonly id: string
  /** The plugin tool that reads this source. It must be declared `readOnly: true`. */
  readonly tool: string
  /** The input the tool needs to reach this source, such as `{ source: "gmail" }`. */
  readonly input?: Readonly<Record<string, unknown>> | undefined
  /** Which signed-in accounts a source reads. Optional: §2.2's X item names none. */
  readonly accounts?: Accounts | undefined
  /** What a person confirms at consent, and the sentence that asks them. */
  readonly scope?: Scope | undefined
  readonly permission: Permission
  /** True when everything this source reads is personal: shown at consent. */
  readonly private?: boolean | undefined
  readonly cost: Cost
  /** A provider's own floor between reads, only where it imposes one. */
  readonly cadence?: Cadence | undefined
  /** The most bytes one result may take: default 65536, at most 1 MB. */
  readonly maxBytes?: number | undefined
  /** How many days an events consumer keeps what it read. */
  readonly retentionDays?: number | undefined
  /** The hosts an event's `url` may point at, for display. */
  readonly urlHosts?: readonly string[] | undefined
}

/** An events source: append-only items read with a cursor. */
export interface SourceEvents extends SourceCommon {
  readonly kind: "events"
  /** The thing it reads: a core kind such as `message`, or `x-<namespace>/<name>`. */
  readonly reads: string
  /** Reads of one event's detail, called only with the event fields they name. */
  readonly details?: readonly Detail[] | undefined
  /** The fact types this source's events carry (#45 §3), each a core type. */
  readonly facts?: readonly FactType[] | undefined
  /** The hint files the package ships for this source (#45 §4). */
  readonly hints?: readonly string[] | undefined
  /** The routine files the package ships for this source (#45 §5). */
  readonly routines?: readonly string[] | undefined
  /** The action `events_list` asserts. */
  readonly permission: PermissionEvents
  /** Not allowed on an events source. */
  readonly output?: undefined
  /** Not allowed on an events source. */
  readonly maxAgeSec?: undefined
  /** Not allowed on an events source. */
  readonly params?: undefined
}

/**
 * One write a plugin declares. Preview writes nothing. Commit is the write, and a non-local effect needs a confirmation
 * the host issued. The id is `<plugin>.<action>`, the same shape as a source id.
 */
export interface ActItem {
  /** The act id, such as `demo.save`. Its first segment is the plugin's namespace. */
  readonly id: string
  /** JSON Schema (draft 2020-12) for the caller's input. The library adds `account`; the schema does not have to name it. */
  readonly input: Readonly<Record<string, unknown>>
  /** JSON Schema (draft 2020-12) for the answer's `output`. */
  readonly output: Readonly<Record<string, unknown>>
  /** `local`, or an effect that reaches someone, spends, or cannot be undone. */
  readonly effect: ActEffect
  /** The tool that previews the act. It writes nothing, and it is not the commit tool. */
  readonly preview: string
  /** The tool that commits the act. A different tool from `preview`. */
  readonly commit: string
  /** The actions the two tools assert, and the provider operations the act asserts. */
  readonly permission: ActPermission
}

/** An act's grants: a preview action, a commit action, and the operations, derived like a source's. */
export interface ActPermission {
  /** The action the preview tool asserts, in the plugin's namespace. A preview session allows this and not the commit. */
  readonly preview: string
  /** The action the commit tool asserts, in the plugin's namespace, and not the preview's action. */
  readonly commit: string
  /** Every provider operation the act asserts, and nothing else. Derived like a source's `permission.operations`. */
  readonly operations: readonly string[]
}

/** A snapshot source: the latest state, read on demand. */
export interface SourceSnapshot extends SourceCommon {
  readonly kind: "snapshot"
  /** A registry name such as `agenda`, or `x-<namespace>/<name>`. The registry is the app's; this is a name only. */
  readonly output: string
  /** An `x-` output's schema, inline: JSON Schema draft 2020-12. Required for `x-`, absent for a registry name. */
  readonly outputSchema?: Readonly<Record<string, unknown>> | boolean | undefined
  /** The parameters a consumer may pass, resolved by the library at read time. */
  readonly params?: Readonly<Record<string, unknown>> | undefined
  /** The hint files the package ships for this source (#45 §4). */
  readonly hints?: readonly string[] | undefined
  /** The routine files the package ships for this source (#45 §5). */
  readonly routines?: readonly string[] | undefined
  /** The action its read tool asserts. */
  readonly permission: PermissionTool
  /** How long a result may be reused before it is read again. */
  readonly maxAgeSec?: number | undefined
  /** Not allowed on a snapshot. */
  readonly facts?: undefined
  /** Not allowed on a snapshot. */
  readonly reads?: undefined
  /** Not allowed on a snapshot. */
  readonly details?: undefined
}

/** Which signed-in accounts a source reads. */
export interface Accounts {
  /** True when the source reads more than one account, so a read names one. */
  readonly named: boolean
  /** For one MCP server per account (#30, item 9): a named account's server, with `{account}`, such as `plaud-{account}`. */
  readonly server?: string | undefined
}

/** What a person confirms at consent. */
export interface Scope {
  /** The scope keys a person confirms: labels, channels, repositories. Empty when there is nothing to choose. */
  readonly keys: readonly string[]
  /** The sentence shown at consent. */
  readonly describe: string
  /** The read-only tool that lists the values a person may pick, and the operations it asserts at bind. */
  readonly suggest?: Suggest | undefined
}

/**
 * A bind-time read: the values a person may pick for a scope key. It runs only at bind, in the probe session, with its
 * results shown and never stored, so its operations never enter a running grant (§2.2, accepted addition).
 */
export interface Suggest {
  /** The read-only tool that lists the values. */
  readonly tool: string
  /** The operations it asserts, and nothing else. None of them may appear in `permission.operations`. */
  readonly operations: readonly string[]
}

/** One read of an event's detail. */
export interface Detail {
  /** The detail's id, such as `gws.gmail.message`. */
  readonly id: string
  /** The read-only tool that reads it. */
  readonly tool: string
  /** The event fields its input comes from: identifiers, never the event's own prose. */
  readonly from: readonly DetailField[]
}

/** The event fields a detail may take its input from. */
export type DetailField = "external_id" | "kind" | "occurred_at" | "url" | "thread" | "actors" | "labels" | "hash"

/** The actions and operations a source's reads assert. */
export type Permission = PermissionEvents | PermissionTool

/** One declared grant: the action a read asserts, and the resource it asserts it on. */
export interface PermissionRuleLike {
  readonly action: string
  readonly resource: string
}

/** An events source's permission: the `events_list` action, and the provider operations it asserts. */
export interface PermissionEvents {
  /** The action `events_list` asserts, in the plugin's namespace. */
  readonly events: string
  /** Every provider operation the source's reads assert, and nothing else. Absent when `rules` states them. */
  readonly operations?: readonly string[] | undefined
  /** The grants verbatim, for a provider whose resources are not `<account>:<operation>` such as GitHub's `github_api` on `GET /user`. */
  readonly rules?: readonly PermissionRuleLike[] | undefined
  /** For a rules source: the grants `probe` asserts, verbatim, each among `rules` (#30, item 10). Empty when the probe asserts only its action; absent when undeclared. */
  readonly identityRules?: readonly PermissionRuleLike[] | undefined
  /** The identity operations `probe` asserts for this source (#4, #8); each is among permission.operations, and no content read asserts it. Empty when the probe asserts only its action; absent when undeclared. */
  readonly identity?: readonly string[] | undefined
  /** True when the source's content reads assert an identity operation (#30, item 4); every identity operation is still declared. */
  readonly readsIdentity?: boolean | undefined
}

/** A snapshot's permission: the read tool's action, and the provider operations it asserts. */
export interface PermissionTool {
  /** The action the read tool asserts, in the plugin's namespace. */
  readonly tool: string
  /** Every provider operation the source's reads assert, and nothing else. Absent when `rules` states them. */
  readonly operations?: readonly string[] | undefined
  /** The grants verbatim, when the provider's resources are not `<account>:<operation>`. */
  readonly rules?: readonly PermissionRuleLike[] | undefined
  /** For a rules source: the grants `probe` asserts, verbatim, each among `rules` (#30, item 10). Empty when the probe asserts only its action; absent when undeclared. */
  readonly identityRules?: readonly PermissionRuleLike[] | undefined
  /** The identity operations `probe` asserts for this source (#4, #8); each is among permission.operations, and no content read asserts it. Empty when the probe asserts only its action; absent when undeclared. */
  readonly identity?: readonly string[] | undefined
  /** True when the source's content reads assert an identity operation (#30, item 4); every identity operation is still declared. */
  readonly readsIdentity?: boolean | undefined
}

/** What one read costs: `free` charges nothing, `metered` charges per unit, `billed` charges per call. */
export type Cost = CostFree | CostMetered | CostBilled

/** A source that charges nothing. */
export interface CostFree {
  readonly class: "free"
  readonly units?: undefined
  readonly probe?: undefined
}

/** A source charged per unit, whose probe may be charged too. */
export interface CostMetered {
  readonly class: "metered"
  /** The price units the provider charges. */
  readonly units: readonly Price[]
  /** The price of a probe call, which reads no content. */
  readonly probe?: Price | undefined
}

/** A source charged on every call, whose probe is charged too. */
export interface CostBilled {
  readonly class: "billed"
  /** The price units the provider charges. */
  readonly units: readonly Price[]
  /** The price of a probe call, which reads no content. */
  readonly probe: Price
}

/** One price unit, from the plugin's own price table. */
export interface Price {
  /** What one unit is: `post`, `author`, `call`. */
  readonly per: string
  /** The price of one unit, in US dollars. */
  readonly usd: number
  /** The short sentence shown at consent when this price applies, such as X app owners only. */
  readonly conditions?: string | undefined
  /** The lowest rate that may apply, in US dollars: at most `usd`. */
  readonly min?: number | undefined
}

/** A provider's own floor between reads. */
export interface Cadence {
  /** The provider's minimum interval between reads, in minutes. */
  readonly providerMinMinutes?: number | undefined
}

