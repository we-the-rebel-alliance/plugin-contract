import { type Scope } from "../cursor.js";
export { decodeCursor, encodeCursor } from "../cursor.js";
export type { Scope } from "../cursor.js";
export { secretKinds } from "./secrets.js";
/** The tool's and the tools-RPC method's name. */
export declare const EVENTS_LIST = "events_list";
/** The core kinds: contract 1's nine, then `task` and `file` (design §2.1). */
export declare const EVENT_KINDS: readonly ["message", "meeting", "session", "bookmark", "issue", "pr", "commit", "doc", "event", "task", "file"];
export type CoreKind = (typeof EVENT_KINDS)[number];
/** A plugin's own kind: `x-<plugin>/<kind>`, such as `x-jelly/routine-run`. */
export type ExtensionKind = `x-${string}/${string}`;
export type EventKind = CoreKind | ExtensionKind;
/** The most characters each segment of an `x-<namespace>/<name>` takes: the namespace, and the name. */
export declare const EXTENSION_SEGMENT_MAX = 32;
/**
 * The one rule for an extension name, an event kind (`x-jelly/routine-run`) or a snapshot output (`x-mem/receipt`):
 * `x-`, a lowercase namespace word, `/`, a lowercase name word, each of 1 to `EXTENSION_SEGMENT_MAX` characters.
 * Memory's schema and the registry use this pattern rather than their own (source-contract#21).
 */
export declare const EXTENSION_NAME: RegExp;
/** An extension kind: `EXTENSION_NAME`, the one rule for kinds and outputs. */
export declare const EXTENSION_KIND: RegExp;
/** True for an extension name, a kind or an output, by `EXTENSION_NAME`. */
export declare const isExtensionName: (name: unknown) => name is ExtensionKind;
/** True for a core kind, or an extension kind (`EXTENSION_NAME`). */
export declare const isEventKind: (kind: unknown) => kind is EventKind;
/** An extension kind's namespace: `jelly` in `x-jelly/routine-run`; undefined for a core kind or a malformed one. */
export declare function extensionNamespace(kind: string): string | undefined;
/**
 * True for a core kind, or an extension kind in `namespace`: the first segment of the source's id (`jelly` for
 * `jelly.routine-runs`), as Memory's schema checks a descriptor's `reads` (decision D13, (b)). An extension kind of
 * another namespace is refused, so one plugin cannot speak in another's vocabulary.
 */
export declare function isEventKindIn(kind: unknown, namespace: string): kind is EventKind;
/** The namespace of a source id: its first dotted segment (`gws` in `gws.gmail`). */
export declare const sourceNamespace: (sourceId: string) => string;
/** The most characters each field takes, and the most items each list takes. */
export declare const EVENT_LIMITS: {
    readonly source: 64;
    readonly account: 128;
    readonly externalId: 512;
    readonly thread: 512;
    readonly title: 300;
    readonly text: 4096;
    readonly url: 2048;
    readonly actors: 20;
    readonly actorRole: 32;
    readonly actorId: 320;
    readonly actorName: 200;
    readonly labels: 20;
    readonly label: 64;
    readonly ownerId: 320;
    readonly ownerLabel: 200;
    readonly cursor: 1024;
    readonly scopeKeys: 16;
    readonly scopeKey: 64;
    readonly scopeValues: 64;
    readonly scopeValue: 256;
    readonly refused: 500;
    readonly failed: 500;
    readonly detail: 200;
    readonly costUnits: 8;
    /** #45 §1: the identities one actor may carry, and the lengths of each part of one. */
    readonly identities: 10;
    readonly identityBasis: 64;
    /** #45 §2: the metadata one event may carry. */
    readonly replyTo: 512;
    readonly domains: 20;
    readonly domain: 253;
    readonly sections: 20;
    readonly sectionHeading: 300;
    readonly parts: 50;
    readonly partId: 512;
    /** #45 §3: the facts one event may carry, and the lengths of their fields. */
    readonly facts: 20;
    readonly factKey: 200;
    readonly factTitle: 300;
    readonly factAttribute: 120;
};
/** `limit`'s default and inclusive range. */
export declare const PAGE: {
    readonly default: 100;
    readonly min: 1;
    readonly max: 500;
};
/**
 * The most bytes of JSON one result holds when the source declares no `maxBytes`: 64 KB, the descriptor's default
 * `maxBytes` and the host's RPC cap (decision D10, (b); contract 1's cap was 900 000). A source that declares a larger
 * `maxBytes` (at most 1 MB) passes it to `fitPage`, and the conformance takes it.
 */
