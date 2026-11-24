/**
 * The plain types and constants of the v0 manifest: the one top-level `capabilities` key of a plugin's
 * `package.json` (contract §4).
 *
 * A manifest declares what a plugin can do, never where an app should put it. Everything here is JSON: the types
 * below are the value after validation, and nothing in this file imports a host, a schema library or another module.
 */

/** The manifest's wire version. Independent of the package's semver (contract §4). */
export const MANIFEST_VERSION = 1 as const

/** The OpenCode range a v0 manifest declares (D7). A plugin outside it refuses to start with `HOST_UNTESTED`. */
export const OPENCODE_RANGE = ">=2.4.1 <2.5.0" as const

/** The release the v0 contract is built and tested against (D7). */
export const TESTED_OPENCODE = "2.4.1" as const

/** A plugin's name: 2–31 lowercase letters or digits, no hyphen, which separates an account alias (§3). */
export const PLUGIN_NAME = /^[a-z0-9]{2,31}$/

/** An app-only key: `x-<app>`, lowercase, ignored by every other app. */
export const EXTENSION_KEY = /^x-[a-z][a-z0-9-]*$/

/** The classes a method may have (§6). */
export const METHOD_CLASSES = ["read", "write", "send", "share", "delete", "export", "admin"] as const
export type MethodClass = (typeof METHOD_CLASSES)[number]

/** Whether a method takes an `account` (§6). */
export const METHOD_ACCOUNTS = ["optional", "none"] as const
export type MethodAccounts = (typeof METHOD_ACCOUNTS)[number]

/** A method's optional override of the access setting (§6). */
export const METHOD_EFFECTS = ["allow", "ask", "deny"] as const
export type MethodEffect = (typeof METHOD_EFFECTS)[number]

/** How a plugin signs in to its accounts (§5). */
export const ACCOUNT_MECHANISMS = ["integration", "mcp", "local"] as const
export type AccountMechanism = (typeof ACCOUNT_MECHANISMS)[number]

/** A source reads an events feed or the latest state (§7). */
export const SOURCE_KINDS = ["events", "snapshot"] as const
export type SourceKind = (typeof SOURCE_KINDS)[number]

/** How a source can nudge a consumer (§7). */
export const SOURCE_SIGNALS = ["bus", "mcp-events", "webhook"] as const
export type SourceSignal = (typeof SOURCE_SIGNALS)[number]

/** What a read costs (§7). */
export const COST_CLASSES = ["free", "metered", "billed"] as const
export type CostClass = (typeof COST_CLASSES)[number]

/** What an action does beyond the person's own machine (§8). */
export const ACTION_EFFECTS = ["local", "notify", "spend", "irreversible"] as const
export type ActionEffect = (typeof ACTION_EFFECTS)[number]

/** The bus events a manifest may declare (§10). */
export const BUS_EVENTS = ["changed", "status", "account"] as const
export type BusEvent = (typeof BUS_EVENTS)[number]

/** The most bytes a source may declare for one answer (1 MB), and the default when it declares none (64 KB). */
export const MAX_BYTES_LIMIT = 1_048_576
export const MAX_BYTES_DEFAULT = 65_536

/** A source's `service` (#44 item 1): the most characters its id and its label may take. */
export const SERVICE_ID_MAX = 128
export const SERVICE_LABEL_MAX = 64

/** A probe owner's organizations (#44 item 2): at most five. */
export const OWNER_ORGS_LIMIT = 5

/** The most characters a thumbnail URL may take (#42), the limit of `url` and the registry's `image.url`. */
export const THUMBNAIL_URL_MAX = 2_048

/** A JSON Schema object, as a manifest carries one. The package does not generate or rewrite it. */
export type JsonSchema = Readonly<Record<string, unknown>>

/** A vendor: who makes the provider a plugin talks to. */
export interface Vendor {
  /** A stable lowercase id, such as `google`. */
  readonly id: string
  /** The name a person sees, such as `Google`. */
  readonly name: string
  /** The vendor's main domain, such as `google.com`. No scheme, no path. */
  readonly domain: string
}

/** One icon the package ships. */
export interface Icon {
  /** A path inside the installed package, such as `assets/icon.svg`. */
  readonly src: string
  /** The image's MIME type, such as `image/svg+xml`. */
  readonly type: string
}

/** The OpenCode range and the releases the plugin was tested on (§4, D7). */
export interface HostRange {
  /** Exactly `>=2.4.1 <2.5.0` in v0. */
  readonly opencode: typeof OPENCODE_RANGE
  /** The releases CI ran. It includes `2.4.1`. */
  readonly tested: readonly string[]
}

