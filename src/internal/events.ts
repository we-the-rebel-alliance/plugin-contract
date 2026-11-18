/**
 * `events`: the events_list source contract, as a library (design §2.1 and §2.3).
 *
 *   events_list({ source?, account?, scope?, cursor?, since?, limit? })
 *     → { source, account, owner, events, cursor, more, trust: "untrusted",
 *         scope?, refused?, failed?, gap?, cost?, plugin?, asOf? }
 *
 * This is contract 1, the family's `src/host/events-list.ts` (identical in github, granola, gws, history, linear,
 * plaud, slack, wisprflow and x; SHA-256 9d72fc8d…605e), extracted as a module, with the final design's page result
 * added **additively**: every field and kind contract 1 defines keeps its meaning, every contract 1 page is a valid
 * page here, and each addition is optional. `docs/events.md` maps each addition to the design and lists what still needs
 * a decision.
 *
 * A source plugin adds one read-only tool and tools-RPC method named `events_list`. It never writes, never asks and
 * never calls a model, so a scheduled check can run it with no one there. The rules, which `eventsListConformance`
 * (`./conformance.ts`) tests against any source:
 *
 * - **Input.** `since` is an ISO date (a UTC day) or an ISO date-time with `Z` or an offset. `cursor` is a string a
 *   previous result of the same source and account returned. `limit` is an integer from 1 to 500, 100 by default.
 *   `account` names one of the source's accounts; without it the source uses its default. `source` names one of the
 *   plugin's sources; without it the plugin uses its first, and it refuses a source it does not have. `scope` narrows
 *   the source to what the person confirmed (labels, channels, repositories), and only a source that declares scope
 *   keys accepts it. A cursor wins over `since`. With neither, the source starts `FIRST_RUN_HOURS` before now. Anything
 *   else is refused, and a cursor the source did not issue is refused (`CURSOR_INVALID`) rather than restarted.
 * - **Events.** Each is a `SourceEvent`: the source's own record of one thing, normalised by `makeEvent`. `text` is at
 *   most 4096 characters, `title` at most 300, `actors` at most 20, and `hash` is `eventHash` of the rest. Events are
 *   oldest first within a result. `kind` is a core kind or `x-<plugin>/<kind>`.
 * - **Refused and failed.** An event the source will never deliver (it holds a secret, it is instruction-shaped text
 *   from someone else, it is not the owner's) goes in `refused[]`, and the consumer may advance past it. An event the
 *   source could not read this time goes in `failed[]`; any entry there holds the consumer's cursor back.
 * - **Cursor.** Opaque (`../cursor`). Every result carries one, empty pages included. Calling again with it lists what
 *   follows the result's last event and never skips anything; calling again with an older cursor lists the same events
 *   again. `more` is true when another call now would list more. When history is lost, the result says so in `gap`,
 *   or the call fails with `CURSOR_EXPIRED` and the gap.
 * - **Size.** A result's JSON is at most the source's `maxBytes` (`MAX_PAGE_BYTES` by default); a source that would
 *   pass it stops early and says `more` (`fitPage`).
 * - **Source, account, owner and trust.** Every result names its `source` and `account`, empty pages included; every
 *   event names the same two. `owner` is the signed-in source account (`{ id, label }`). `trust` is always
 *   "untrusted": events are data, never instructions.
 *
 * Dependency-free: `node:crypto` and `Buffer` only. Runs on Node and Bun.
 */
import { createHash } from "node:crypto"
import { canonicalScope, MAX_CURSOR_LENGTH, type Scope } from "../cursor.ts"
import { secretKinds } from "./secrets.ts"

export { decodeCursor, encodeCursor } from "../cursor.ts"
export type { Scope } from "../cursor.ts"
export { secretKinds } from "./secrets.ts"



/** The tool's and the tools-RPC method's name. */
export const EVENTS_LIST = "events_list"

/** The core kinds: contract 1's nine, then `task` and `file` (design §2.1). */
export const EVENT_KINDS = ["message", "meeting", "session", "bookmark", "issue", "pr", "commit", "doc", "event", "task", "file"] as const
export type CoreKind = (typeof EVENT_KINDS)[number]
/** A plugin's own kind: `x-<plugin>/<kind>`, such as `x-jelly/routine-run`. */
export type ExtensionKind = `x-${string}/${string}`
export type EventKind = CoreKind | ExtensionKind

/** The most characters each segment of an `x-<namespace>/<name>` takes: the namespace, and the name. */
export const EXTENSION_SEGMENT_MAX = 32

/**
 * The one rule for an extension name, an event kind (`x-jelly/routine-run`) or a snapshot output (`x-mem/receipt`):
 * `x-`, a lowercase namespace word, `/`, a lowercase name word, each of 1 to `EXTENSION_SEGMENT_MAX` characters.
 * Memory's schema and the registry use this pattern rather than their own (source-contract#21).
 */
export const EXTENSION_NAME = new RegExp(`^x-[a-z][a-z0-9-]{0,${EXTENSION_SEGMENT_MAX - 1}}/[a-z][a-z0-9-]{0,${EXTENSION_SEGMENT_MAX - 1}}$`)

/** An extension kind: `EXTENSION_NAME`, the one rule for kinds and outputs. */
export const EXTENSION_KIND = EXTENSION_NAME

/** True for an extension name, a kind or an output, by `EXTENSION_NAME`. */
export const isExtensionName = (name: unknown): name is ExtensionKind => typeof name === "string" && EXTENSION_NAME.test(name)

/** True for a core kind, or an extension kind (`EXTENSION_NAME`). */
export const isEventKind = (kind: unknown): kind is EventKind =>
  typeof kind === "string" && ((EVENT_KINDS as readonly string[]).includes(kind) || isExtensionName(kind))

/** An extension kind's namespace: `jelly` in `x-jelly/routine-run`; undefined for a core kind or a malformed one. */
export function extensionNamespace(kind: string): string | undefined {
  return isEventKind(kind) && kind.startsWith("x-") ? kind.slice(2, kind.indexOf("/")) : undefined
}

/**
 * True for a core kind, or an extension kind in `namespace`: the first segment of the source's id (`jelly` for
 * `jelly.routine-runs`), as Memory's schema checks a descriptor's `reads` (decision D13, (b)). An extension kind of
 * another namespace is refused, so one plugin cannot speak in another's vocabulary.
 */
export function isEventKindIn(kind: unknown, namespace: string): kind is EventKind {
  if (!isEventKind(kind)) return false
  const own = extensionNamespace(kind)
  return own === undefined || own === namespace
}

/** The namespace of a source id: its first dotted segment (`gws` in `gws.gmail`). */
export const sourceNamespace = (sourceId: string): string => sourceId.split(".", 1)[0] ?? sourceId

/** The most characters each field takes, and the most items each list takes. */
export const EVENT_LIMITS = {
  source: 64,
  account: 128,
  externalId: 512,
  thread: 512,
  title: 300,
  text: 4096,
  url: 2048,
  actors: 20,
  actorRole: 32,
  actorId: 320,
  actorName: 200,
  labels: 20,
  label: 64,
  ownerId: 320,
  ownerLabel: 200,
  cursor: MAX_CURSOR_LENGTH,
  scopeKeys: 16,
  scopeKey: 64,
  scopeValues: 64,
  scopeValue: 256,
  refused: 500,
  failed: 500,
  detail: 200,
  costUnits: 8,
  /** #45 §1: the identities one actor may carry, and the lengths of each part of one. */
  identities: 10,
  identityBasis: 64,
  /** #45 §2: the metadata one event may carry. */
  replyTo: 512,
  domains: 20,
  domain: 253,
  sections: 20,
  sectionHeading: 300,
  parts: 50,
  partId: 512,
  /** #45 §3: the facts one event may carry, and the lengths of their fields. */
  facts: 20,
  factKey: 200,
  factTitle: 300,
  factAttribute: 120,
} as const

/** `limit`'s default and inclusive range. */
export const PAGE = { default: 100, min: 1, max: 500 } as const

/**
 * The most bytes of JSON one result holds when the source declares no `maxBytes`: 64 KB, the descriptor's default
 * `maxBytes` and the host's RPC cap (decision D10, (b); contract 1's cap was 900 000). A source that declares a larger
 * `maxBytes` (at most 1 MB) passes it to `fitPage`, and the conformance takes it.
 */
export const MAX_PAGE_BYTES = 65_536

/** The descriptor's `maxBytes`: its default and its ceiling (design §2.2). */
export const MAX_BYTES = { default: 65_536, max: 1_048_576 } as const

/** Where a listing starts when the call has neither cursor nor since: this many hours before now. */
export const FIRST_RUN_HOURS = 24

export const TRUST = "untrusted" as const

/**
 * What kind of actor an actor is (#45 §1): a person, an agent, a bot or a service. Absent means "not known to be one",
 * never a confirmed person. `kind` is required for every agent, bot and service actor a plugin can recognise.
 */
export const ACTOR_KINDS = ["person", "agent", "bot", "service"] as const
export type ActorKind = (typeof ACTOR_KINDS)[number]