export declare const MAX_PAGE_BYTES = 65536;
/** The descriptor's `maxBytes`: its default and its ceiling (design §2.2). */
export declare const MAX_BYTES: {
    readonly default: 65536;
    readonly max: 1048576;
};
/** Where a listing starts when the call has neither cursor nor since: this many hours before now. */
export declare const FIRST_RUN_HOURS = 24;
export declare const TRUST: "untrusted";
/**
 * What kind of actor an actor is (#45 §1): a person, an agent, a bot or a service. Absent means "not known to be one",
 * never a confirmed person. `kind` is required for every agent, bot and service actor a plugin can recognise.
 */
export declare const ACTOR_KINDS: readonly ["person", "agent", "bot", "service"];
export type ActorKind = (typeof ACTOR_KINDS)[number];
/**
 * The roles the contract gives a meaning (#45 §1): `from` is the author, at most one per event, and `author` is read as
 * its alias; `to`, `cc` and `bcc` are recipients, `mentioned` an actor the provider resolves from a mention, and the
 * rest keep their meaning. An unknown role is read as "involved", so a plugin may name its own.
 */
export declare const ACTOR_ROLES: readonly ["from", "author", "to", "cc", "bcc", "mentioned", "assignee", "creator", "reviewer", "organizer", "attendee", "owner", "speaker", "agent"];
export type ActorRole = (typeof ACTOR_ROLES)[number];
/**
 * The roles that name an event's author: `from`, and its alias `author`. A page may list several (#45 §1) — a `From`
 * header carries several addresses, and gws lists one `from` actor for each — so a consumer reads the first `from`, or
 * else the first `author`, as the author. The kit's `one-author` is a plugin's authoring-time check, not a page rule.
 */
export declare const AUTHOR_ROLES: readonly ["from", "author"];
/** How strong an identity is (#45 §1): `strong` from an authenticated source, `weak` as observed. */
export declare const IDENTITY_STRENGTHS: readonly ["strong", "weak"];
export type IdentityStrength = (typeof IDENTITY_STRENGTHS)[number];
/**
 * Another id the plugin knows for one actor (#45 §1). `id` is scheme-qualified and never the actor's own `id`;
 * `strength` says whether an authenticated source gave it; `basis` names the provider field it came from, such as
 * `slack.profile.email`. Only a strong identity merges people automatically, and never without the person's word.
 */
export interface EventIdentity {
    readonly id: string;
    readonly strength: IdentityStrength;
    /** The provider field it came from, at most 64 characters, such as `slack.profile.email`. */
    readonly basis: string;
}
/**
 * Someone or something an event involves. `id` is a stable, scheme-qualified id: `mailto:…`, `slack:U…`, `github:…`.
 * `kind` says what it is, `identities` lists every other id the plugin knows for it, and `self` is a hint that it is
 * the signed-in person, which Memory alone decides (#45 §1, §7).
 */
export interface EventActor {
    readonly role: string;
    readonly id: string;
    readonly name?: string;
    readonly kind?: ActorKind;
    readonly identities?: EventIdentity[];
    readonly self?: boolean;
}
/** Who an item was for (#45 §2): a direct message, a group, a channel, mail, or a public place. Absent means unknown. */
export declare const AUDIENCES: readonly ["dm", "group", "channel", "email", "public"];
export type Audience = (typeof AUDIENCES)[number];
/** One heading of a long item, such as a meeting's notes (#45 §2). Its `text` is up to 4,096 characters of its own. */
export interface EventSection {
    readonly heading: string;
    readonly text: string;
}
/**
 * One part of a growing item, such as one turn of a session or of a transcript (#45 §2). A part's `id` and `text`
 * never change once listed, so a consumer may add the new parts only. `actor` names an actor id on the same event.
 */