/** A plugin's identity (§3, §4). */
export interface PluginInfo {
  /** The one name everything derives from: 2–31 lowercase letters or digits, no hyphen. */
  readonly name: string
  /** The name a person sees, such as `Google Workspace`. */
  readonly title: string
  /** One sentence on what the plugin does. */
  readonly summary: string
  readonly vendor: Vendor
  /** At least one icon; a consumer picks the size it needs. */
  readonly icons: readonly Icon[]
  readonly host: HostRange
}

/** How accounts work for a plugin that signs in (§5). */
export interface AccountsInfo {
  /** Where the credentials live. */
  readonly via: AccountMechanism
  /** A JSON-Schema `$ref` to the profile schema in `options` (§5). */
  readonly profile?: { readonly $ref: string } | undefined
  /** The scheme a probe's owner id uses, such as `mailto`. */
  readonly owner: string
}

/** One callable: a contract method, a plugin tool, or a pass-through MCP tool (§6). */
export interface MethodItem {
  /** What the method does: `read`, `write`, `send`, `share`, `delete`, `export` or `admin`. */
  readonly class: MethodClass
  /** `optional` when it takes an `account`, `none` when it does not. Defaults to `none`. */
  readonly accounts?: MethodAccounts | undefined
  /** The provider operations it may assert, for grants and session rules. */
  readonly operations?: readonly string[] | undefined
  /** True for a method that dry-runs a change and answers `{ planId, method }`. */
  readonly plans?: true | undefined
  /** The planning method this method commits: it then takes only `{ planId }`. */
  readonly commits?: string | undefined
  /** An override of the `access` setting. */
  readonly effect?: MethodEffect | undefined
  /** `false` leaves the method out of agent prompts; it stays in Code Mode, automations and RPC. */
  readonly agent?: false | undefined
  /** True for the one method Code Mode may send on every turn. None by default, at most one. */
  readonly pinned?: true | undefined
}

/** The outside system a source belongs to (#44 item 1). Sources with the same `id` are one service. */
export interface Service {
  /** At most 128 characters, such as `gws.gmail`. */
  readonly id: string
  /** At most 64 characters, such as `Gmail`. Every source of one service uses the same label. */
  readonly label: string
}

/** A bind-time read that lists the values a person may pick for a scope key. */
export interface Suggest {
  /** The declared read-only method that lists the values. */
  readonly method: string
  /** The provider operations it asserts, and nothing else. */
  readonly operations?: readonly string[] | undefined
}

/** What a person confirms at consent. */
export interface Scope {
  /** The keys a person confirms: labels, channels, repositories. */
  readonly keys: readonly string[]
  /** The sentence shown at consent. */
  readonly describe: string
  /** The read that lists the values a person may pick for a key. */
  readonly suggest?: Suggest | undefined
}

/** One price unit, from the plugin's own price table. */
export interface Price {
  /** What one unit is, such as `post` or `call`. */
  readonly per: string
  /** The price of one unit, in US dollars. */
  readonly usd: number
}

/** What one read costs. */
export interface Cost {
  readonly class: CostClass
  /** The price units. A billed source states them; a free source states none. */
  readonly units?: readonly Price[] | undefined
}

/** A provider's own floor and a suggested cadence, in minutes. */
export interface Cadence {
  readonly providerMinMinutes?: number | undefined
  readonly suggestMinutes?: number | undefined
}

/** The event fields a detail read may take its input from: identifiers and metadata, never `title` or `text`. */
export const DETAIL_FIELDS = ["external_id", "kind", "occurred_at", "url", "thread", "actors", "labels", "hash"] as const
export type DetailField = (typeof DETAIL_FIELDS)[number]

/** One follow-up read of an event's detail. */
export interface Detail {
  /** The detail's id, such as `gws.gmail.message`. */
  readonly id: string
  /** The declared method that reads it. */
  readonly method: string
  /** The event fields its input comes from. */
  readonly from: readonly DetailField[]
}

/** A source item's fields, whichever kind it is (§7). */
export interface SourceCommon {
  /** `<name>.<capability>`, such as `gws.gmail`. */
  readonly id: string
  /** The declared method that reads this source. */
  readonly method: string
  /** The fixed input that selects this source, such as `{ source: "gmail" }`. */
  readonly input?: Readonly<Record<string, unknown>> | undefined
  /** The outside system this source belongs to; absent means the plugin is one service named after it. */
  readonly service?: Service | undefined
  /** The provider operations this source's reads assert. */
  readonly operations?: readonly string[] | undefined
  /** What a person confirms at consent. */
  readonly scope?: Scope | undefined
  /** The provider's floor, and a suggested cadence. */
  readonly cadence?: Cadence | undefined
  /** How the source can nudge a consumer. */
  readonly signals?: readonly SourceSignal[] | undefined
  /** True when everything the source reads is personal. Shown at consent. */
  readonly private?: boolean | undefined
  /** What one read costs. */
  readonly cost: Cost
  /** The most bytes one answer may take: default 64 KB, at most 1 MB. */
  readonly maxBytes?: number | undefined
  /** The follow-up reads of one event's detail. */
  readonly details?: readonly Detail[] | undefined
  /** The fact types this source's events carry. */
  readonly facts?: readonly string[] | undefined
  /** The hint files the package ships for this source, relative paths ending in `.md`. */
  readonly hints?: readonly string[] | undefined
  /** The hosts an event's `url` and `thumbnail` may point at. */
  readonly urlHosts?: readonly string[] | undefined
}

