/**
 * Status per account (contract §5 and §11).
 *
 * `status` lists every alias with a `state` of `ready`, `needs_sign_in` or `error`, and the owner once a probe has
 * answered. A failure reason is one line of at most 160 characters, redacted: no URL query string, no bearer token, no
 * token-shaped text, no control character. The library never echoes what a provider said.
 *
 * `statusAnswer` assembles the whole answer, so a plugin's `status` handler is a short call to it with the versions,
 * the account states and the problems it already knows: no state kept between `register` and the handler, no shape
 * copied.
 */
import type { JsonSchema, Manifest, Owner } from "../manifest/types.js";
import type { AccountProfile } from "./profiles.js";
/** What an account can be. */
export declare const ACCOUNT_STATES: readonly ["ready", "needs_sign_in", "error"];
export type AccountState = (typeof ACCOUNT_STATES)[number];
/** One alias's state, as `probe` or the sign-in reports it. */
export interface AccountSignal {
    readonly state: AccountState;
    readonly owner?: Owner | undefined;
    /** Why it is not ready. Cut to one line of 160 characters, and redacted. */
    readonly reason?: string | undefined;
}
/** One alias as status reports it. */
export interface AccountStatus {
    readonly alias: string;
    readonly state: AccountState;
    readonly owner?: Owner | undefined;
    readonly reason?: string | undefined;
}
/** The most characters a reason takes (contract §11). */
export declare const REASON_MAX = 160;
/** A value redacted: URL query values, authorization credentials, token-shaped words, and control characters. */
export declare function redactReason(reason: unknown): string;
/** One alias's status: its state, its owner when known, and a redacted one-line reason when it is not ready. */
export declare function accountStatus(alias: string, signal: AccountSignal | undefined): AccountStatus;
/**
 * Status for every alias the plugin has, in the order the options name them. A signal for an alias the plugin does not
 * have is ignored: status never invents an account.
 */
export declare function accountStatuses(accounts: readonly AccountProfile[], signals?: Readonly<Record<string, AccountSignal | undefined>>): readonly AccountStatus[];
/** The status of a plugin with no accounts: an empty list, never a `default` the person cannot sign in to. */
export declare const NO_ACCOUNTS: readonly AccountStatus[];
/** What `status` knows when it answers: the manifest, the versions, every alias's state, and the agents the rules miss. */
export interface StatusInput {
    readonly manifest: Manifest;
    /** The installed package's version. */
    readonly version: string;
    /** The OpenCode release the plugin runs on: `ctx.app.version`. */
    readonly hostVersion: string;
    /** One entry per alias, in the options' order. */
    readonly accounts: readonly AccountStatus[];
    /** Why the plugin is not ready before any account is asked: a failed registration, an unreadable agent list. */
    readonly problems?: readonly string[] | undefined;
    /** The agents whose rules no longer give every generated rule its effect, from `access.unguardedAgents`. */
    readonly unguardedAgents: readonly string[];
}
/** The `status` answer (contract §11), as `STATUS_SCHEMA` describes it. */
export interface StatusAnswer {
    readonly name: string;
    readonly version: string;
    readonly host: {
        readonly version: string;
        readonly range: string;
        readonly tested: readonly string[];
    };
    readonly state: AccountState;
    readonly accounts: readonly AccountStatus[];
    readonly unguardedAgents: readonly string[];
    /** One redacted line a person can act on, or null when the plugin is ready. */
    readonly nextStep: string | null;
}
/**
 * The whole `status` answer from what the handler knows: the manifest, the installed and host versions, every alias's
 * state, the problems setup recorded, and the agents the generated rules miss. `state` is `error` when there is a
 * problem, else `needs_sign_in` when an account is, else `ready`; `nextStep` is the first redacted problem, the
 * sign-in sentence, or null. A handler needs no state of its own: it passes the values it has and answers this.
 */
export declare function statusAnswer(input: StatusInput): StatusAnswer;
/**
 * The JSON Schema of `status` (contract §11): the plugin's identity, the host range it runs on, its state, every alias's
 * state and owner, the agents that lack the generated access rules, and a redacted next step. A plugin reuses this
 * constant for its `status` handler's output instead of copying the shape; `status` is required on every plugin.
 */
export declare const STATUS_SCHEMA: JsonSchema;