export interface EventPart {
    readonly id: string;
    readonly text: string;
    readonly actor?: string;
}
/** The core fact types (#45 §3). v0.3 has no plugin-defined type, and no fact has a field for a sensitive trait. */
export declare const FACT_TYPES: readonly ["commitment", "person.attribute", "meeting.attended"];
export type FactType = (typeof FACT_TYPES)[number];
/** What a commitment is doing (#45 §3). */
export declare const COMMITMENT_STATES: readonly ["open", "done", "cancelled"];
export type CommitmentState = (typeof COMMITMENT_STATES)[number];
/** How someone answered a meeting invitation (#45 §3). */
export declare const ATTENDANCE_RESPONSES: readonly ["accepted", "declined", "tentative", "needs_action"];
export type AttendanceResponse = (typeof ATTENDANCE_RESPONSES)[number];
/**
 * A commitment the source already holds in code (#45 §3): `key` is a stable id within the source and account, so two
 * pages that list one item give one key; `owner` and `counterparty` are actor ids on the same event; `state` is what
 * the provider says now. Memory stamps the installed package's version on each fact it files, so a fact carries none.
 */
export interface FactCommitment {
    readonly type: "commitment";
    readonly key: string;
    readonly title: string;
    readonly owner: string;
    readonly counterparty?: string;
    /** `YYYY-MM-DD`. */
    readonly due?: string;
    readonly state: CommitmentState;
    readonly url?: string;
}
/** An attribute of a person, from structured profile or directory data only (#45 §3): at least one of the three. */
export interface FactPersonAttribute {
    readonly type: "person.attribute";
    readonly actor: string;
    readonly org?: string;
    readonly team?: string;
    readonly role?: string;
}
/** Who attended a meeting, and how they answered (#45 §3). */
export interface FactMeetingAttended {
    readonly type: "meeting.attended";
    readonly actor: string;
    readonly response: AttendanceResponse;
    readonly organizer: boolean;
}
/** A typed fact on an event (#45 §3): derived in the plugin's code from provider fields, never from free text. */
export type EventFact = FactCommitment | FactPersonAttribute | FactMeetingAttended;
/** One normalised event, as a source lists it. A consumer adds its own id. */
export interface SourceEvent {
    readonly source: string;
    readonly account: string;
    readonly external_id: string;
    readonly kind: EventKind;
    /** UTC, as `Date.prototype.toISOString` writes it. */
    readonly occurred_at: string;
    readonly thread: string | null;
    readonly actors: EventActor[];
    readonly title: string;
    readonly text: string;
    /** An https link to the thing in the source, or null when it has none. */
    readonly url: string | null;
    readonly labels: string[];
    /** `sha256:<hex>` of every other field, from `eventHash`. */
    readonly hash: string;
    /** (#45 §2) The parent's `external_id`, or a source-scoped key such as `gmail-message:<Message-ID>`. */
    readonly reply_to?: string;
    /** (#45 §2) Who the item was for. Absent means unknown. */
    readonly audience?: Audience;
    /** (#45 §2) The recipients' lowercase domains, for mail and shared channels, at most 20. */
    readonly domains?: string[];
    /** (#45 §2) A long item by heading, at most 20, each text of its own 4,096 characters. */
    readonly sections?: EventSection[];
    /** (#45 §2) A growing item's parts, at most 50, whose ids and texts never change once listed. */
    readonly parts?: EventPart[];
    /** (#45 §3) Typed facts the source derives in code, at most 20, each of a type the descriptor declares. */
    readonly facts?: EventFact[];
}
/** The signed-in source account. */
export interface EventsOwner {
    readonly id: string;
    readonly label: string;
    /**
     * (#30, item 13) `false` when the provider does not confirm who this is, so the id is the plugin's best knowledge
     * (Wispr Flow names OpenCode's credential, `wisprflow:credential:<id>`). A consumer shows it as unverified. Absent
     * means the plugin vouches that the provider named the owner. Only `false` is accepted, so one owner has one encoding.
     */
    readonly verified?: false;
}
/** Why an event is refused for good: instruction-shaped text from someone else, a secret, or not the owner's. */
export declare const REFUSAL_REASONS: readonly ["instruction", "secret", "owner"];
export type RefusalReason = (typeof REFUSAL_REASONS)[number];
/** An event the source will never deliver. The consumer may advance its cursor past it. */
export interface RefusedEvent {
    readonly external_id: string;
    readonly reason: RefusalReason;
    /** One line, at most 200 characters, never the event's content: the secret kinds, for example. */
    readonly detail?: string;
}
/** An event the source could not read this time. Any entry holds the consumer's cursor back. */
export interface FailedEvent {
    readonly external_id: string;
    /** An error code (`RATE_LIMITED`, `UNAVAILABLE`, …). */
    readonly code: string;
    readonly retryAfterSec?: number;
}
/**
 * Why a source no longer stands behind something it listed (#27): `deleted`, the provider's copy is gone; `withheld`,
 * the source may not show it now (a permission lost, a policy, a person's instruction); `expired`, the source no longer
 * keeps it.
 */