/**
 * The roles the contract gives a meaning (#45 §1): `from` is the author, at most one per event, and `author` is read as
 * its alias; `to`, `cc` and `bcc` are recipients, `mentioned` an actor the provider resolves from a mention, and the
 * rest keep their meaning. An unknown role is read as "involved", so a plugin may name its own.
 */
export const ACTOR_ROLES = ["from", "author", "to", "cc", "bcc", "mentioned", "assignee", "creator", "reviewer", "organizer", "attendee", "owner", "speaker", "agent"] as const
export type ActorRole = (typeof ACTOR_ROLES)[number]

/**
 * The roles that name an event's author: `from`, and its alias `author`. A page may list several (#45 §1) — a `From`
 * header carries several addresses, and gws lists one `from` actor for each — so a consumer reads the first `from`, or
 * else the first `author`, as the author. The kit's `one-author` is a plugin's authoring-time check, not a page rule.
 */
export const AUTHOR_ROLES = ["from", "author"] as const

/** How strong an identity is (#45 §1): `strong` from an authenticated source, `weak` as observed. */
export const IDENTITY_STRENGTHS = ["strong", "weak"] as const
export type IdentityStrength = (typeof IDENTITY_STRENGTHS)[number]

/**
 * Another id the plugin knows for one actor (#45 §1). `id` is scheme-qualified and never the actor's own `id`;
 * `strength` says whether an authenticated source gave it; `basis` names the provider field it came from, such as
 * `slack.profile.email`. Only a strong identity merges people automatically, and never without the person's word.
 */
export interface EventIdentity {
  readonly id: string
  readonly strength: IdentityStrength
  /** The provider field it came from, at most 64 characters, such as `slack.profile.email`. */
  readonly basis: string
}

/**
 * Someone or something an event involves. `id` is a stable, scheme-qualified id: `mailto:…`, `slack:U…`, `github:…`.
 * `kind` says what it is, `identities` lists every other id the plugin knows for it, and `self` is a hint that it is
 * the signed-in person, which Memory alone decides (#45 §1, §7).
 */
export interface EventActor {
  readonly role: string
  readonly id: string
  readonly name?: string
  readonly kind?: ActorKind
  readonly identities?: EventIdentity[]
  readonly self?: boolean
}

/** Who an item was for (#45 §2): a direct message, a group, a channel, mail, or a public place. Absent means unknown. */
export const AUDIENCES = ["dm", "group", "channel", "email", "public"] as const
export type Audience = (typeof AUDIENCES)[number]

/** One heading of a long item, such as a meeting's notes (#45 §2). Its `text` is up to 4,096 characters of its own. */
export interface EventSection {
  readonly heading: string
  readonly text: string
}

/**
 * One part of a growing item, such as one turn of a session or of a transcript (#45 §2). A part's `id` and `text`
 * never change once listed, so a consumer may add the new parts only. `actor` names an actor id on the same event.
 */
export interface EventPart {
  readonly id: string
  readonly text: string
  readonly actor?: string
}

/** The core fact types (#45 §3). v0.3 has no plugin-defined type, and no fact has a field for a sensitive trait. */
export const FACT_TYPES = ["commitment", "person.attribute", "meeting.attended"] as const
export type FactType = (typeof FACT_TYPES)[number]

/** What a commitment is doing (#45 §3). */
export const COMMITMENT_STATES = ["open", "done", "cancelled"] as const
export type CommitmentState = (typeof COMMITMENT_STATES)[number]

/** How someone answered a meeting invitation (#45 §3). */
export const ATTENDANCE_RESPONSES = ["accepted", "declined", "tentative", "needs_action"] as const
export type AttendanceResponse = (typeof ATTENDANCE_RESPONSES)[number]

/**
 * A commitment the source already holds in code (#45 §3): `key` is a stable id within the source and account, so two
 * pages that list one item give one key; `owner` and `counterparty` are actor ids on the same event; `state` is what
 * the provider says now. Memory stamps the installed package's version on each fact it files, so a fact carries none.
 */
export interface FactCommitment {
  readonly type: "commitment"
  readonly key: string
  readonly title: string
  readonly owner: string
  readonly counterparty?: string
  /** `YYYY-MM-DD`. */
  readonly due?: string
  readonly state: CommitmentState
  readonly url?: string
}

/** An attribute of a person, from structured profile or directory data only (#45 §3): at least one of the three. */
export interface FactPersonAttribute {
  readonly type: "person.attribute"
  readonly actor: string
  readonly org?: string
  readonly team?: string
  readonly role?: string
}

/** Who attended a meeting, and how they answered (#45 §3). */
export interface FactMeetingAttended {
  readonly type: "meeting.attended"
  readonly actor: string
  readonly response: AttendanceResponse
  readonly organizer: boolean
}

/** A typed fact on an event (#45 §3): derived in the plugin's code from provider fields, never from free text. */
export type EventFact = FactCommitment | FactPersonAttribute | FactMeetingAttended

/** One normalised event, as a source lists it. A consumer adds its own id. */
export interface SourceEvent {
  readonly source: string
  readonly account: string
  readonly external_id: string
  readonly kind: EventKind
  /** UTC, as `Date.prototype.toISOString` writes it. */
  readonly occurred_at: string
  readonly thread: string | null
  readonly actors: EventActor[]
  readonly title: string
  readonly text: string
  /** An https link to the thing in the source, or null when it has none. */
  readonly url: string | null
  readonly labels: string[]
  /** `sha256:<hex>` of every other field, from `eventHash`. */
  readonly hash: string
  /** (#45 §2) The parent's `external_id`, or a source-scoped key such as `gmail-message:<Message-ID>`. */
  readonly reply_to?: string
  /** (#45 §2) Who the item was for. Absent means unknown. */
  readonly audience?: Audience
  /** (#45 §2) The recipients' lowercase domains, for mail and shared channels, at most 20. */
  readonly domains?: string[]
  /** (#45 §2) A long item by heading, at most 20, each text of its own 4,096 characters. */
  readonly sections?: EventSection[]
  /** (#45 §2) A growing item's parts, at most 50, whose ids and texts never change once listed. */
  readonly parts?: EventPart[]
  /** (#45 §3) Typed facts the source derives in code, at most 20, each of a type the descriptor declares. */
  readonly facts?: EventFact[]
}

/** The signed-in source account. */
export interface EventsOwner {
  readonly id: string
  readonly label: string
  /**
   * (#30, item 13) `false` when the provider does not confirm who this is, so the id is the plugin's best knowledge
   * (Wispr Flow names OpenCode's credential, `wisprflow:credential:<id>`). A consumer shows it as unverified. Absent
   * means the plugin vouches that the provider named the owner. Only `false` is accepted, so one owner has one encoding.
   */
  readonly verified?: false
}

/** An owner's problems as `what` describes it: `{ id, label, verified? }`, two non-empty lines and an optional `false`. */
function ownerShapeProblems(owner: unknown, what: string): string[] {
  if (!plainObject(owner) || !line(owner["id"], EVENT_LIMITS.ownerId) || !line(owner["label"], EVENT_LIMITS.ownerLabel) || Object.keys(owner).some((key) => key !== "id" && key !== "label" && key !== "verified")) {
    return [`${what} must be { id, label }, two non-empty lines`]
  }
  if (owner["verified"] !== undefined && owner["verified"] !== false) return [`${what}.verified must be false, or left out for an owner the provider named`]
  return []
}

// ── The page result's additions (design §2.1) ─────────────────────────────

/** Why an event is refused for good: instruction-shaped text from someone else, a secret, or not the owner's. */
export const REFUSAL_REASONS = ["instruction", "secret", "owner"] as const
export type RefusalReason = (typeof REFUSAL_REASONS)[number]

/** An event the source will never deliver. The consumer may advance its cursor past it. */
export interface RefusedEvent {
  readonly external_id: string
  readonly reason: RefusalReason
  /** One line, at most 200 characters, never the event's content: the secret kinds, for example. */
  readonly detail?: string
}

/** An event the source could not read this time. Any entry holds the consumer's cursor back. */
export interface FailedEvent {
  readonly external_id: string
  /** An error code (`RATE_LIMITED`, `UNAVAILABLE`, …). */
  readonly code: string
  readonly retryAfterSec?: number
}

/**
 * Why a source no longer stands behind something it listed (#27): `deleted`, the provider's copy is gone; `withheld`,
 * the source may not show it now (a permission lost, a policy, a person's instruction); `expired`, the source no longer
 * keeps it.
 */
export const REMOVAL_REASONS = ["deleted", "withheld", "expired"] as const
export type RemovalReason = (typeof REMOVAL_REASONS)[number]

/**
 * Something the source listed before and no longer stands behind (#27), so a consumer can retract what it derived.
 * `external_id` is the id the source listed, never a hash (D2); `at` is when the source learned of it, UTC, never later
 * than the page's `asOf`. A removal is an answer, not a drop: the page's cursor covers it and it never holds a cursor
 * back, so no id is in both `removals[]` and `failed[]`. It may name an id that is also among the page's events (a
 * tombstone); a consumer applies the events first, then the removals.
 */
export interface EventsRemoval {
  readonly external_id: string
  readonly at: string
  readonly reason: RemovalReason
}

