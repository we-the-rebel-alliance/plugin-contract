/**
 * `read`: the consumer-side call (design §3). Every project reads a source the same way, with no host required:
 *
 * 1. the manifest comes from the installed package (`readInstalledManifest`), and the grant must be for the same
 *    manifest hash, consumer source, account and scope;
 * 2. `since` and `pick` are resolved and checked before anything is called;
 * 3. the call runs in a session fenced by exactly the grant's rules (`sessionRules`), opened and closed by the host;
 * 4. the answer is checked: its account, `trust: "untrusted"`, its size against `maxBytes`, and a snapshot's `data`
 *    against its output schema; then `pick` keeps only the picked paths.
 *
 * The host is two calls: open a session with given rules, and call a plugin's tools-RPC method in it. Each app
 * implements them over its own OpenCode server. An app keeps its own cursor: `read` returns the page and never stores
 * anything.
 */
import { type InstalledManifest, type OwnerOrg, type SourceItem } from "./manifest.js";
import type { Checked } from "./internal/checked.js";
import { type ReadFailure } from "./internal/failure.js";
import { type ParamsContext } from "./params.js";
import { type Grant, type PermissionRule } from "./permission.js";
export type { FailureCode, ReadFailure } from "./internal/failure.js";
/** What a project's host does for `read`. */
export interface ReadHost {
    /** Opens a session whose rules are exactly `rules`, for one read; `close` ends it. */
    openSession(request: {
        readonly rules: readonly PermissionRule[];
        readonly title: string;
    }): Promise<{
        readonly sessionID: string;
        close(): Promise<void>;
    }>;
    /**
     * Calls a plugin's method in that session: `POST /api/rpc/<plugin id>/<method>` with `{ sessionID, input }`. The
     * host maps the package to its plugin id, from its own record of installed plugins.
     */
    call(request: {
        readonly package: string;
        readonly method: string;
        readonly sessionID: string;
        readonly input: Readonly<Record<string, unknown>>;
        readonly signal?: AbortSignal;
    }): Promise<unknown>;
}
/** One read of a source. */
export interface ReadRequest {
    readonly installed: InstalledManifest;
    readonly source: string;
    readonly grant: Grant;
    /** The consumer reading; must be the grant's. */
    readonly consumer: string;
    /** Narrower than the grant's scope, or the grant's when absent. */
    readonly scope?: Readonly<Record<string, readonly string[]>>;
    /** An events read. */
    readonly cursor?: string;
    readonly since?: string;
    readonly limit?: number;
    /** Ask for each event's `thumbnail` (#42). Only a source that declares `thumbnails` accepts it. */
    readonly thumbnails?: true;
    /** A snapshot read. */
    readonly pick?: readonly string[];
    readonly context: ParamsContext;
    readonly signal?: AbortSignal;
}
/** An events page, as the plugin answered it (design §2.1). */
export interface EventsPage {
    readonly source: string;
    readonly account: string;
    readonly owner: {
        readonly id: string;
        readonly label?: string;
    };
    readonly events: readonly Readonly<Record<string, unknown>>[];
    readonly cursor: string;
    readonly more: boolean;
    readonly trust: "untrusted";
    readonly refused?: readonly unknown[];
    readonly failed?: readonly unknown[];
    readonly gap?: {
        readonly reason: string;
        readonly since: string;
    };
    readonly cost?: unknown;
    readonly [key: string]: unknown;
}
/** A snapshot, as the plugin answered it, after `pick`. */
export interface Snapshot {
    readonly data: Readonly<Record<string, unknown>>;
    readonly asOf: string;
    readonly cost?: unknown;
    readonly trust: "untrusted";
}
export type ReadOutcome = {
    readonly ok: true;
    readonly kind: "events";
    readonly page: EventsPage;
} | {
    readonly ok: true;
    readonly kind: "snapshot";
    readonly snapshot: Snapshot;
} | {
    readonly ok: false;
    readonly failure: ReadFailure;
};
/**
 * The checks before any call, whoever makes it: the source is declared, the person has not turned it off, the grant is
 * this consumer's for the manifest as installed, the scope is within the grant, the inputs suit the source's kind,
 * and `pick` names paths of its output. The source and the scope to read when they pass.
 */
export declare function checkReadRequest(request: ReadRequest): {
    readonly source: SourceItem;
    readonly scope?: Readonly<Record<string, readonly string[]>>;
} | ReadOutcome;
/** Reads a source under a grant, in a session fenced by the grant's rules. Never throws for a refused or failed read. */
export declare function read(host: ReadHost, request: ReadRequest): Promise<ReadOutcome>;
/**
 * A source's answer, checked as the contract says and picked: the account, `trust: "untrusted"`, the size against
 * `maxBytes`, an events page's shape or a snapshot's output, then `pick`. The same checks whoever made the call: `read`
 * embedded, or a host's broker (`broker-client`), so a broker never needs to be trusted for shape.
 */
export declare function acceptAnswer(source: SourceItem, account: string, answer: unknown, options?: {
    readonly limit?: number;
    readonly pick?: readonly string[];
    readonly thumbnails?: true;
}): ReadOutcome;
/** A detail read of one event (design §2.2 `details`). */
export interface DetailRequest {
    readonly installed: InstalledManifest;
    readonly source: string;
    readonly detail: string;
    readonly grant: Grant;
    readonly consumer: string;
    /** The event the detail is read for, as the source listed it. Inputs come only from its API fields. */
    readonly event: Readonly<Record<string, unknown>>;
    readonly signal?: AbortSignal;
}
/**
 * The detail's `fields`: exactly the event fields its `from` names, taken from the event as the source listed it, and
 * nothing else. An event's `title` and `text` are never among them, so item text cannot choose what is read next.
 */
export declare function detailFields(source: SourceItem, detailId: string, event: Readonly<Record<string, unknown>>): Checked<Record<string, unknown>>;
/**
 * Reads a declared detail of one event, in a session fenced by the source's rules and the detail's method. The call
 * is `{ account, scope, fields }`, with the confirmed scope, so the plugin refuses an event outside it.
 */
export declare function readDetail(host: ReadHost, request: DetailRequest): Promise<{
    readonly ok: true;
    readonly answer: unknown;
} | {
    readonly ok: false;
    readonly failure: ReadFailure;
}>;
/** What `probe` answers: the signed-in owner and the scopes the provider sign-in holds. It reads no content. */
export interface ProbeAnswer {
    readonly source: string;
    readonly account: string;
    /**
     * The signed-in owner. `verified: false` marks an owner the provider does not confirm (#30, item 13), and `orgs`
     * carries the organizations the provider reports (#44 item 2), at most five.
     */
    readonly owner: {
        readonly id: string;
        readonly label: string;
        readonly verified?: false;
        readonly orgs?: readonly OwnerOrg[];
    };
    readonly scopes?: readonly string[];
    readonly cost?: unknown;
    readonly trust: "untrusted";
}
/**
 * Probes a source for an account, in a session fenced by the plugin's `methods.probe` action and the identity
 * operations it declares, or the identity operations the caller passes. The source's own method action fences the
 * read; `probe` adds no content. The call is `probe` with `{ source?, account }`.
 */
export declare function probe(host: ReadHost, request: {
    readonly installed: InstalledManifest;
    readonly source: string;
    readonly account: string;
    readonly identityOperations?: readonly string[];
    readonly signal?: AbortSignal;
}): Promise<{
    readonly ok: true;
    readonly answer: ProbeAnswer;
} | {
    readonly ok: false;
    readonly failure: ReadFailure;
}>;