/** An events source: append-only items read with a cursor. */
export interface SourceEvents extends SourceCommon {
  readonly kind: "events"
  /** The thing it reads: a core kind such as `message`, or `x-<namespace>/<name>`. */
  readonly reads: string
  /** True when the source can answer an event's `thumbnail` (#42). Requires `urlHosts`. */
  readonly thumbnails?: true | undefined
  /** Not allowed on an events source. */
  readonly output?: undefined
}

/** A snapshot source: the latest state, read on demand. */
export interface SourceSnapshot extends SourceCommon {
  readonly kind: "snapshot"
  /** A registry output name such as `agenda`, or `x-<namespace>/<name>`. */
  readonly output: string
  /** Not allowed on a snapshot. */
  readonly reads?: undefined
  /** Not allowed on a snapshot. */
  readonly thumbnails?: undefined
}

/** One source a plugin declares. */
export type SourceItem = SourceEvents | SourceSnapshot

/** One write an app can offer a person (§8). */
export interface ActionItem {
  /** `<name>.<action>`, such as `gws.gmail.send`. */
  readonly id: string
  /** `local`, or an effect that reaches someone, spends, or cannot be undone. */
  readonly effect: ActionEffect
  /** The declared method that previews the action. It writes nothing, and it is not the commit. */
  readonly preview: string
  /** The declared method that commits the action. */
  readonly commit: string
  /** JSON Schema 2020-12 for the caller's input. */
  readonly input: JsonSchema
  /** JSON Schema 2020-12 for the answer's `output`. */
  readonly output: JsonSchema
}

/** The bus events a plugin emits (§10). Each is declared with an empty object. */
export interface ManifestEvents {
  readonly changed?: Readonly<Record<string, never>> | undefined
  readonly status?: Readonly<Record<string, never>> | undefined
  readonly account?: Readonly<Record<string, never>> | undefined
}

/** The one top-level `capabilities` key of a plugin's `package.json` (§4). */
export interface Manifest {
  readonly version: typeof MANIFEST_VERSION
  readonly plugin: PluginInfo
  /** How accounts work. Absent: the plugin signs in to nothing. */
  readonly accounts?: AccountsInfo | undefined
  /** JSON Schema 2020-12 of the plugin's options. It must include `access`. */
  readonly options: JsonSchema
  /** Every callable, including pass-through MCP tools (`mcp:<tool>` or `mcp:*`). */
  readonly methods: Readonly<Record<string, MethodItem>>
  readonly sources: readonly SourceItem[]
  readonly actions: readonly ActionItem[]
  /** The bus events the plugin emits. */
  readonly events: ManifestEvents
  /** App-only hints. Never required, never read by another app. */
  readonly [extension: `x-${string}`]: unknown
}

/** A manifest read from an installed package on disk, with its hash. */
export interface InstalledManifest {
  /** The package's name, from the same package.json. */
  readonly package: string
  /** The package's version, from the same package.json. */
  readonly version: string
  /** The package's directory on disk. */
  readonly directory: string
  /** The validated `capabilities` value. */
  readonly manifest: Manifest
  /** `sha256:` and the hex digest of the canonical JSON of `capabilities`. */
  readonly hash: string
}

/** A probe owner: whose an account is, as the provider says. */
export interface Owner {
  /** A scheme-qualified id, such as `mailto:ana@example.com` or `slack:U0123`. */
  readonly id: string
  /** The name a person sees. */
  readonly label: string
  /** `false` when the provider does not confirm the owner. It covers `orgs` too. */
  readonly verified?: false | undefined
  /** The organizations the provider says the account belongs to (#44 item 2), at most five. */
  readonly orgs?: readonly OwnerOrg[] | undefined
}

/** One organization an account belongs to. */
export interface OwnerOrg {
  /** A scheme-qualified id, such as `domain:example.com` or `slack-team:T0123`. */
  readonly id: string
  /** The name a person sees. */
  readonly label: string
}