export declare const REMOVAL_REASONS: readonly ["deleted", "withheld", "expired"];
export type RemovalReason = (typeof REMOVAL_REASONS)[number];
/**
 * Something the source listed before and no longer stands behind (#27), so a consumer can retract what it derived.
 * `external_id` is the id the source listed, never a hash (D2); `at` is when the source learned of it, UTC, never later
 * than the page's `asOf`. A removal is an answer, not a drop: the page's cursor covers it and it never holds a cursor
 * back, so no id is in both `removals[]` and `failed[]`. It may name an id that is also among the page's events (a
 * tombstone); a consumer applies the events first, then the removals.
 */
export interface EventsRemoval {
    readonly external_id: string;
    readonly at: string;
    readonly reason: RemovalReason;
}
/** Why history was lost: the provider expired it, or the source read only part of the window. */
export declare const GAP_REASONS: readonly ["expired", "window-truncated"];
export type GapReason = (typeof GAP_REASONS)[number];
/** History is lost from `since` (UTC ISO) up to the page's first event. */
export interface EventsGap {
    readonly reason: GapReason;
    readonly since: string;
}
/** What the provider reported this call cost, for billed sources: counts per declared price unit, and US dollars. */
export interface EventsCost {
    readonly units: readonly {
        readonly per: string;
        readonly count: number;
    }[];
    readonly usd?: number;
}
export interface EventsListInput {
    readonly since?: string;
    readonly cursor?: string;
    readonly limit?: number;
    readonly account?: string;
    readonly source?: string;
    readonly scope?: Scope;
}
export interface EventsListResult {
    /** The source every event names, also on an empty page. */
    readonly source: string;
    /** The account every event names, also on an empty page. */
    readonly account: string;
    readonly owner: EventsOwner;
    readonly events: SourceEvent[];
    readonly cursor: string;
    readonly more: boolean;
    readonly trust: typeof TRUST;
    /** The scope the page was read under, canonical (`canonicalScope`); absent for the whole source. */
    readonly scope?: Record<string, string | string[]>;
    readonly refused?: RefusedEvent[];
    readonly failed?: FailedEvent[];
    /** Things the source listed before and no longer stands behind (#27). */
    readonly removals?: EventsRemoval[];
    readonly gap?: EventsGap;
    readonly cost?: EventsCost;
    /** The plugin's package name or id (the draft's envelope). */
    readonly plugin?: string;
    /** When the source read the page, UTC ISO (the draft's envelope). */
    readonly asOf?: string;
}
/** An input after `parseEventsListInput`: `since` in epoch milliseconds, `limit` with its default, `scope` canonical. */
export interface EventsListRequest {
    readonly since?: number;
    readonly cursor?: string;
    readonly limit: number;
    readonly account?: string;
    readonly source?: string;
    readonly scope?: Record<string, string | string[]>;
}
/** The one error table: the draft's nine, the final design's three, and the two input refusals (D3). */
export declare const ERROR_CODES: readonly ["NEEDS_SIGN_IN", "ACCOUNT_MISMATCH", "CURSOR_INVALID", "CURSOR_EXPIRED", "RATE_LIMITED", "TOO_LARGE", "SCHEMA_VIOLATION", "PERMISSION_DENIED", "UNAVAILABLE", "SCOPE_MISSING", "BUDGET_EXCEEDED", "SOURCE_DISABLED", "INPUT_INVALID", "SOURCE_UNKNOWN"];
export type ErrorCode = (typeof ERROR_CODES)[number];
/**
 * Codes proposed for the table and not yet in it. Empty: D3 (a) moved `INPUT_INVALID` and `SOURCE_UNKNOWN` into
 * `ERROR_CODES`. Kept for one release so an importer does not break.
 */