/** Why history was lost: the provider expired it, or the source read only part of the window. */
export const GAP_REASONS = ["expired", "window-truncated"] as const
export type GapReason = (typeof GAP_REASONS)[number]

/** History is lost from `since` (UTC ISO) up to the page's first event. */
export interface EventsGap {
  readonly reason: GapReason
  readonly since: string
}

/** What the provider reported this call cost, for billed sources: counts per declared price unit, and US dollars. */
export interface EventsCost {
  readonly units: readonly { readonly per: string; readonly count: number }[]
  readonly usd?: number
}

export interface EventsListInput {
  readonly since?: string
  readonly cursor?: string
  readonly limit?: number
  readonly account?: string
  readonly source?: string
  readonly scope?: Scope
}

export interface EventsListResult {
  /** The source every event names, also on an empty page. */
  readonly source: string
  /** The account every event names, also on an empty page. */
  readonly account: string
  readonly owner: EventsOwner
  readonly events: SourceEvent[]
  readonly cursor: string
  readonly more: boolean
  readonly trust: typeof TRUST
  /** The scope the page was read under, canonical (`canonicalScope`); absent for the whole source. */
  readonly scope?: Record<string, string | string[]>
  readonly refused?: RefusedEvent[]
  readonly failed?: FailedEvent[]
  /** Things the source listed before and no longer stands behind (#27). */
  readonly removals?: EventsRemoval[]
  readonly gap?: EventsGap
  readonly cost?: EventsCost
  /** The plugin's package name or id (the draft's envelope). */
  readonly plugin?: string
  /** When the source read the page, UTC ISO (the draft's envelope). */
  readonly asOf?: string
}

/** An input after `parseEventsListInput`: `since` in epoch milliseconds, `limit` with its default, `scope` canonical. */
export interface EventsListRequest {
  readonly since?: number
  readonly cursor?: string
  readonly limit: number
  readonly account?: string
  readonly source?: string
  readonly scope?: Record<string, string | string[]>
}

// ── Errors (design §2.1, "Errors") ────────────────────────────────────────

/** The one error table: the draft's nine, the final design's three, and the two input refusals (D3). */
export const ERROR_CODES = [
  "NEEDS_SIGN_IN",
  "ACCOUNT_MISMATCH",
  "CURSOR_INVALID",
  "CURSOR_EXPIRED",
  "RATE_LIMITED",
  "TOO_LARGE",
  "SCHEMA_VIOLATION",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
  "SCOPE_MISSING",
  "BUDGET_EXCEEDED",
  "SOURCE_DISABLED",
  "INPUT_INVALID",
  "SOURCE_UNKNOWN",
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

/**
 * Codes proposed for the table and not yet in it. Empty: D3 (a) moved `INPUT_INVALID` and `SOURCE_UNKNOWN` into
 * `ERROR_CODES`. Kept for one release so an importer does not break.
 */
export const PROPOSED_CODES = [] as const
export type ProposedCode = (typeof PROPOSED_CODES)[number]

/**
 * Other names for codes in the table. `AUTH_REQUIRED` is `NEEDS_SIGN_IN` (design §2.1). `ACCOUNT_UNKNOWN`, the code the
 * family's tools RPC and plugins give for an account the plugin does not have, is `ACCOUNT_MISMATCH`: the read named
 * an account other than one the source can read, and trying again will not help.
 */
export const ERROR_ALIASES: Readonly<Record<string, ErrorCode>> = { AUTH_REQUIRED: "NEEDS_SIGN_IN", ACCOUNT_UNKNOWN: "ACCOUNT_MISMATCH" }

/**
 * The codes contract 1's plugins use, mapped to the table, so a consumer can read a plugin that has not moved yet
 * (projects support the current and previous contract versions, design §3).
 */
export const CONTRACT1_CODES: Readonly<Record<string, ErrorCode | ProposedCode>> = {
  EVENTS_INVALID_INPUT: "INPUT_INVALID",
  EVENTS_CURSOR_INVALID: "CURSOR_INVALID",
  EVENTS_SOURCE_UNKNOWN: "SOURCE_UNKNOWN",
}

/** The table's code for `code`: itself, its alias, or contract 1's name for it; undefined for any other code. */
export function canonicalCode(code: string): ErrorCode | ProposedCode | undefined {
  if ((ERROR_CODES as readonly string[]).includes(code) || (PROPOSED_CODES as readonly string[]).includes(code)) return code as ErrorCode | ProposedCode
  return ERROR_ALIASES[code] ?? CONTRACT1_CODES[code]
}

/**
 * A refusal in the family's form, `CODE: what happened. Next step: what to do.`, with the code and its data. A
 * `RATE_LIMITED` or `BUDGET_EXCEEDED` may carry `retryAfterSec`; a `CURSOR_EXPIRED` carries the `gap`.
 */
export class SourceError extends Error {
  readonly code: string
  readonly what: string
  readonly next: string
  readonly retryAfterSec?: number
  readonly gap?: EventsGap
  constructor(init: { readonly code: string; readonly what: string; readonly next: string; readonly retryAfterSec?: number; readonly gap?: EventsGap }) {
    super(`${init.code}: ${init.what.replace(/[.\s]+$/, "")}. Next step: ${init.next}`)
    this.name = "SourceError"
    this.code = init.code
    this.what = init.what
    this.next = init.next
    if (init.retryAfterSec !== undefined) this.retryAfterSec = init.retryAfterSec
    if (init.gap !== undefined) this.gap = init.gap
  }
}

const FAMILY_MESSAGE = /^([A-Z][A-Z0-9_]*): ([^]*?)(?:\. Next step: ([^]*))?$/

/**
 * The code, its canonical code, what happened and the next step, read from a refusal: a `SourceError`, or any error
 * whose message is in the family's form. Undefined for an error with no code.
 */
export function parseSourceError(error: unknown): { code: string; canonical?: ErrorCode | ProposedCode; what: string; next?: string } | undefined {
  if (error instanceof SourceError) {
    const canonical = canonicalCode(error.code)
    return { code: error.code, ...(canonical ? { canonical } : {}), what: error.what, next: error.next }
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : undefined
  const match = message === undefined ? null : FAMILY_MESSAGE.exec(message.split("\n", 1)[0] ?? "")
  if (!match) return undefined
  const canonical = canonicalCode(match[1]!)
  return { code: match[1]!, ...(canonical ? { canonical } : {}), what: match[2]!, ...(match[3] === undefined ? {} : { next: match[3] }) }
}

// ── Input ─────────────────────────────────────────────────────────────────

/** An ISO date (a UTC day), or an ISO date-time with seconds optional and `Z` or an offset. */
export const SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/

/** A source's name: a lowercase word such as gmail or history. */
export const SOURCE_PATTERN = /^[a-z][a-z0-9-]*$/

/** A scope key: a word such as `label`, `channels` or `repositories`. */
export const SCOPE_KEY_PATTERN = /^[a-z][A-Za-z0-9_-]*$/

const INPUT_KEYS: readonly string[] = ["since", "cursor", "limit", "account", "source"]
/** True when the text has a control character (U+0000 to U+001F, or U+007F). */
const hasControl = (text: string) => [...text].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)

const plainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** `since` in epoch milliseconds; undefined when it is not one of the accepted forms or not a real time. */
export function sinceTime(since: string): number | undefined {
  if (!SINCE_PATTERN.test(since)) return undefined
  const time = Date.parse(since.length === 10 ? `${since}T00:00:00Z` : since)
  return Number.isFinite(time) ? time : undefined
}

const scopeValue = (value: unknown) =>
  typeof value === "string" && value.length > 0 && value.length <= EVENT_LIMITS.scopeValue && !hasControl(value)

/** A scope's problems against the keys a source declares, one sentence each, naming keys and never values. */
export function scopeProblems(scope: unknown, keys: readonly string[]): string[] {
  if (!plainObject(scope)) return [`"scope" must be an object of the source's scope keys`]
  const problems: string[] = []
  const entries = Object.entries(scope)
  if (entries.length > EVENT_LIMITS.scopeKeys) problems.push(`"scope" has more than ${EVENT_LIMITS.scopeKeys} keys`)
  for (const [key, value] of entries) {
    if (!keys.includes(key)) {
      problems.push(SCOPE_KEY_PATTERN.test(key) && key.length <= EVENT_LIMITS.scopeKey ? `"scope.${key}" is not a scope key of this source` : `"scope" has a key that is not a scope key of this source`)
      continue
    }
    const ok = scopeValue(value) || (Array.isArray(value) && value.length <= EVENT_LIMITS.scopeValues && value.every(scopeValue))
    if (!ok) problems.push(`"scope.${key}" must be a value, or a list of at most ${EVENT_LIMITS.scopeValues} values, of at most ${EVENT_LIMITS.scopeValue} characters`)
  }
  return problems
}

/** How a source parses its input: the scope keys it declares (`scope.keys` in its descriptor), none by default. */
export interface ParseOptions {
  readonly scopeKeys?: readonly string[]
}

/**
 * The input checked and normalised, or the problems with it, one sentence each, naming fields and never values.
 * `scope` is accepted only when `options.scopeKeys` declares keys: a source that does not read a scope must refuse
 * one rather than ignore it, since ignoring it would read more than the consumer asked for.
 */
export function parseEventsListInput(input: unknown, options: ParseOptions = {}): { ok: true; value: EventsListRequest } | { ok: false; problems: string[] } {
  const value = input === undefined || input === null ? {} : input
  if (!plainObject(value)) return { ok: false, problems: ["the input must be an object"] }
  const scoped = (options.scopeKeys?.length ?? 0) > 0
  const known = scoped ? [...INPUT_KEYS, "scope"] : INPUT_KEYS
  const problems = Object.keys(value).filter((key) => !known.includes(key)).map((key) => `"${key}" is not an input of events_list`)
  const { since, cursor, limit, account, source, scope } = value
  let time: number | undefined
  if (since !== undefined) {
    time = typeof since === "string" ? sinceTime(since) : undefined
    if (time === undefined) problems.push(`"since" must be an ISO date, or an ISO date-time with Z or an offset`)
  }
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > EVENT_LIMITS.cursor)) {
    problems.push(`"cursor" must be a cursor from a previous result`)
  }
  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit) || limit < PAGE.min || limit > PAGE.max)) {
    problems.push(`"limit" must be an integer from ${PAGE.min} to ${PAGE.max}`)
  }
  if (account !== undefined && (typeof account !== "string" || account.length === 0 || account.length > EVENT_LIMITS.account || hasControl(account))) {
    problems.push(`"account" must be a non-empty account name of at most ${EVENT_LIMITS.account} characters`)
  }
  if (source !== undefined && (typeof source !== "string" || source.length > EVENT_LIMITS.source || !SOURCE_PATTERN.test(source))) {
    problems.push(`"source" must be a source's name, a lowercase word such as gmail`)
  }
  if (scoped && scope !== undefined) problems.push(...scopeProblems(scope, options.scopeKeys!))
  if (problems.length > 0) return { ok: false, problems }
  return {
    ok: true,
    value: {
      ...(time === undefined ? {} : { since: time }),
      ...(cursor === undefined ? {} : { cursor: cursor as string }),
      limit: (limit as number | undefined) ?? PAGE.default,
      ...(account === undefined ? {} : { account: account as string }),
      ...(source === undefined ? {} : { source: source as string }),
      ...(scoped && scope !== undefined ? { scope: canonicalScope(scope as Scope) } : {}),
    },
  }
}