export declare const PROPOSED_CODES: readonly [];
export type ProposedCode = (typeof PROPOSED_CODES)[number];
/**
 * Other names for codes in the table. `AUTH_REQUIRED` is `NEEDS_SIGN_IN` (design §2.1). `ACCOUNT_UNKNOWN`, the code the
 * family's tools RPC and plugins give for an account the plugin does not have, is `ACCOUNT_MISMATCH`: the read named
 * an account other than one the source can read, and trying again will not help.
 */
export declare const ERROR_ALIASES: Readonly<Record<string, ErrorCode>>;
/**
 * The codes contract 1's plugins use, mapped to the table, so a consumer can read a plugin that has not moved yet
 * (projects support the current and previous contract versions, design §3).
 */
export declare const CONTRACT1_CODES: Readonly<Record<string, ErrorCode | ProposedCode>>;
/** The table's code for `code`: itself, its alias, or contract 1's name for it; undefined for any other code. */
export declare function canonicalCode(code: string): ErrorCode | ProposedCode | undefined;
/**
 * A refusal in the family's form, `CODE: what happened. Next step: what to do.`, with the code and its data. A
 * `RATE_LIMITED` or `BUDGET_EXCEEDED` may carry `retryAfterSec`; a `CURSOR_EXPIRED` carries the `gap`.
 */
export declare class SourceError extends Error {
    readonly code: string;
    readonly what: string;
    readonly next: string;
    readonly retryAfterSec?: number;
    readonly gap?: EventsGap;
    constructor(init: {
        readonly code: string;
        readonly what: string;
        readonly next: string;
        readonly retryAfterSec?: number;
        readonly gap?: EventsGap;
    });
}
/**
 * The code, its canonical code, what happened and the next step, read from a refusal: a `SourceError`, or any error
 * whose message is in the family's form. Undefined for an error with no code.
 */
export declare function parseSourceError(error: unknown): {
    code: string;
    canonical?: ErrorCode | ProposedCode;
    what: string;
    next?: string;
} | undefined;
/** An ISO date (a UTC day), or an ISO date-time with seconds optional and `Z` or an offset. */
export declare const SINCE_PATTERN: RegExp;
/** A source's name: a lowercase word such as gmail or history. */
export declare const SOURCE_PATTERN: RegExp;
/** A scope key: a word such as `label`, `channels` or `repositories`. */
export declare const SCOPE_KEY_PATTERN: RegExp;
/** `since` in epoch milliseconds; undefined when it is not one of the accepted forms or not a real time. */
export declare function sinceTime(since: string): number | undefined;
/** A scope's problems against the keys a source declares, one sentence each, naming keys and never values. */
export declare function scopeProblems(scope: unknown, keys: readonly string[]): string[];
/** How a source parses its input: the scope keys it declares (`scope.keys` in its descriptor), none by default. */
export interface ParseOptions {
    readonly scopeKeys?: readonly string[];
}
/**
 * The input checked and normalised, or the problems with it, one sentence each, naming fields and never values.
 * `scope` is accepted only when `options.scopeKeys` declares keys: a source that does not read a scope must refuse
 * one rather than ignore it, since ignoring it would read more than the consumer asked for.
 */
export declare function parseEventsListInput(input: unknown, options?: ParseOptions): {
    ok: true;
    value: EventsListRequest;
} | {
    ok: false;
    problems: string[];
};
/** Where a listing without a cursor starts: `since`, or `FIRST_RUN_HOURS` before `now`. */
export declare function startTime(request: Pick<EventsListRequest, "since">, now: number): number;
/** At most `max` characters, ending in `…` when cut, never splitting a surrogate pair. */
export declare function cut(text: string, max: number): string;
/**
 * `sha256:` and the hex digest of every field but the hash, in a fixed order. Contract 1's fields hash as they always
 * have; each new field is appended, with its name, only when it is present (#45 §6), so an event without them hashes
 * as it did in v0.2.
 */
export declare function eventHash(event: Omit<SourceEvent, "hash">): string;
/** What a source fills in for `makeEvent`; it normalises the rest. */
export interface EventDraft {
    readonly source: string;
    readonly account: string;
    readonly external_id: string;
    readonly kind: EventKind;
    /** A Date, epoch milliseconds, or a string `Date.parse` reads. */
    readonly occurred_at: Date | number | string;
    readonly thread?: string | null;
    readonly actors?: readonly {
        readonly role: string;
        readonly id: string;
        readonly name?: string | null;
        readonly kind?: ActorKind;
        readonly identities?: readonly EventIdentity[];
        readonly self?: boolean;
    }[];
    readonly title?: string | null;
    readonly text?: string | null;
    readonly url?: string | null;
    readonly labels?: readonly string[];
    readonly reply_to?: string | null;
    readonly audience?: Audience | null;
    readonly domains?: readonly string[];
    readonly sections?: readonly {
        readonly heading: string;
        readonly text: string;
    }[];
    readonly parts?: readonly {
        readonly id: string;
        readonly text: string;
        readonly actor?: string;
    }[];
    readonly facts?: readonly EventFact[];
}
/**
 * A `SourceEvent` from a draft: the time in UTC ISO form, the title on one line and cut to 300 characters, the text cut
 * to 4096, actors without blanks or repeats and at most 20, labels likewise, a url only when it is https, the metadata
 * of #45 §2 normalised, and the hash. An actor's `kind`, identities and `self` are kept as the plugin gave them, and so
 * are an event's facts: `eventProblems` is where a wrong one is refused. Throws when the time is not a real time.
 */
export declare function makeEvent(draft: EventDraft): SourceEvent;
/** Events oldest first; events at the same time keep their order. */
export declare function oldestFirst<T extends Pick<SourceEvent, "occurred_at">>(events: readonly T[]): T[];
/**
 * How many of `events`, in the order given, fit in one result: at most `limit`, and as many as keep the result's JSON
 * within `maxBytes` (`MAX_PAGE_BYTES` by default; pass the descriptor's `maxBytes`), but always at least one.
 */
export declare function fitPage(events: readonly SourceEvent[], limit: number, maxBytes?: number): number;
/** How `screenEvents` decides. Without predicates, only the secret pattern refuses. */
export interface ScreenOptions {
    /** False when the event is not the signed-in owner's (a shared mailbox, a delegated calendar). */
    readonly ownedBy?: (event: SourceEvent) => boolean;
    /** True when the event is instruction-shaped text from someone else. The library has no default (`docs/events.md`, D5). */
    readonly instruction?: (event: SourceEvent) => boolean;
    /** The secret detector; Memory's `secretKinds` by default. */
    readonly secrets?: (text: string) => readonly string[];
}
/**
 * The events a page may carry, and those it refuses for good, in order: not the owner's, then a secret in the title or
 * text (as Memory's store checks an import), then instruction-shaped. A refusal's detail never holds the content.
 */