/** Where a listing without a cursor starts: `since`, or `FIRST_RUN_HOURS` before `now`. */
export function startTime(request: Pick<EventsListRequest, "since">, now: number): number {
  return request.since ?? now - FIRST_RUN_HOURS * 3_600_000
}

// ── Events ────────────────────────────────────────────────────────────────

/** At most `max` characters, ending in `…` when cut, never splitting a surrogate pair. */
export function cut(text: string, max: number): string {
  if (text.length <= max) return text
  let end = Math.max(0, max - 1)
  const code = text.charCodeAt(end - 1)
  if (end > 0 && code >= 0xd800 && code <= 0xdbff) end--
  return `${text.slice(0, end)}…`
}

/**
 * A value with object keys sorted at every depth, so the order a plugin built it in does not change the hash. Arrays
 * keep their order.
 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value as Record<string, unknown>).filter((key) => (value as Record<string, unknown>)[key] !== undefined)
    return Object.fromEntries(entries.sort().map((key) => [key, stable((value as Record<string, unknown>)[key])]))
  }
  return value
}

/** The new event fields a hash covers, in the one order they are hashed in (#45 §6). */
const HASHED_EVENT_FIELDS = ["reply_to", "audience", "domains", "sections", "parts", "facts"] as const

/**
 * One actor as the hash sees it: the role, id and name of contract 1, and, only when the actor carries one, its new
 * metadata (#45 §1) in a sorted object. An actor without metadata hashes exactly as it did before v0.3.
 */
function actorFields(actor: EventActor): unknown[] {
  const base: unknown[] = [actor.role, actor.id, actor.name ?? null]
  const extra = stable({ kind: actor.kind, identities: actor.identities, self: actor.self })
  return Object.keys(extra as Record<string, unknown>).length === 0 ? base : [...base, extra]
}

/**
 * `sha256:` and the hex digest of every field but the hash, in a fixed order. Contract 1's fields hash as they always
 * have; each new field is appended, with its name, only when it is present (#45 §6), so an event without them hashes
 * as it did in v0.2.
 */