export declare function screenEvents(events: readonly SourceEvent[], options?: ScreenOptions): {
    events: SourceEvent[];
    refused: RefusedEvent[];
};
/** The tools-RPC method and tool every source plugin names `probe`: one per plugin, called per source. */
export declare const PROBE = "probe";
/** `probe`'s input: the source (the plugin's first without it) and the account (its default without it). Nothing else. */
export interface ProbeInput {
    readonly source?: string;
    readonly account?: string;
}
/** The provider sign-in scopes a probe may list: at most this many, each at most this long. */
export declare const PROBE_LIMITS: {
    readonly scopes: 64;
    readonly scope: 256;
};
/**
 * What `probe` answers: whose the source is and what its sign-in holds, and nothing it reads. `owner.id` is the id a
 * host keys its cache on and `$me` resolves to. `scopes` are the provider sign-in's scopes, so a Calendar-only sign-in
 * can be told apart. `cost` is what the provider charged for the probe, for a billed source such as X (its own price
 * table, per §2.2 `cost.probe`). `trust` is "untrusted", as on every result.
 */
export interface ProbeResult {
    readonly source: string;
    readonly account: string;
    readonly owner: EventsOwner;
    readonly scopes?: string[];
    readonly cost?: EventsCost;
    readonly trust: typeof TRUST;
}
/** `probe`'s input checked, or its problems, naming fields and never values. Anything but source and account is refused. */
export declare function parseProbeInput(input: unknown): {
    ok: true;
    value: ProbeInput;
} | {
    ok: false;
    problems: string[];
};
/** A probe answer for `identity`, with the sign-in's scopes and the probe's cost when given. */
export declare function probeResult(identity: EventsListIdentity, extras?: {
    readonly scopes?: readonly string[];
    readonly cost?: EventsCost;
}): ProbeResult;
/**
 * A probe answer's problems, one sentence each; none when it keeps the contract. Its keys are exactly
 * `source, account, owner, scopes?, cost?, trust`, so a probe that returned content (events, data, text) fails. With
 * `expected`, the source and the account must be the ones asked for.
 */
export declare function probeResultProblems(result: unknown, expected?: {
    readonly source?: string;
    readonly account?: string;
}): string[];
/** Whose a result is: the source and account it lists, and the signed-in owner of that account. */
export interface EventsListIdentity {
    readonly source: string;
    readonly account: string;
    readonly owner: EventsOwner;
}
/** The page result's optional parts; each is written only when given. Empty `refused` and `failed` lists are left out. */
export interface PageExtras {
    readonly scope?: Scope;
    readonly refused?: readonly RefusedEvent[];
    readonly failed?: readonly FailedEvent[];
    readonly removals?: readonly EventsRemoval[];
    readonly gap?: EventsGap;
    readonly cost?: EventsCost;
    readonly plugin?: string;
    readonly asOf?: string;
}
/** A result, with its source, account, owner and trust marker, and the extras given. Without extras, contract 1's. */
export declare function eventsListResult(identity: EventsListIdentity, events: readonly SourceEvent[], cursor: string, more: boolean, extras?: PageExtras): EventsListResult;
/**
 * One fact's problems (#45 §3), one sentence each; none when it keeps the contract. Each actor reference must be an
 * actor id on the same event, which is `actors`. The shape is closed: a fact carries no version (Memory stamps the
 * installed package's) and no field for a sensitive trait.
 */
export declare function factProblems(fact: unknown, actors: ReadonlySet<string>, where?: string): string[];
/** One event's problems, one sentence each; none when it keeps the contract. */
export declare function eventProblems(event: unknown, where?: string): string[];
/**
 * A page's `removals[]` problems (#27), one sentence each; none when it is absent or keeps the contract: at most 500
 * entries of exactly `{ external_id, at, reason }`, each id once, none also in `failed[]`, and no `at` later than the
 * page's `asOf`. An id may also be among the page's events. The conformance kit's `removals-are-final` reports these.
 */
export declare function removalProblems(result: unknown): string[];
/**
 * A result's problems: its shape, every event, the order, the limit and the size, and each optional addition that is
 * present. None when it keeps the contract. `maxBytes` is the source's declared cap, `MAX_PAGE_BYTES` by default.
 */
export declare function resultProblems(result: unknown, limit?: number, maxBytes?: number): string[];