export function eventHash(event: Omit<SourceEvent, "hash">): string {
  const fields: unknown[] = [
    event.source,
    event.account,
    event.external_id,
    event.kind,
    event.occurred_at,
    event.thread,
    event.actors.map(actorFields),
    event.title,
    event.text,
    event.url,
    event.labels,
  ]
  for (const key of HASHED_EVENT_FIELDS) {
    const value = event[key]
    if (value !== undefined) fields.push([key, stable(value)])
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`
}

/** What a source fills in for `makeEvent`; it normalises the rest. */
export interface EventDraft {
  readonly source: string
  readonly account: string
  readonly external_id: string
  readonly kind: EventKind
  /** A Date, epoch milliseconds, or a string `Date.parse` reads. */
  readonly occurred_at: Date | number | string
  readonly thread?: string | null
  readonly actors?: readonly { readonly role: string; readonly id: string; readonly name?: string | null; readonly kind?: ActorKind; readonly identities?: readonly EventIdentity[]; readonly self?: boolean }[]
  readonly title?: string | null
  readonly text?: string | null
  readonly url?: string | null
  readonly labels?: readonly string[]
  readonly reply_to?: string | null
  readonly audience?: Audience | null
  readonly domains?: readonly string[]
  readonly sections?: readonly { readonly heading: string; readonly text: string }[]
  readonly parts?: readonly { readonly id: string; readonly text: string; readonly actor?: string }[]
  readonly facts?: readonly EventFact[]
}

const clean = (text: string) => text.replaceAll("\u0000", "")
const oneLine = (text: string) => clean(text).replace(/\s+/g, " ").trim()

/**
 * A `SourceEvent` from a draft: the time in UTC ISO form, the title on one line and cut to 300 characters, the text cut
 * to 4096, actors without blanks or repeats and at most 20, labels likewise, a url only when it is https, the metadata
 * of #45 §2 normalised, and the hash. An actor's `kind`, identities and `self` are kept as the plugin gave them, and so
 * are an event's facts: `eventProblems` is where a wrong one is refused. Throws when the time is not a real time.
 */
export function makeEvent(draft: EventDraft): SourceEvent {
  const time = draft.occurred_at instanceof Date ? draft.occurred_at.getTime() : typeof draft.occurred_at === "number" ? draft.occurred_at : Date.parse(draft.occurred_at)
  if (!Number.isFinite(time)) throw new Error("events-list: an event's occurred_at is not a time")
  const seen = new Set<string>()
  const actors: EventActor[] = []
  for (const actor of draft.actors ?? []) {
    const role = oneLine(actor.role).toLowerCase()
    const id = oneLine(actor.id)
    const key = `${role}\u0000${id}`
    if (!role || !id || seen.has(key) || actors.length >= EVENT_LIMITS.actors) continue
    seen.add(key)
    const name = actor.name ? cut(oneLine(actor.name), EVENT_LIMITS.actorName) : ""
    actors.push({
      role,
      id,
      ...(name ? { name } : {}),
      ...(actor.kind === undefined ? {} : { kind: actor.kind }),
      ...(actor.identities === undefined ? {} : { identities: [...actor.identities] }),
      ...(actor.self === undefined ? {} : { self: actor.self }),
    })
  }
  const labels = [...new Set((draft.labels ?? []).map((label) => oneLine(label).replace(/\s/g, "-")).filter((label) => label.length > 0 && label.length <= EVENT_LIMITS.label))].slice(0, EVENT_LIMITS.labels)
  const url = draft.url && /^https:\/\/\S+$/.test(draft.url) && draft.url.length <= EVENT_LIMITS.url ? draft.url : null
  const thread = draft.thread ? oneLine(draft.thread) || null : null
  const replyTo = draft.reply_to ? cut(oneLine(draft.reply_to), EVENT_LIMITS.replyTo) : undefined
  const domains = draft.domains === undefined ? undefined : [...new Set(draft.domains.map((domain) => oneLine(domain).toLowerCase()))].filter((domain) => domain.length > 0)
  const sections = draft.sections
    ?.map((section) => ({ heading: cut(oneLine(section.heading), EVENT_LIMITS.sectionHeading), text: cut(clean(section.text), EVENT_LIMITS.text) }))
    .filter((section) => section.heading.length > 0)
  const parts = draft.parts
    ?.map((part) => {
      const id = cut(oneLine(part.id), EVENT_LIMITS.partId)
      const actor = part.actor === undefined ? "" : oneLine(part.actor)
      return { id, text: cut(clean(part.text), EVENT_LIMITS.text), ...(actor ? { actor } : {}) }
    })
    .filter((part) => part.id.length > 0)
  const event = {
    source: draft.source,
    account: draft.account,
    external_id: draft.external_id,
    kind: draft.kind,
    occurred_at: new Date(time).toISOString(),
    thread,
    actors,
    title: cut(oneLine(draft.title ?? ""), EVENT_LIMITS.title),
    text: cut(clean(draft.text ?? "").trim(), EVENT_LIMITS.text),
    url,
    labels,
    ...(replyTo === undefined ? {} : { reply_to: replyTo }),
    ...(draft.audience === undefined || draft.audience === null ? {} : { audience: draft.audience }),
    ...(domains === undefined || domains.length === 0 ? {} : { domains }),
    ...(sections === undefined || sections.length === 0 ? {} : { sections }),
    ...(parts === undefined || parts.length === 0 ? {} : { parts }),
    ...(draft.facts === undefined || draft.facts.length === 0 ? {} : { facts: [...draft.facts] }),
  }
  return { ...event, hash: eventHash(event) }
}

/** Events oldest first; events at the same time keep their order. */
export function oldestFirst<T extends Pick<SourceEvent, "occurred_at">>(events: readonly T[]): T[] {
  return events
    .map((event, index) => ({ event, index, time: Date.parse(event.occurred_at) }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map(({ event }) => event)
}

/**
 * How many of `events`, in the order given, fit in one result: at most `limit`, and as many as keep the result's JSON
 * within `maxBytes` (`MAX_PAGE_BYTES` by default; pass the descriptor's `maxBytes`), but always at least one.
 */
export function fitPage(events: readonly SourceEvent[], limit: number, maxBytes: number = MAX_PAGE_BYTES): number {
  let bytes = 2_048
  let count = 0
  for (const event of events) {
    if (count >= limit) break
    bytes += Buffer.byteLength(JSON.stringify(event)) + 1
    if (count > 0 && bytes > maxBytes) break
    count++
  }
  return count
}

// ── Refusal: the secret pattern, and the source's own predicates ──────────

/** How `screenEvents` decides. Without predicates, only the secret pattern refuses. */
export interface ScreenOptions {
  /** False when the event is not the signed-in owner's (a shared mailbox, a delegated calendar). */
  readonly ownedBy?: (event: SourceEvent) => boolean
  /** True when the event is instruction-shaped text from someone else. The library has no default (`docs/events.md`, D5). */
  readonly instruction?: (event: SourceEvent) => boolean
  /** The secret detector; Memory's `secretKinds` by default. */
  readonly secrets?: (text: string) => readonly string[]
}

/**
 * The events a page may carry, and those it refuses for good, in order: not the owner's, then a secret in the title or
 * text (as Memory's store checks an import), then instruction-shaped. A refusal's detail never holds the content.
 */
export function screenEvents(events: readonly SourceEvent[], options: ScreenOptions = {}): { events: SourceEvent[]; refused: RefusedEvent[] } {
  const detect = options.secrets ?? secretKinds
  const kept: SourceEvent[] = []
  const refused: RefusedEvent[] = []
  for (const event of events) {
    if (options.ownedBy && !options.ownedBy(event)) {
      refused.push({ external_id: event.external_id, reason: "owner" })
      continue
    }
    const kinds = detect([event.title, event.text].filter(Boolean).join("\n"))
    if (kinds.length > 0) {
      refused.push({ external_id: event.external_id, reason: "secret", detail: cut(`holds a secret (${kinds.join(", ")})`, EVENT_LIMITS.detail) })
      continue
    }
    if (options.instruction?.(event)) {
      refused.push({ external_id: event.external_id, reason: "instruction" })
      continue
    }
    kept.push(event)
  }
  return { events: kept, refused }
}

// ── Probe (design §2.3; source-contract#8 and #4) ───────────────────────────

/** The tools-RPC method and tool every source plugin names `probe`: one per plugin, called per source. */
export const PROBE = "probe"

/** `probe`'s input: the source (the plugin's first without it) and the account (its default without it). Nothing else. */
export interface ProbeInput {
  readonly source?: string
  readonly account?: string
}

/** The provider sign-in scopes a probe may list: at most this many, each at most this long. */
export const PROBE_LIMITS = { scopes: 64, scope: 256 } as const

/**
 * What `probe` answers: whose the source is and what its sign-in holds, and nothing it reads. `owner.id` is the id a
 * host keys its cache on and `$me` resolves to. `scopes` are the provider sign-in's scopes, so a Calendar-only sign-in
 * can be told apart. `cost` is what the provider charged for the probe, for a billed source such as X (its own price
 * table, per §2.2 `cost.probe`). `trust` is "untrusted", as on every result.
 */
export interface ProbeResult {
  readonly source: string
  readonly account: string
  readonly owner: EventsOwner
  readonly scopes?: string[]
  readonly cost?: EventsCost
  readonly trust: typeof TRUST
}

/** `probe`'s input checked, or its problems, naming fields and never values. Anything but source and account is refused. */
export function parseProbeInput(input: unknown): { ok: true; value: ProbeInput } | { ok: false; problems: string[] } {
  const value = input === undefined || input === null ? {} : input
  if (!plainObject(value)) return { ok: false, problems: ["the input must be an object"] }
  const problems = Object.keys(value).filter((key) => key !== "source" && key !== "account").map((key) => `"${key}" is not an input of probe`)
  const { source, account } = value
  if (source !== undefined && (typeof source !== "string" || source.length > EVENT_LIMITS.source || !SOURCE_PATTERN.test(source))) {
    problems.push(`"source" must be a source's name, a lowercase word such as gmail`)
  }
  if (account !== undefined && (typeof account !== "string" || account.length === 0 || account.length > EVENT_LIMITS.account || hasControl(account))) {
    problems.push(`"account" must be a non-empty account name of at most ${EVENT_LIMITS.account} characters`)
  }
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, value: { ...(source === undefined ? {} : { source: source as string }), ...(account === undefined ? {} : { account: account as string }) } }
}

/** A probe answer for `identity`, with the sign-in's scopes and the probe's cost when given. */
export function probeResult(identity: EventsListIdentity, extras: { readonly scopes?: readonly string[]; readonly cost?: EventsCost } = {}): ProbeResult {
  return {
    source: identity.source,
    account: identity.account,
    owner: { id: identity.owner.id, label: identity.owner.label, ...(identity.owner.verified === undefined ? {} : { verified: identity.owner.verified }) },
    ...(extras.scopes === undefined ? {} : { scopes: [...new Set(extras.scopes)] }),
    ...(extras.cost === undefined ? {} : { cost: extras.cost }),
    trust: TRUST,
  }
}

const PROBE_KEYS: readonly string[] = ["source", "account", "owner", "scopes", "cost", "trust"]

/**
 * A probe answer's problems, one sentence each; none when it keeps the contract. Its keys are exactly
 * `source, account, owner, scopes?, cost?, trust`, so a probe that returned content (events, data, text) fails. With
 * `expected`, the source and the account must be the ones asked for.
 */
export function probeResultProblems(result: unknown, expected: { readonly source?: string; readonly account?: string } = {}): string[] {
  if (!plainObject(result)) return ["the probe answer is not an object"]
  const problems: string[] = []
  for (const key of Object.keys(result)) if (!PROBE_KEYS.includes(key)) problems.push(`the probe answer has the field "${key}": a probe reads no content, and the contract defines no such field`)
  if (!line(result["source"], EVENT_LIMITS.source) || !SOURCE_PATTERN.test(result["source"])) problems.push("the probe answer's source must be a lowercase name such as gmail")
  else if (expected.source !== undefined && result["source"] !== expected.source) problems.push(`the probe answer names the source ${result["source"]}, not ${expected.source}`)
  if (!line(result["account"], EVENT_LIMITS.account)) problems.push(`the probe answer's account must be a non-empty name of at most ${EVENT_LIMITS.account} characters`)
  else if (expected.account !== undefined && result["account"] !== expected.account) problems.push("the probe answer names another account than the one asked for")
  const owner = result["owner"]
  const ownerShape = ownerShapeProblems(owner, "the probe answer's owner")
  if (ownerShape.length > 0) {
    problems.push(...ownerShape)
  } else if (!SCHEMED.test((owner as Record<string, string>)["id"]!)) {
    // docs/contract.md: an owner's id is scheme-qualified (mailto:, slack:), as an actor's id is.
    problems.push("the probe answer's owner.id must be a scheme-qualified id such as mailto:someone@example.com or slack:U0123")
  }
  const scopes = result["scopes"]
  if (scopes !== undefined && (!Array.isArray(scopes) || scopes.length > PROBE_LIMITS.scopes || scopes.some((scope) => !line(scope, PROBE_LIMITS.scope)) || new Set(scopes).size !== scopes.length)) {
    problems.push(`the probe answer's scopes must be at most ${PROBE_LIMITS.scopes} different lines of at most ${PROBE_LIMITS.scope} characters`)
  }
  if (result["cost"] !== undefined) problems.push(...extraProblems({ cost: result["cost"] }, new Set()).map((problem) => problem.replace("the result's cost", "the probe answer's cost")))
  if (result["trust"] !== TRUST) problems.push(`the probe answer's trust must be "${TRUST}"`)
  return problems
}

// ── Results ───────────────────────────────────────────────────────────────

/** Whose a result is: the source and account it lists, and the signed-in owner of that account. */
export interface EventsListIdentity {
  readonly source: string
  readonly account: string
  readonly owner: EventsOwner
}

/** The page result's optional parts; each is written only when given. Empty `refused` and `failed` lists are left out. */
export interface PageExtras {
  readonly scope?: Scope
  readonly refused?: readonly RefusedEvent[]
  readonly failed?: readonly FailedEvent[]
  readonly removals?: readonly EventsRemoval[]
  readonly gap?: EventsGap
  readonly cost?: EventsCost
  readonly plugin?: string
  readonly asOf?: string
}

/** A result, with its source, account, owner and trust marker, and the extras given. Without extras, contract 1's. */
export function eventsListResult(identity: EventsListIdentity, events: readonly SourceEvent[], cursor: string, more: boolean, extras: PageExtras = {}): EventsListResult {
  return {
    source: identity.source,
    account: identity.account,
    owner: identity.owner,
    events: [...events],
    cursor,
    more,
    trust: TRUST,
    ...(extras.scope === undefined ? {} : { scope: canonicalScope(extras.scope) }),
    ...(extras.refused && extras.refused.length > 0 ? { refused: [...extras.refused] } : {}),
    ...(extras.failed && extras.failed.length > 0 ? { failed: [...extras.failed] } : {}),
    ...(extras.removals && extras.removals.length > 0 ? { removals: [...extras.removals] } : {}),
    ...(extras.gap === undefined ? {} : { gap: extras.gap }),
    ...(extras.cost === undefined ? {} : { cost: extras.cost }),
    ...(extras.plugin === undefined ? {} : { plugin: extras.plugin }),
    ...(extras.asOf === undefined ? {} : { asOf: extras.asOf }),
  }
}

// ── Checks ────────────────────────────────────────────────────────────────

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const ROLE = /^[a-z][a-z0-9_-]*$/
const SCHEMED = /^[a-z][a-z0-9+.-]*:\S+$/
const HASH = /^sha256:[0-9a-f]{64}$/
const CODE = /^[A-Z][A-Z0-9_]*$/
const UNIT = /^[a-z][a-z0-9_-]*$/
/** A lowercase domain: at least two labels, each one a letter or digit at either end (#45 §2). */
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/
/** A calendar date, `YYYY-MM-DD` (#45 §3). */
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** A list as a sentence reads it: `a, b or c`. */
const listOf = (items: readonly string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`)

const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === "string" && value.length <= max && (empty || value.length > 0) && !value.includes("\u0000")
const line = (value: unknown, max: number, empty = false): value is string => text(value, max, empty) && !hasControl(value)
const isoUtc = (value: unknown): value is string => typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value))

/** One actor's problems (#45 §1), one sentence each; none when it keeps the contract. */
function actorProblems(actor: Record<string, unknown>, at: string): string[] {
  const problems: string[] = []
  for (const key of Object.keys(actor)) if (!["role", "id", "name", "kind", "identities", "self"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`)
  const role = actor.role
  const id = actor.id
  if (!line(role, EVENT_LIMITS.actorRole) || !ROLE.test(role)) problems.push(`${at}.role must be a lowercase word such as from`)
  if (!line(id, EVENT_LIMITS.actorId) || !SCHEMED.test(id)) problems.push(`${at}.id must be a scheme-qualified id such as mailto:someone@example.com`)
  if (actor.name !== undefined && !line(actor.name, EVENT_LIMITS.actorName)) problems.push(`${at}.name must be one non-empty line of at most ${EVENT_LIMITS.actorName} characters`)
  if (actor.kind !== undefined && !(ACTOR_KINDS as readonly unknown[]).includes(actor.kind)) problems.push(`${at}.kind must be ${listOf(ACTOR_KINDS)}`)
  if (actor.self !== undefined && typeof actor.self !== "boolean") problems.push(`${at}.self must be true or false`)
  if (actor.identities !== undefined) {
    if (!Array.isArray(actor.identities) || actor.identities.length > EVENT_LIMITS.identities) problems.push(`${at}.identities must be a list of at most ${EVENT_LIMITS.identities}`)
    else {
      const seen = new Set<string>()
      for (const [index, identity] of (actor.identities as unknown[]).entries()) {
        const here = `${at}.identities[${index}]`
        if (!plainObject(identity)) {
          problems.push(`${here} is not an object`)
          continue
        }
        for (const key of Object.keys(identity)) if (!["id", "strength", "basis"].includes(key)) problems.push(`${here} has the field "${key}", which the contract does not define`)
        const own = identity.id
        if (!line(own, EVENT_LIMITS.actorId) || !SCHEMED.test(own)) problems.push(`${here}.id must be a scheme-qualified id such as mailto:someone@example.com`)
        else if (own === id) problems.push(`${here}.id is the actor's own id: an identity is another id for the same actor`)
        else if (seen.has(own)) problems.push(`${here} repeats an identity`)
        else seen.add(own)
        if (!(IDENTITY_STRENGTHS as readonly unknown[]).includes(identity.strength)) problems.push(`${here}.strength must be ${listOf(IDENTITY_STRENGTHS)}`)
        if (!line(identity.basis, EVENT_LIMITS.identityBasis)) {
          problems.push(`${here}.basis must be one line of at most ${EVENT_LIMITS.identityBasis} characters naming the provider field it came from`)
        }
      }
    }
  }
  return problems
}

/** One event metadata field's problems (#45 §2), for each of `reply_to`, `audience` and `domains`. */
function targetProblems(e: Record<string, unknown>, where: string): string[] {
  const problems: string[] = []
  if (e.reply_to !== undefined && !line(e.reply_to, EVENT_LIMITS.replyTo)) {
    problems.push(`${where}.reply_to must be a non-empty id of at most ${EVENT_LIMITS.replyTo} characters`)
  }
  if (e.audience !== undefined && !(AUDIENCES as readonly unknown[]).includes(e.audience)) {
    problems.push(`${where}.audience must be ${listOf(AUDIENCES)}`)
  }
  if (e.domains !== undefined) {
    if (!Array.isArray(e.domains) || e.domains.length > EVENT_LIMITS.domains) problems.push(`${where}.domains must be at most ${EVENT_LIMITS.domains} lowercase domains`)
    else {
      const seen = new Set<string>()
      for (const [index, domain] of (e.domains as unknown[]).entries()) {
        if (!line(domain, EVENT_LIMITS.domain) || !DOMAIN.test(domain)) problems.push(`${where}.domains[${index}] must be a lowercase domain such as example.com`)
        else if (seen.has(domain)) problems.push(`${where}.domains repeats a domain`)
        else seen.add(domain)
      }
    }
  }
  return problems
}

/** One event's long parts (#45 §2): its sections by heading, and the parts of a growing item. */
function partProblems(e: Record<string, unknown>, where: string, actorIds: ReadonlySet<string>): string[] {
  const problems: string[] = []
  if (e.sections !== undefined) {
    if (!Array.isArray(e.sections) || e.sections.length > EVENT_LIMITS.sections) problems.push(`${where}.sections must be a list of at most ${EVENT_LIMITS.sections}`)
    else {
      for (const [index, section] of (e.sections as unknown[]).entries()) {
        const at = `${where}.sections[${index}]`
        if (!plainObject(section)) {
          problems.push(`${at} is not an object`)
          continue
        }
        for (const key of Object.keys(section)) if (!["heading", "text"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`)
        if (!line(section.heading, EVENT_LIMITS.sectionHeading)) problems.push(`${at}.heading must be one line of at most ${EVENT_LIMITS.sectionHeading} characters`)
        if (!text(section.text, EVENT_LIMITS.text, true)) problems.push(`${at}.text must be at most ${EVENT_LIMITS.text} characters`)
      }
    }
  }
  if (e.parts !== undefined) {
    if (!Array.isArray(e.parts) || e.parts.length > EVENT_LIMITS.parts) problems.push(`${where}.parts must be a list of at most ${EVENT_LIMITS.parts}`)
    else {
      const seen = new Set<string>()
      for (const [index, part] of (e.parts as unknown[]).entries()) {
        const at = `${where}.parts[${index}]`
        if (!plainObject(part)) {
          problems.push(`${at} is not an object`)
          continue
        }
        for (const key of Object.keys(part)) if (!["id", "text", "actor"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`)
        const id = part.id
        if (!line(id, EVENT_LIMITS.partId)) problems.push(`${at}.id must be a non-empty id of at most ${EVENT_LIMITS.partId} characters`)
        else if (seen.has(id)) problems.push(`${at}.id repeats a part`)
        else seen.add(id)
        if (!text(part.text, EVENT_LIMITS.text, true)) problems.push(`${at}.text must be at most ${EVENT_LIMITS.text} characters`)
        if (part.actor !== undefined) {
          if (!line(part.actor, EVENT_LIMITS.actorId)) problems.push(`${at}.actor must be an actor id of the same event`)
          else if (!actorIds.has(part.actor)) problems.push(`${at}.actor is not an actor of the same event`)
        }
      }
    }
  }
  return problems
}

/**
 * One fact's problems (#45 §3), one sentence each; none when it keeps the contract. Each actor reference must be an
 * actor id on the same event, which is `actors`. The shape is closed: a fact carries no version (Memory stamps the
 * installed package's) and no field for a sensitive trait.
 */
export function factProblems(fact: unknown, actors: ReadonlySet<string>, where = "fact"): string[] {
  if (!plainObject(fact)) return [`${where} is not an object`]
  const type = fact.type
  if (!(FACT_TYPES as readonly unknown[]).includes(type)) return [`${where}.type must be ${listOf(FACT_TYPES)}`]
  const allowed: Readonly<Record<FactType, readonly string[]>> = {
    commitment: ["type", "key", "title", "owner", "counterparty", "due", "state", "url"],
    "person.attribute": ["type", "actor", "org", "team", "role"],
    "meeting.attended": ["type", "actor", "response", "organizer"],
  }
  const problems: string[] = []
  for (const key of Object.keys(fact)) {
    if (!allowed[type as FactType].includes(key)) problems.push(`${where} has the field "${key}", which the contract does not define`)
  }
  const reference = (key: string): void => {
    const id = fact[key]
    if (!line(id, EVENT_LIMITS.actorId)) problems.push(`${where}.${key} must be an actor id of the same event`)
    else if (!actors.has(id)) problems.push(`${where}.${key} is not an actor of the same event`)
  }
  if (type === "commitment") {
    if (!line(fact.key, EVENT_LIMITS.factKey)) problems.push(`${where}.key must be a stable id of at most ${EVENT_LIMITS.factKey} characters`)
    if (!line(fact.title, EVENT_LIMITS.factTitle)) problems.push(`${where}.title must be one line of at most ${EVENT_LIMITS.factTitle} characters`)
    reference("owner")
    if (fact.counterparty !== undefined) reference("counterparty")
    if (fact.due !== undefined && !(typeof fact.due === "string" && DATE.test(fact.due) && Number.isFinite(Date.parse(fact.due)))) problems.push(`${where}.due must be a date such as 2026-11-30`)
    if (!(COMMITMENT_STATES as readonly unknown[]).includes(fact.state)) problems.push(`${where}.state must be ${listOf(COMMITMENT_STATES)}`)
    if (fact.url !== undefined && !(typeof fact.url === "string" && fact.url.length <= EVENT_LIMITS.url && /^https:\/\/\S+$/.test(fact.url))) problems.push(`${where}.url must be an https URL`)
  }
  if (type === "person.attribute") {
    reference("actor")
    if (fact.org === undefined && fact.team === undefined && fact.role === undefined) {
      problems.push(`${where} must name org, team or role: a person's attribute comes from structured profile or directory data`)
    }
    for (const key of ["org", "team", "role"] as const) {
      if (fact[key] !== undefined && !line(fact[key], EVENT_LIMITS.factAttribute)) {
        problems.push(`${where}.${key} must be one line of at most ${EVENT_LIMITS.factAttribute} characters`)
      }
    }
  }
  if (type === "meeting.attended") {
    reference("actor")
    if (!(ATTENDANCE_RESPONSES as readonly unknown[]).includes(fact.response)) problems.push(`${where}.response must be ${listOf(ATTENDANCE_RESPONSES)}`)
    if (typeof fact.organizer !== "boolean") problems.push(`${where}.organizer must be true or false`)
  }
  return problems
}

/** One event's facts (#45 §3): at most 20, each a core type, each actor reference an actor of the same event. */
function factsProblems(e: Record<string, unknown>, where: string, actorIds: ReadonlySet<string>): string[] {
  if (e.facts === undefined) return []
  if (!Array.isArray(e.facts) || e.facts.length > EVENT_LIMITS.facts) return [`${where}.facts must be a list of at most ${EVENT_LIMITS.facts}`]
  return (e.facts as unknown[]).flatMap((fact, index) => factProblems(fact, actorIds, `${where}.facts[${index}]`))
}

/** The event fields the contract defines, then those v0.3 adds (`#45`). */
const EVENT_KEYS: readonly string[] = ["source", "account", "external_id", "kind", "occurred_at", "thread", "actors", "title", "text", "url", "labels", "hash"]
const EVENT_METADATA_KEYS: readonly string[] = ["reply_to", "audience", "domains", "sections", "parts", "facts"]

/** One event's problems, one sentence each; none when it keeps the contract. */
export function eventProblems(event: unknown, where = "event"): string[] {
  if (!plainObject(event)) return [`${where} is not an object`]
  const problems: string[] = []
  const keys = [...EVENT_KEYS, ...EVENT_METADATA_KEYS]
  for (const key of Object.keys(event)) if (!keys.includes(key)) problems.push(`${where} has the field "${key}", which the contract does not define`)
  for (const key of EVENT_KEYS) if (!Object.hasOwn(event, key)) problems.push(`${where} has no "${key}"`)
  const e = event as Record<string, unknown>
  if (!line(e.source, EVENT_LIMITS.source) || !SOURCE_PATTERN.test(e.source)) problems.push(`${where}.source must be a lowercase name such as gmail`)
  if (!line(e.account, EVENT_LIMITS.account)) problems.push(`${where}.account must be a non-empty name of at most ${EVENT_LIMITS.account} characters`)
  if (!line(e.external_id, EVENT_LIMITS.externalId)) problems.push(`${where}.external_id must be a non-empty id of at most ${EVENT_LIMITS.externalId} characters`)
  if (!isEventKind(e.kind)) problems.push(`${where}.kind must be one of ${EVENT_KINDS.join(", ")}, or x-<plugin>/<kind>`)
  if (!isoUtc(e.occurred_at)) problems.push(`${where}.occurred_at must be a UTC ISO date-time ending in Z`)
  if (e.thread !== null && !line(e.thread, EVENT_LIMITS.thread)) problems.push(`${where}.thread must be null or a non-empty id of at most ${EVENT_LIMITS.thread} characters`)
  if (!line(e.title, EVENT_LIMITS.title, true)) problems.push(`${where}.title must be one line of at most ${EVENT_LIMITS.title} characters`)
  if (!text(e.text, EVENT_LIMITS.text, true)) problems.push(`${where}.text must be at most ${EVENT_LIMITS.text} characters`)
  if (e.url !== null && (typeof e.url !== "string" || e.url.length > EVENT_LIMITS.url || !/^https:\/\/\S+$/.test(e.url))) problems.push(`${where}.url must be null or an https URL`)
  if (!Array.isArray(e.labels) || e.labels.length > EVENT_LIMITS.labels || e.labels.some((label) => !line(label, EVENT_LIMITS.label) || /\s/.test(label))) {
    problems.push(`${where}.labels must be at most ${EVENT_LIMITS.labels} labels of at most ${EVENT_LIMITS.label} characters without spaces`)
  } else if (new Set(e.labels).size !== e.labels.length) problems.push(`${where}.labels repeats a label`)
  const actorIds = new Set<string>()
  if (!Array.isArray(e.actors) || e.actors.length > EVENT_LIMITS.actors) problems.push(`${where}.actors must be a list of at most ${EVENT_LIMITS.actors}`)
  else {
    const seen = new Set<string>()
    for (const [index, actor] of (e.actors as unknown[]).entries()) {
      const at = `${where}.actors[${index}]`
      if (!plainObject(actor)) {
        problems.push(`${at} is not an object`)
        continue
      }
      problems.push(...actorProblems(actor, at))
      if (typeof actor.id === "string") actorIds.add(actor.id)
      const key = `${String(actor.role)}\u0000${String(actor.id)}`
      if (seen.has(key)) problems.push(`${at} repeats an actor`)
      seen.add(key)
    }
  }
  problems.push(...targetProblems(e, where), ...partProblems(e, where, actorIds), ...factsProblems(e, where, actorIds))
  if (typeof e.hash !== "string" || !HASH.test(e.hash)) problems.push(`${where}.hash must be sha256: and 64 hex digits`)
  else if (problems.length === 0) {
    const { hash, ...rest } = e as unknown as SourceEvent
    if (eventHash(rest) !== hash) problems.push(`${where}.hash is not the eventHash of its fields`)
  }
  return problems
}

/** The fields contract 1 defines, then the optional ones the final page result adds. */
const RESULT_KEYS: readonly string[] = ["source", "account", "owner", "events", "cursor", "more", "trust"]
const EXTRA_KEYS: readonly string[] = ["scope", "refused", "failed", "removals", "gap", "cost", "plugin", "asOf"]

/**
 * A page's `removals[]` problems (#27), one sentence each; none when it is absent or keeps the contract: at most 500
 * entries of exactly `{ external_id, at, reason }`, each id once, none also in `failed[]`, and no `at` later than the
 * page's `asOf`. An id may also be among the page's events. The conformance kit's `removals-are-final` reports these.
 */
export function removalProblems(result: unknown): string[] {
  if (!plainObject(result) || result["removals"] === undefined) return []
  const list = result["removals"]
  if (!Array.isArray(list) || list.length > EVENT_LIMITS.refused) return [`the result's removals must be a list of at most ${EVENT_LIMITS.refused}`]
  const problems: string[] = []
  const asOf = isoUtc(result["asOf"]) ? Date.parse(result["asOf"]) : undefined
  const seen = new Set<string>()
  for (const [index, entry] of list.entries()) {
    const at = `removals[${index}]`
    if (!plainObject(entry)) {
      problems.push(`${at} is not an object`)
      continue
    }
    for (const key of Object.keys(entry)) if (!["external_id", "at", "reason"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`)
    const id = entry["external_id"]
    if (!line(id, EVENT_LIMITS.externalId)) problems.push(`${at}.external_id must be a non-empty id of at most ${EVENT_LIMITS.externalId} characters`)
    else if (seen.has(id)) problems.push("the result's removals lists one event twice")
    else seen.add(id)
    if (!isoUtc(entry["at"])) problems.push(`${at}.at must be a UTC ISO date-time ending in Z`)
    else if (asOf !== undefined && Date.parse(entry["at"]) > asOf) problems.push(`${at}.at is later than the page's asOf`)
    if (!(REMOVAL_REASONS as readonly unknown[]).includes(entry["reason"])) problems.push(`${at}.reason must be one of ${REMOVAL_REASONS.join(", ")}`)
  }
  const failed = result["failed"]
  if (Array.isArray(failed) && failed.some((entry) => plainObject(entry) && typeof entry["external_id"] === "string" && seen.has(entry["external_id"]))) {
    problems.push("an event is both removed and failed: a removal is final, so nothing is retried")
  }
  return problems
}

/** The additions' problems: `scope`, `refused`, `failed`, `removals`, `gap`, `cost`, `plugin` and `asOf`, each when present. */
function extraProblems(result: Record<string, unknown>, ids: ReadonlySet<string>): string[] {
  const problems: string[] = []
  if (result["scope"] !== undefined) {
    const scope = result["scope"]
    let canonical = false
    try {
      canonical = plainObject(scope) && JSON.stringify(canonicalScope(scope as Scope)) === JSON.stringify(scope)
    } catch {
      canonical = false
    }
    if (!canonical || scopeProblems(scope, Object.keys(scope as object)).length > 0) problems.push("the result's scope must be a scope in canonical form: keys sorted, each list sorted without repeats")
  }
  const entries = (name: "refused" | "failed", max: number, check: (entry: Record<string, unknown>, at: string) => string[]) => {
    const list = result[name]
    if (list === undefined) return
    if (!Array.isArray(list) || list.length > max) {
      problems.push(`the result's ${name} must be a list of at most ${max}`)
      return
    }
    for (const [index, entry] of list.entries()) {
      const at = `${name}[${index}]`
      if (!plainObject(entry)) {
        problems.push(`${at} is not an object`)
        continue
      }
      if (!line(entry["external_id"], EVENT_LIMITS.externalId)) problems.push(`${at}.external_id must be a non-empty id of at most ${EVENT_LIMITS.externalId} characters`)
      else if (ids.has(entry["external_id"])) problems.push(`${at} is also among the result's events`)
      problems.push(...check(entry, at))
    }
  }
  entries("refused", EVENT_LIMITS.refused, (entry, at) => [
    ...Object.keys(entry).filter((key) => !["external_id", "reason", "detail"].includes(key)).map((key) => `${at} has the field "${key}", which the contract does not define`),
    ...((REFUSAL_REASONS as readonly unknown[]).includes(entry["reason"]) ? [] : [`${at}.reason must be one of ${REFUSAL_REASONS.join(", ")}`]),
    ...(entry["detail"] === undefined || line(entry["detail"], EVENT_LIMITS.detail) ? [] : [`${at}.detail must be one line of at most ${EVENT_LIMITS.detail} characters`]),
  ])
  entries("failed", EVENT_LIMITS.failed, (entry, at) => [
    ...Object.keys(entry).filter((key) => !["external_id", "code", "retryAfterSec"].includes(key)).map((key) => `${at} has the field "${key}", which the contract does not define`),
    ...(typeof entry["code"] === "string" && CODE.test(entry["code"]) ? [] : [`${at}.code must be an error code such as RATE_LIMITED`]),
    ...(entry["retryAfterSec"] === undefined || (typeof entry["retryAfterSec"] === "number" && Number.isInteger(entry["retryAfterSec"]) && entry["retryAfterSec"] >= 0)
      ? []
      : [`${at}.retryAfterSec must be a whole number of seconds`]),
  ])
  for (const name of ["refused", "failed"] as const) {
    const list = result[name]
    if (Array.isArray(list)) {
      const listed = list.map((entry) => (plainObject(entry) ? entry["external_id"] : undefined))
      if (new Set(listed).size !== listed.length) problems.push(`the result's ${name} lists one event twice`)
    }
  }
  if (Array.isArray(result["refused"]) && Array.isArray(result["failed"])) {
    const refused = new Set((result["refused"] as unknown[]).map((entry) => (plainObject(entry) ? entry["external_id"] : undefined)))
    if ((result["failed"] as unknown[]).some((entry) => plainObject(entry) && refused.has(entry["external_id"]))) problems.push("an event is both refused and failed")
  }
  problems.push(...removalProblems(result))
  if (result["gap"] !== undefined) {
    const gap = result["gap"]
    if (!plainObject(gap) || Object.keys(gap).some((key) => key !== "reason" && key !== "since") || !(GAP_REASONS as readonly unknown[]).includes(gap["reason"]) || !isoUtc(gap["since"])) {
      problems.push(`the result's gap must be { reason: ${GAP_REASONS.join(" or ")}, since: a UTC ISO date-time }`)
    }
  }
  if (result["cost"] !== undefined) {
    const cost = result["cost"]
    const units = plainObject(cost) ? cost["units"] : undefined
    const unitsOk =
      Array.isArray(units) &&
      units.length <= EVENT_LIMITS.costUnits &&
      units.every((unit) => plainObject(unit) && Object.keys(unit).every((key) => key === "per" || key === "count") && typeof unit["per"] === "string" && UNIT.test(unit["per"]) && typeof unit["count"] === "number" && Number.isInteger(unit["count"]) && unit["count"] >= 0)
    const usd = plainObject(cost) ? cost["usd"] : undefined
    const usdOk = usd === undefined || (typeof usd === "number" && Number.isFinite(usd) && usd >= 0)
    if (!plainObject(cost) || Object.keys(cost).some((key) => key !== "units" && key !== "usd") || !unitsOk || !usdOk) {
      problems.push("the result's cost must be { units: [{ per, count }], usd? }, with whole counts and a non-negative usd")
    }
  }
  if (result["plugin"] !== undefined && !line(result["plugin"], 214)) problems.push("the result's plugin must be the plugin's package name or id")
  if (result["asOf"] !== undefined && !isoUtc(result["asOf"])) problems.push("the result's asOf must be a UTC ISO date-time ending in Z")
  return problems
}

/**
 * A result's problems: its shape, every event, the order, the limit and the size, and each optional addition that is
 * present. None when it keeps the contract. `maxBytes` is the source's declared cap, `MAX_PAGE_BYTES` by default.
 */
export function resultProblems(result: unknown, limit: number = PAGE.max, maxBytes: number = MAX_PAGE_BYTES): string[] {
  if (!plainObject(result)) return ["the result is not an object"]
  const problems: string[] = []
  for (const key of Object.keys(result)) if (!RESULT_KEYS.includes(key) && !EXTRA_KEYS.includes(key)) problems.push(`the result has the field "${key}", which the contract does not define`)
  const { source, account } = result
  const named = line(source, EVENT_LIMITS.source) && SOURCE_PATTERN.test(source)
  if (!named) problems.push("the result's source must be a lowercase name such as gmail")
  if (!line(account, EVENT_LIMITS.account)) problems.push(`the result's account must be a non-empty name of at most ${EVENT_LIMITS.account} characters`)
  const owner = result["owner"]
  problems.push(...ownerShapeProblems(owner, "the result's owner"))
  const cursor = result["cursor"]
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > EVENT_LIMITS.cursor) problems.push(`the result's cursor must be a non-empty string of at most ${EVENT_LIMITS.cursor} characters`)
  if (typeof result["more"] !== "boolean") problems.push("the result's more must be true or false")
  if (result["trust"] !== TRUST) problems.push(`the result's trust must be "${TRUST}"`)
  const events = result["events"]
  if (!Array.isArray(events)) return [...problems, "the result's events must be a list"]
  if (events.length > limit) problems.push(`the result has ${events.length} events, over the limit of ${limit}`)
  for (const [index, event] of events.entries()) {
    problems.push(...eventProblems(event, `events[${index}]`))
    if (plainObject(event) && named && event["source"] !== source) problems.push(`events[${index}] names another source than the result`)
    if (plainObject(event) && typeof account === "string" && event["account"] !== account) problems.push(`events[${index}] names another account than the result`)
  }
  const times = events.map((event) => Date.parse(plainObject(event) ? String(event["occurred_at"]) : ""))
  if (times.some((time, index) => index > 0 && time < times[index - 1]!)) problems.push("the result's events are not oldest first")
  const ids = events.map((event) => (plainObject(event) ? `${String(event["source"])}:${String(event["account"])}:${String(event["external_id"])}` : ""))
  if (new Set(ids).size !== ids.length) problems.push("the result lists one event twice")
  problems.push(...extraProblems(result, new Set(events.map((event) => (plainObject(event) ? String(event["external_id"]) : "")))))
  const bytes = Buffer.byteLength(JSON.stringify(result))
  if (bytes > maxBytes) problems.push(`the result is ${bytes} bytes of JSON, over ${maxBytes}`)
  return problems
}
